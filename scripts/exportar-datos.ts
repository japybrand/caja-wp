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
import { calcularFlujo } from '../src/lib/flujo'
import { calcularPanel } from '../src/lib/panel'
import { ORDEN_DE_TABLAS, FECHA_DE_CORTE, motor, type Respaldo } from './respaldo-comun'

const prisma = new PrismaClient()
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARPETA = path.join(RAIZ, 'respaldo')


async function main(): Promise<void> {
  const filas: Record<string, unknown[]> = {}
  let total = 0

  for (const tabla of ORDEN_DE_TABLAS) {
    // El cliente de Prisma expone cada modelo con su nombre en minúscula inicial.
    const modelo = prisma[tabla] as unknown as { findMany: () => Promise<unknown[]> }
    const datos = await modelo.findMany()
    filas[tabla] = datos
    total += datos.length
    console.log(` ${tabla.padEnd(24)} ${String(datos.length).padStart(6)}`)
  }

  // Las cifras derivadas se calculan AQUI, con el codigo de produccion, y viajan
  // con el respaldo. Son la prueba de que los enlaces sobrevivieron: las tres
  // primeras se obtienen recorriendolos, asi que un id regenerado las mueve.
  const flujo = await calcularFlujo(2026)
  const panel = await calcularPanel(2026, FECHA_DE_CORTE)
  const financiero = flujo.filas.find((f) => f.clave === 'flujo_financiero')?.montos ?? []
  const cifras = {
    saldoHoy: panel.saldoHoy,
    yaPagadoDelMes: panel.desglose.yaPagado,
    egresosDelMes: panel.desglose.egresosDelMes,
    flujoFinancieroDiciembre: financiero[11] ?? 0,
    porRevisar: panel.porRevisar,
    sinConciliar: panel.sinConciliar,
  }

  const respaldo: Respaldo = {
    generadoEn: new Date().toISOString(),
    origen: motor(),
    orden: ORDEN_DE_TABLAS,
    cifras,
    filas,
  }

  mkdirSync(CARPETA, { recursive: true })
  // Fecha Y HORA en el nombre. Con solo la fecha, dos respaldos del mismo día se
  // pisaban: el de producción sobrescribió al que documentaba el origen de la
  // migración. Un respaldo que borra otro respaldo no es un respaldo.
  const sello = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  const nombre = `datos-${sello}-${respaldo.origen === 'postgresql' ? 'prod' : 'local'}.json`
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
