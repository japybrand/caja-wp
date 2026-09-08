/**
 * Reconstruye un respaldo de `exportar-datos.ts` en la base a la que apunte
 * DATABASE_URL.
 *
 *   node --import tsx --conditions=react-server --env-file=.env.local --env-file=.env \
 *     scripts/importar-datos.ts [archivo] [--firme] [--vaciar]
 *
 * Sin `--firme` solo simula: dice cuántas filas escribiría y qué encuentra ya
 * cargado. Sin `archivo` toma el respaldo más reciente de `respaldo/`.
 *
 * LOS IDS SE ESCRIBEN EXPLÍCITOS
 * Es lo único que hace que la migración conserve los nueve meses de conciliación.
 * Los 435 cargos bancarios apuntan por `movimientoId` a su movimiento; 6 cuotas de
 * convenio y 8 cotizaciones apuntan a su cargo. Si Prisma generara ids nuevos, el
 * flujo seguiría cuadrando y "ya pagado" daría cero: el error no aparecería por
 * ninguna parte. De ahí que el `create` lleve el `id` del respaldo y que el orden
 * de tablas respete las claves foráneas.
 *
 * ES IDEMPOTENTE, NO DESTRUCTIVO
 * Cada fila entra con `upsert` por su id, así que volver a correrlo sobre una base
 * ya cargada no duplica nada. `--vaciar` borra las tablas destino antes de escribir,
 * en orden inverso al de inserción; sirve para repetir una migración fallida contra
 * una base de prueba. NUNCA lo uses contra una base con datos que no estén en el
 * respaldo.
 *
 * POR QUÉ DOS PROCESOS Y NO UNO
 * Un solo proceso no puede hablar con SQLite y con PostgreSQL a la vez: el cliente
 * de Prisma se genera contra un `provider`. Por eso la migración son dos corridas
 * con un `npm run db:postgres` en medio, y un JSON entre ellas que además queda
 * como respaldo.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { ORDEN_DE_TABLAS, motor, type Respaldo, type Tabla } from './respaldo-comun'

const prisma = new PrismaClient()
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARPETA = path.join(RAIZ, 'respaldo')

const FIRME = process.argv.includes('--firme')
const VACIAR = process.argv.includes('--vaciar')

/** Campos que Prisma entrega como Date y el JSON guardó como texto ISO. */
const ES_FECHA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/**
 * Revive las fechas del JSON.
 *
 * `JSON.parse` deja los DateTime como string y Prisma los rechaza. La detección va
 * por forma del valor y no por nombre de campo, así que no hay que mantener una
 * lista de columnas por tabla.
 */
function revivir(fila: Record<string, unknown>): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(fila)) {
    salida[clave] = typeof valor === 'string' && ES_FECHA.test(valor) ? new Date(valor) : valor
  }
  return salida
}

function ultimoRespaldo(): string {
  const archivos = readdirSync(CARPETA)
    .filter((f) => f.startsWith('datos-') && f.endsWith('.json'))
    .sort()
  const ultimo = archivos.at(-1)
  if (!ultimo) throw new Error(`No hay respaldos en ${CARPETA}. Corre primero exportar-datos.`)
  return path.join(CARPETA, ultimo)
}

interface Modelo {
  count: () => Promise<number>
  upsert: (args: unknown) => Promise<unknown>
  deleteMany: () => Promise<{ count: number }>
}
const modeloDe = (tabla: Tabla): Modelo => prisma[tabla] as unknown as Modelo

async function main(): Promise<void> {
  const ruta = process.argv.find((a) => a.endsWith('.json')) ?? ultimoRespaldo()
  const respaldo = JSON.parse(readFileSync(ruta, 'utf-8')) as Respaldo
  const destino = motor()

  console.log(`respaldo: ${path.basename(ruta)}`)
  console.log(`  generado: ${respaldo.generadoEn}  origen: ${respaldo.origen}`)
  console.log(`  destino:  ${destino}\n`)

  if (respaldo.origen === destino) {
    console.log('OJO: el origen y el destino son el mismo motor. ¿Es lo que quieres?\n')
  }

  // El orden viaja dentro del respaldo; el del código es solo el de reserva, para
  // que un archivo viejo no se importe con dependencias mal ordenadas.
  const orden = (respaldo.orden ?? ORDEN_DE_TABLAS) as readonly Tabla[]

  if (VACIAR) {
    console.log('--vaciar: se borran las tablas destino, en orden inverso.')
    if (FIRME) {
      for (const tabla of [...orden].reverse()) {
        const { count } = await modeloDe(tabla).deleteMany()
        if (count > 0) console.log(`  ${tabla.padEnd(24)} ${String(count).padStart(6)} borradas`)
      }
    }
    console.log('')
  }

  let total = 0
  let existentes = 0
  for (const tabla of orden) {
    const filas = (respaldo.filas[tabla] ?? []) as Record<string, unknown>[]
    const modelo = modeloDe(tabla)
    const antes = await modelo.count()
    total += filas.length
    existentes += antes

    if (FIRME) {
      for (const fila of filas) {
        const datos = revivir(fila)
        await modelo.upsert({ where: { id: datos.id }, create: datos, update: datos })
      }
      const despues = await modelo.count()
      console.log(
        ` ${tabla.padEnd(24)} ${String(filas.length).padStart(6)} en el respaldo` +
          ` -> ${String(despues).padStart(6)} en destino` +
          (despues !== filas.length ? '   OJO, no calzan' : ''),
      )
    } else {
      console.log(
        ` ${tabla.padEnd(24)} ${String(filas.length).padStart(6)} escribiría` +
          (antes > 0 ? `   (ya hay ${antes} en destino)` : ''),
      )
    }
  }

  console.log(`\n ${'TOTAL'.padEnd(24)} ${String(total).padStart(6)} filas`)
  if (!FIRME) {
    if (existentes > 0) {
      console.log(
        `\n La base destino ya tiene ${existentes} filas. El upsert por id no duplica,` +
          ' pero revisa que sea la base que quieres.',
      )
    }
    console.log('\nSimulación. Repite con --firme para aplicarlo.')
    return
  }
  console.log('\nAplicado. Ahora corre la verificación:  npm run verificar-migracion')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
