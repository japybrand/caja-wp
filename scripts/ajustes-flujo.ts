/**
 * Cuatro ajustes al flujo, todos con el banco como fuente.
 *
 *   npm run ajustes-flujo            (simulacion)
 *   npm run ajustes-flujo -- --firme
 *
 *  1. Saldo inicial de enero: la planilla traia 0, la cartola dice 2.689.881.
 *  2. Fila nueva "Ingresos no facturados" para el hosting de Alvaro Ramiro.
 *  3. Los dos cargos de RC Ingenieria al acuerdo de pago, y renombrar la fila.
 *  4. Nada con SyT SpA: es otro RUT y lo revisa el usuario.
 *
 * Todo lo que escribe queda con origen "banco", asi que reimportar el Excel no lo
 * pisa.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

/**
 * Saldo de la cuenta corriente al 1 de enero de 2026.
 *
 * Sale de la cabecera de la cartola de enero, cuyo periodo es 30/12/2025-30/01/2026.
 * Entre el 30/12 y el 01/01 no hay movimientos —el primero es del 02/01— asi que el
 * saldo de apertura de la cartola es tambien el saldo al 1 de enero. La cadena de
 * saldos de las nueve cartolas calza una con otra.
 */
const SALDO_INICIAL_ENERO = 2_689_881

/**
 * Fila nueva para ingresos que no pasan por el SII.
 *
 * No puede ir en "Ventas del mes": esa fila la pisa el Registro de Ventas en todo
 * mes que tenga documentos, y de enero a septiembre los tienen todos. Lo que se
 * escribiera ahi desapareceria en el siguiente calculo del flujo, sin error visible.
 */
const FILA_NO_FACTURADOS = 'Ingresos no facturados'

/** Hosting mensual de Alvaro Ramiro, cobrado por transferencia y sin factura. */
const GLOSA_ALVARO = 'Alvaro Ramiro'

