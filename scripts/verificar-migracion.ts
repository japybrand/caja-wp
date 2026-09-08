/**
 * Comprueba que la migración llegó entera.
 *
 *   node --import tsx --conditions=react-server --env-file=.env.local --env-file=.env \
 *     scripts/verificar-migracion.ts [archivo]
 *
 * NO ESCRIBE NADA. Compara la base a la que apunte DATABASE_URL contra el respaldo,
 * y termina con código 1 si algo no calza, para poder encadenarlo.
 *
 * CONTAR FILAS NO ALCANZA
 * Las 2.025 filas pueden estar todas y la migración estar rota igual: lo que hay que
 * probar es que sobrevivieron los 986 enlaces por clave foránea. Por eso la
 * verificación recalcula las mismas cifras que el panel y el flujo —el saldo de hoy,
 * el "ya pagado" del mes, el flujo financiero de diciembre— usando el código de
 * producción. Esas tres se computan RECORRIENDO los enlaces: si los ids se hubieran
 * regenerado, "ya pagado" daría cero y las otras dos se moverían.
 *
 * Los valores esperados viajan DENTRO del respaldo, calculados al exportarlo. No se
 * escriben como constantes: una constante envejece en cuanto los datos cambian por
 * una razón legítima, y entonces la verificación falla por el motivo equivocado y se
 * vuelve ruido que se termina ignorando.
 *
 * Se agregan dos comprobaciones que apuntan al riesgo específico de PostgreSQL:
 * el conteo de cuotas y cotizaciones con cargo bancario enlazado, que es donde ya
 * hubo un error por la diferencia de horas entre las fechas de la cartola (medianoche)
 * y las construidas a mediodía.
 */

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { calcularFlujo } from '../src/lib/flujo'
import { calcularPanel } from '../src/lib/panel'
import { ORDEN_DE_TABLAS, FECHA_DE_CORTE, motor, type Respaldo, type Tabla } from './respaldo-comun'

const prisma = new PrismaClient()
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARPETA = path.join(RAIZ, 'respaldo')
const ANIO = 2026

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

function ultimoRespaldo(): string {
  const archivos = readdirSync(CARPETA)
    .filter((f) => f.startsWith('datos-') && f.endsWith('.json'))
    .sort()
  const ultimo = archivos.at(-1)
  if (!ultimo) throw new Error(`No hay respaldos en ${CARPETA}.`)
  return path.join(CARPETA, ultimo)
}

let fallas = 0
function comparar(concepto: string, esperado: number | string, real: number | string): void {
  const ok = String(esperado) === String(real)
  if (!ok) fallas += 1
  console.log(
    `  ${ok ? 'ok  ' : 'FALLA'} ${concepto.padEnd(46)} ${String(esperado).padStart(16)}` +
      (ok ? '' : `  !=  ${String(real)}`),
  )
}

async function main(): Promise<void> {
  const ruta = process.argv.find((a) => a.endsWith('.json')) ?? ultimoRespaldo()
  const respaldo = JSON.parse(readFileSync(ruta, 'utf-8')) as Respaldo

  console.log(`respaldo: ${path.basename(ruta)}  (${respaldo.origen})`)
  console.log(`destino:  ${motor()}\n`)

  console.log('FILAS POR TABLA')
  for (const tabla of ORDEN_DE_TABLAS as readonly Tabla[]) {
    const modelo = prisma[tabla] as unknown as { count: () => Promise<number> }
    comparar(tabla, (respaldo.filas[tabla] ?? []).length, await modelo.count())
  }

  console.log('\nENLACES POR CLAVE FORÁNEA')
  // Los enlaces se cuentan en el respaldo y en la base: es la prueba directa de que
  // los ids se conservaron. Un id regenerado deja el campo apuntando a la nada, y
  // Postgres lo habría rechazado; SQLite, según la configuración, podría no hacerlo.
  const enlacesEnRespaldo = (tabla: string, campo: string): number =>
    ((respaldo.filas[tabla] ?? []) as Record<string, unknown>[]).filter((f) => f[campo]).length

  comparar(
    'movimientoBancario.movimientoId',
    enlacesEnRespaldo('movimientoBancario', 'movimientoId'),
    await prisma.movimientoBancario.count({ where: { movimientoId: { not: null } } }),
  )
  comparar(
    'movimiento.proveedorId',
    enlacesEnRespaldo('movimiento', 'proveedorId'),
    await prisma.movimiento.count({ where: { proveedorId: { not: null } } }),
  )
  comparar(
    'cuotaObligacion.movimientoBancarioId',
    enlacesEnRespaldo('cuotaObligacion', 'movimientoBancarioId'),
    await prisma.cuotaObligacion.count({ where: { movimientoBancarioId: { not: null } } }),
  )
  comparar(
    'cotizacionPrevisional.movimientoBancarioId',
    enlacesEnRespaldo('cotizacionPrevisional', 'movimientoBancarioId'),
    await prisma.cotizacionPrevisional.count({ where: { movimientoBancarioId: { not: null } } }),
  )

  console.log('\nCIFRAS DERIVADAS  (se calculan recorriendo los enlaces)')
  if (!respaldo.cifras) {
    console.log('  El respaldo no trae cifras. Vuelve a exportarlo para poder compararlas.')
  } else {
    const flujo = await calcularFlujo(ANIO)
    const financiero = flujo.filas.find((f) => f.clave === 'flujo_financiero')?.montos ?? []
    const panel = await calcularPanel(ANIO, FECHA_DE_CORTE)
    const c = respaldo.cifras

    // Los esperados salen del respaldo, no de constantes escritas a mano: una
    // constante envejece en cuanto los datos cambian por una razón legítima, y la
    // verificación pasa a fallar por el motivo equivocado hasta que se la ignora.
    comparar('saldo de hoy', clp(c.saldoHoy), clp(panel.saldoHoy))
    comparar('ya pagado del mes', clp(c.yaPagadoDelMes), clp(panel.desglose.yaPagado))
    comparar('egresos del mes', clp(c.egresosDelMes), clp(panel.desglose.egresosDelMes))
    comparar(
      'flujo financiero de diciembre',
      clp(c.flujoFinancieroDiciembre),
      clp(financiero[11] ?? 0),
    )
    comparar('movimientos por revisar', c.porRevisar, panel.porRevisar)
    comparar('cargos sin conciliar', c.sinConciliar, panel.sinConciliar)
  }

  console.log(
    fallas === 0
      ? '\nTodo calza. La conciliación llegó entera.'
      : `\n${fallas} comprobaciones fallaron. NO des la migración por buena.`,
  )
  if (fallas > 0) process.exitCode = 1
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
