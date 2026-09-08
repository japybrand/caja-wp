/**
 * Linea de credito Fogape Maxxa: giros y amortizaciones segun la tabla de
 * desarrollo del banco, no segun la proyeccion del Excel.
 *
 *   npm run fogape              (simulacion, no escribe)
 *   npm run fogape -- --firme
 *
 * La tabla de desarrollo es la fuente de verdad: dice cuanto se giro y cuando, y
 * cuanto hay que pagar cada mes hasta julio de 2027. El Excel traia 4.000.000 de
 * financiamiento en abril y otros 4.000.000 en mayo, cuando el segundo mes fueron
 * 4.834.000; y la cuota de julio la traia en 870.000 cuando el banco cobro 872.542
 * (870.000 de cuota mas 2.542 de interes de mora).
 *
 * Ojo con el signo de las cuotas: entra completa a la fila de deudas, no solo el
 * capital. Lo que sale de la cuenta corriente son 870.000, y el interes es gasto
 * financiero real, no un traspaso interno.
 */

import { PrismaClient } from '@prisma/client'
import { MESES_CORTOS } from '../src/lib/dominio'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

/** Fila de financiamiento: la plata que entro por giros de la linea. */
const FILA_GIROS = 'Línea de crédito Fogape Maxxa'
/** Fila de deudas: la cuota mensual completa que sale de la cuenta. */
const FILA_CUOTAS = 'Fogape - cuotas'

/**
 * Tabla de desarrollo de la linea, RUT 76513765-9, abierta el 06/04/2026 por
 * 8.700.000 y girada por completo. Las filas hasta el 07/07/2026 son movimientos
 * ocurridos; de 05/08/2026 en adelante es el calendario comprometido.
 */
const GIROS: { fecha: string; monto: number }[] = [
  { fecha: '2026-04-07', monto: 3_000_000 },
  { fecha: '2026-04-23', monto: 1_000_000 },
  { fecha: '2026-05-07', monto: 4_000_000 },
  { fecha: '2026-05-12', monto: 834_000 },
]

const CUOTAS: { fecha: string; monto: number }[] = [
  { fecha: '2026-05-05', monto: 230_000 },
  { fecha: '2026-06-05', monto: 400_000 },
  { fecha: '2026-07-07', monto: 872_542 },
  { fecha: '2026-08-05', monto: 870_000 },
  { fecha: '2026-09-05', monto: 870_000 },
  { fecha: '2026-10-05', monto: 870_000 },
  { fecha: '2026-11-05', monto: 870_000 },
  { fecha: '2026-12-05', monto: 870_000 },
  // 2027: 870.000 mensuales de enero a junio y 411.695 el 05/07/2027.
]

function porMes(filas: { fecha: string; monto: number }[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const f of filas) {
    const mes = Number(f.fecha.slice(5, 7))
    m.set(mes, (m.get(mes) ?? 0) + f.monto)
  }
  return m
}

async function aplicarFila(nombre: string, objetivo: Map<number, number>): Promise<void> {
  const cat = await prisma.categoria.findFirst({ where: { nombre } })
  if (!cat) throw new Error(`No existe la categoría "${nombre}".`)

  const actuales = new Map(
    (await prisma.valorManual.findMany({ where: { categoriaId: cat.id, anio: 2026 } })).map(
      (v) => [v.mes, v.montoCLP] as const,
    ),
  )

  console.log(`\n${nombre}  [${cat.grupo}]`)
  console.log('  mes        Excel        tabla         dif')
  console.log('  ' + '─'.repeat(44))

  for (let mes = 1; mes <= 12; mes += 1) {
    const antes = actuales.get(mes) ?? 0
    const despues = objetivo.get(mes) ?? 0
    if (antes === 0 && despues === 0) continue
    const dif = despues - antes
    console.log(
      `  ${(MESES_CORTOS[mes - 1] ?? '').padEnd(5)}${fmt(antes).padStart(12)}${fmt(despues).padStart(13)}` +
        `${(dif === 0 ? '·' : (dif > 0 ? '+' : '') + fmt(dif)).padStart(12)}`,
    )
    if (firme && dif !== 0) {
      await prisma.valorManual.upsert({
        where: { categoriaId_anio_mes: { categoriaId: cat.id, anio: 2026, mes } },
        create: { categoriaId: cat.id, anio: 2026, mes, montoCLP: despues, origen: 'banco' },
        update: { montoCLP: despues, origen: 'banco' },
      })
    }
  }
}

/**
 * Deja conciliados los movimientos bancarios de la linea contra la fila que les
 * corresponde. No suman al ValorManual: ese ya quedo con el monto de la tabla, y
 * sumarlos otra vez contaria el giro dos veces.
 */
async function conciliar(glosa: string, nombreFila: string, nota: string): Promise<number> {
  const cat = await prisma.categoria.findFirst({ where: { nombre: nombreFila } })
  if (!cat) throw new Error(`No existe la categoría "${nombreFila}".`)

  const movs = await prisma.movimientoBancario.findMany({
    where: { estadoConciliacion: 'sin_conciliar', descripcion: { contains: glosa } },
    orderBy: { fecha: 'asc' },
  })
  for (const m of movs) {
    console.log(
      `  ${m.fecha.toISOString().slice(0, 10)}${fmt(m.monto).padStart(13)}   ${m.descripcion}`,
    )
    if (firme) {
      await prisma.movimientoBancario.update({
        where: { id: m.id },
        data: {
          estadoConciliacion: 'conciliado',
          viaConciliacion: 'manual',
          categoriaManualId: cat.id,
          esReversa: false,
          notaConciliacion: nota,
        },
      })
    }
  }
  return movs.length
}

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  await aplicarFila(FILA_GIROS, porMes(GIROS))
  await aplicarFila(FILA_CUOTAS, porMes(CUOTAS))

  console.log('\nMovimientos bancarios de la línea:')
  const giros = await conciliar('Transf. MAXXA', FILA_GIROS, 'giro de la línea Fogape Maxxa')
  const cuotas = await conciliar(
    'PENTA HIPOTECARIO',
    FILA_CUOTAS,
    'cuota Fogape Maxxa (Penta Hipotecario es su razón social)',
  )
  console.log(`  ${giros} giros y ${cuotas} cuotas.`)

  if (!firme) console.log('\nSIMULACIÓN: nada escrito.')
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