const FILA_RC_VIEJA = 'BRC - acuerdo de pago'
const FILA_RC_NUEVA = 'RC Ingeniería - acuerdo de pago'
const GLOSA_RC = 'RC INGENIER'

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  // ── 1. Saldo inicial ───────────────────────────────────────────────────────
  console.log('1. SALDO INICIAL DE ENERO')
  const catSaldo = await prisma.categoria.findFirst({ where: { grupo: 'saldo_inicial' } })
  if (!catSaldo) throw new Error('No existe la fila de saldo inicial.')
  const saldoActual = await prisma.valorManual.findUnique({
    where: { categoriaId_anio_mes: { categoriaId: catSaldo.id, anio: 2026, mes: 1 } },
  })
  console.log(`   ${fmt(saldoActual?.montoCLP ?? 0)} → ${fmt(SALDO_INICIAL_ENERO)}  (cartola de enero)`)
  if (firme) {
    await prisma.valorManual.upsert({
      where: { categoriaId_anio_mes: { categoriaId: catSaldo.id, anio: 2026, mes: 1 } },
      create: {
        categoriaId: catSaldo.id,
        anio: 2026,
        mes: 1,
        montoCLP: SALDO_INICIAL_ENERO,
        origen: 'banco',
      },
      update: { montoCLP: SALDO_INICIAL_ENERO, origen: 'banco' },
    })
  }

  // ── 2. Ingresos no facturados ──────────────────────────────────────────────
  console.log('\n2. INGRESOS NO FACTURADOS')
  let catIngresos = await prisma.categoria.findFirst({ where: { nombre: FILA_NO_FACTURADOS } })
  if (!catIngresos) {
    console.log(`   Crear fila "${FILA_NO_FACTURADOS}" en ingresos, orden 2, manual`)
    if (firme) {
      catIngresos = await prisma.categoria.create({
        data: {
          nombre: FILA_NO_FACTURADOS,
          grupo: 'ingresos',
          orden: 2,
          esManual: true,
          nota:
            'Ingresos cobrados sin factura, así que el Registro de Ventas del SII no los ' +
            'cuenta. Va aparte de "Ventas del mes" porque esa fila la pisa el SII en todo ' +
            'mes con documentos.',
        },
      })
    }
  } else {
    console.log(`   La fila "${FILA_NO_FACTURADOS}" ya existe`)
  }

  const alvaro = await prisma.movimientoBancario.findMany({
    where: { estadoConciliacion: 'sin_conciliar', descripcion: { contains: GLOSA_ALVARO } },
    orderBy: { fecha: 'asc' },
  })
  const porMesAlvaro = new Map<number, { total: number; ids: string[] }>()
  for (const m of alvaro) {
    const e = porMesAlvaro.get(m.mes) ?? { total: 0, ids: [] }
    // Fila de ingresos: el abono entra con su signo, o sea suma.
    e.total += m.monto
    e.ids.push(m.id)
    porMesAlvaro.set(m.mes, e)
  }
  console.log(`   Álvaro Ramiro, hosting mensual: ${alvaro.length} abonos`)
  for (const [mes, e] of [...porMesAlvaro].sort((a, b) => a[0] - b[0])) {
    console.log(`     mes ${String(mes).padStart(2)}  ${fmt(e.total).padStart(7)}${e.ids.length > 1 ? `  (${e.ids.length} cobros)` : ''}`)
  }

  if (firme && catIngresos) {
    for (const [mes, e] of porMesAlvaro) {
      await prisma.valorManual.upsert({
        where: { categoriaId_anio_mes: { categoriaId: catIngresos.id, anio: 2026, mes } },
        create: { categoriaId: catIngresos.id, anio: 2026, mes, montoCLP: e.total, origen: 'banco' },
        update: { montoCLP: e.total, origen: 'banco' },
      })
      await prisma.movimientoBancario.updateMany({
        where: { id: { in: e.ids } },
        data: {
          estadoConciliacion: 'conciliado',
          viaConciliacion: 'manual',
          categoriaManualId: catIngresos.id,
          esReversa: false,
          notaConciliacion: 'hosting mensual de Álvaro Ramiro, cobrado sin factura',
        },
      })
    }
  }

  // ── 3. RC Ingeniería ───────────────────────────────────────────────────────
  console.log('\n3. RC INGENIERÍA, ACUERDO DE PAGO')
  const catRC =
    (await prisma.categoria.findFirst({ where: { nombre: FILA_RC_NUEVA } })) ??
    (await prisma.categoria.findFirst({ where: { nombre: FILA_RC_VIEJA } }))
  if (!catRC) throw new Error(`No existe la fila "${FILA_RC_VIEJA}".`)

  if (catRC.nombre !== FILA_RC_NUEVA) {
    console.log(`   Renombrar "${catRC.nombre}" → "${FILA_RC_NUEVA}"`)
    if (firme) {
      await prisma.categoria.update({
        where: { id: catRC.id },
        data: {
          nombre: FILA_RC_NUEVA,
          nota:
            'RC Ingeniería Eléctrica y Construcción SpA, RUT 76.495.359-2. También es ' +
            'cliente: sus abonos son cobros de factura y no tienen relación con esta fila.',
        },
      })
    }
  }

  const cargosRC = await prisma.movimientoBancario.findMany({
    where: { estadoConciliacion: 'sin_conciliar', descripcion: { contains: GLOSA_RC }, monto: { lt: 0 } },
    orderBy: { fecha: 'asc' },
  })
  const valoresRC = new Map(
    (await prisma.valorManual.findMany({ where: { categoriaId: catRC.id, anio: 2026 } })).map(
      (v) => [v.mes, v.montoCLP] as const,
    ),
  )
  for (const m of cargosRC) {
    console.log(
      `   ${m.fecha.toISOString().slice(0, 10)}  ${fmt(-m.monto).padStart(9)}  ` +
        `Excel ${fmt(valoresRC.get(m.mes) ?? 0)}`,
    )
    if (firme) {
      await prisma.valorManual.upsert({
        where: { categoriaId_anio_mes: { categoriaId: catRC.id, anio: 2026, mes: m.mes } },
        create: { categoriaId: catRC.id, anio: 2026, mes: m.mes, montoCLP: -m.monto, origen: 'banco' },
        update: { montoCLP: -m.monto, origen: 'banco' },
      })
      await prisma.movimientoBancario.update({
        where: { id: m.id },
        data: {
          estadoConciliacion: 'conciliado',
          viaConciliacion: 'manual',
          categoriaManualId: catRC.id,
          esReversa: false,
          notaConciliacion: 'cuota del acuerdo de pago con RC Ingeniería',
        },
      })
    }
  }
  const sep = valoresRC.get(9) ?? 0
  console.log(
    `   Septiembre: ${fmt(sep)} queda proyectado. Pagan alrededor del 10 y la cartola ` +
      `provisoria corta el 8.`,
  )

  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito.')
    return
  }
  const quedan = await prisma.movimientoBancario.count({
    where: { estadoConciliacion: 'sin_conciliar' },
  })
  console.log(`\nLISTO. Bandeja: ${quedan}`)
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
