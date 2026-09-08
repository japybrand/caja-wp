/**
 * Respalda la base entera a un JSON, para migrarla de SQLite a PostgreSQL.
 *
 *   node --import tsx --conditions=react-server --env-file=.env.local --env-file=.env \
 *     scripts/exportar-datos.ts
 *
 * NO ESCRIBE NADA EN LA BASE. Solo lee y deja el archivo en respaldo/.
 *
 * POR QUÉ UN JSON CON PRISMA Y NO UN DUMP
 * No hay camino directo de SQLite a PostgreSQL: los tipos de fecha y de booleano se
 * guardan distinto y un dump de uno no se restaura en el otro. Pasando por Prisma,
 * cada motor traduce sus tipos a JavaScript y de vuelta, y el JSON queda neutral.
 *
 * LOS IDS SE CONSERVAN
 * Es lo único que de verdad importa. Los 695 cargos bancarios apuntan por
 * `movimientoId` a los 529 movimientos; las 72 cuotas de convenio y las 20
 * cotizaciones apuntan a cargos. Si al importar se generaran ids nuevos, los nueve
 * meses de conciliación quedarían como filas sueltas sin decir nada: los totales
 * seguirían cuadrando y "ya pagado" daría cero. Por eso el `create` de la
 * importación lleva el `id` explícito y el orden respeta las claves foráneas.
 *
 * EL ARCHIVO ES TAN SENSIBLE COMO LA CARTOLA
 * Lleva la cuenta completa, los sueldos y el flujo del año. `respaldo/` está en
 * .gitignore por eso.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARPETA = path.join(RAIZ, 'respaldo')

/**
 * El orden importa: es el mismo en que la importación tiene que insertar.
 *
 * Sale del mapa de claves foráneas del esquema. Cada tabla va después de todas las
 * que referencia, así que ninguna inserción encuentra un id que todavía no existe.
 */
const TABLAS = [
  // 1. Sin dependencias.
  'categoria',
  'cuentaGoogle',
  'tipoCambio',
  'sincronizacion',
  'documentoVenta',
  'documentoCompra',
  'declaracionF29',
  // 2. Depende de Categoria.
  'proveedor',
  // 3. Depende de Categoria y Proveedor.
  'movimiento',
  // 4. Dependen de Movimiento o Proveedor.
  'valorManual',
  'reglaClasificacion',
  'remitenteCandidato',
  'correoProcesado',
  'movimientoGlobal66',
  // 5. Depende de Movimiento y Categoria.
  'movimientoBancario',
  // 6. Depende de Categoria.
  'obligacionFinanciera',
  // 7. Dependen de ObligacionFinanciera y MovimientoBancario.
  'cuotaObligacion',
  'cotizacionPrevisional',
] as const

export type Tabla = (typeof TABLAS)[number]
export const ORDEN_DE_TABLAS: readonly Tabla[] = TABLAS

export interface Respaldo {
  generadoEn: string
  origen: string
  /** El orden viaja con los datos: quien importe no tiene que volver a deducirlo. */
  orden: readonly string[]
  filas: Record<string, unknown[]>
}

async function main(): Promise<void> {
  const filas: Record<string, unknown[]> = {}
  let total = 0

  for (const tabla of TABLAS) {
    // El cliente de Prisma expone cada modelo con su nombre en minúscula inicial.
    const modelo = prisma[tabla] as unknown as { findMany: () => Promise<unknown[]> }
    const datos = await modelo.findMany()
    filas[tabla] = datos
    total += datos.length
    console.log(` ${tabla.padEnd(24)} ${String(datos.length).padStart(6)}`)
  }

  const respaldo: Respaldo = {
    generadoEn: new Date().toISOString(),
    origen: (process.env.DATABASE_URL ?? '').startsWith('postgres') ? 'postgresql' : 'sqlite',
    orden: TABLAS,
    filas,
  }

  mkdirSync(CARPETA, { recursive: true })
  const nombre = `datos-${new Date().toISOString().slice(0, 10)}.json`
  const destino = path.join(CARPETA, nombre)
  writeFileSync(destino, JSON.stringify(respaldo, null, 1), 'utf-8')

  console.log(`\n ${'TOTAL'.padEnd(24)} ${String(total).padStart(6)} filas`)
  console.log(` origen: ${respaldo.origen}`)
  console.log(` archivo: respaldo/${nombre}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
