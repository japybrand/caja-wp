/**
 * Resuelve los pagos directos de giros F21 a la Tesoreria, de febrero a julio de
 * 2026.
 *
 *   npm run resolver-tgr-f21            (simulacion)
 *   npm run resolver-tgr-f21 -- --firme
 *
 * Son anteriores a los cuatro convenios: el primero se activo el 07/05/2026 y su
 * primera cuota es de septiembre. Todo lo pagado antes son giros F21 pagados
 * directo, no cuotas.
 *
 * Van a la misma fila que las cuotas porque contablemente es la misma deuda con la
 * Tesoreria; lo que los separa es la nota de cada movimiento. Sin esa marca, dentro
 * de seis meses nadie podria distinguir un pago directo de una cuota mirando el
 * flujo.
 *
 * MAYO ES EL PIE INICIAL, NO UN PAGO SUELTO
 * El cargo del 08/05 por 771.640 activo el convenio 100309 el 07/05, y el Excel ya
 * lo tenia anotado en "TGR pie inicial" con 771.495. Por eso ese mes va a esa fila
 * y no a la de convenio.
 *
 * SEPTIEMBRE QUEDA FUERA
 * El cargo del 07/09 por 257.342 es posterior a la activacion del convenio 257782
 * (04/09) y probablemente es su pie inicial. Como no esta confirmado, se queda en
 * la bandeja en vez de inventarle destino.
 */

import { PrismaClient } from '@prisma/client'
import { MESES_CORTOS } from '../src/lib/dominio'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(n)

/** Meses que cubre esta resolucion. Septiembre queda fuera a proposito. */
const MESES = [2, 3, 4, 5, 6, 7]

/** El pie inicial del convenio 100309 tiene fila propia en el Excel. */
const FILA_POR_MES: Record<number, string> = {
  5: 'TGR pie inicial',
}
const FILA_POR_DEFECTO = 'TGR convenio'

const NOTA = 'pago directo de giros F21, anterior a los convenios'

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  const cargos = await prisma.movimientoBancario.findMany({
    where: {
      anio: 2026,
      mes: { in: MESES },
      descripcion: { contains: 'T.G.R.' },
      estadoConciliacion: 'sin_conciliar',
    },
    orderBy: { fecha: 'asc' },
  })

  const filas = new Map<string, { id: string; nombre: string }>()
  for (const nombre of [...new Set([...Object.values(FILA_POR_MES), FILA_POR_DEFECTO])]) {
    const c = await prisma.categoria.findFirst({ where: { nombre } })
    if (!c) throw new Error(`No existe la fila "${nombre}".`)
    filas.set(nombre, { id: c.id, nombre })
  }

  const porMes = new Map<number, { total: number; ids: string[] }>()
  for (const c of cargos) {
    const e = porMes.get(c.mes) ?? { total: 0, ids: [] }
    // Son cargos, o sea negativos; en una fila de egreso entran en positivo.
    e.total += -c.monto
    e.ids.push(c.id)
    porMes.set(c.mes, e)
  }

  console.log('Mes  cargos      banco       fila                 Excel        queda')
  console.log('─'.repeat(78))

  let totalAplicado = 0
  for (const [mes, e] of [...porMes.entries()].sort((a, b) => a[0] - b[0])) {
    const nombreFila = FILA_POR_MES[mes] ?? FILA_POR_DEFECTO
    const fila = filas.get(nombreFila)
    if (!fila) continue

    const actual = await prisma.valorManual.findUnique({
      where: { categoriaId_anio_mes: { categoriaId: fila.id, anio: 2026, mes } },
    })
    const antes = actual?.montoCLP ?? 0

    console.log(
      `${(MESES_CORTOS[mes - 1] ?? '').padEnd(5)}${String(e.ids.length).padStart(2)}  ` +
        `${fmt(e.total).padStart(11)}  ${nombreFila.padEnd(18)}  ${fmt(antes).padStart(11)}  ` +
        `${fmt(e.total).padStart(11)}${antes === 0 ? '   (la planilla no traía nada)' : antes === e.total ? '   (ya coincidía)' : ''}`,
    )
    totalAplicado += e.total

    if (!firme) continue

    // Reemplaza, no suma: el banco manda sobre la proyeccion de la planilla.
    await prisma.valorManual.upsert({
      where: { categoriaId_anio_mes: { categoriaId: fila.id, anio: 2026, mes } },
      create: { categoriaId: fila.id, anio: 2026, mes, montoCLP: e.total, origen: 'banco' },
      update: { montoCLP: e.total, origen: 'banco' },
    })
    await prisma.movimientoBancario.updateMany({
      where: { id: { in: e.ids } },
      data: {
        estadoConciliacion: 'conciliado',
        viaConciliacion: 'manual',
        categoriaManualId: fila.id,
        esReversa: false,
        notaConciliacion: `${NOTA} · ${nombreFila}`,
      },
    })
  }

  console.log('─'.repeat(78))
  console.log(`${cargos.length} cargos · ${fmt(totalAplicado)}`)

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
