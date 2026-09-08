/**
 * Muestra cómo cambia el flujo al usar las ventas reales del SII en vez de las de
 * la planilla.
 *
 *   npm run comparar-ventas
 *
 * No escribe nada: calcula el flujo como queda ahora y lo compara contra el mismo
 * cálculo tomando solo el ValorManual.
 */

import { PrismaClient } from '@prisma/client'
import { calcularFlujo } from '../src/lib/flujo'

import { MESES_CORTOS, NUMEROS_MES, ANIO_ACTIVO } from '../src/lib/dominio'

const prisma = new PrismaClient()

const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)
const izq = (t: string, a: number): string => (t.length > a ? t.slice(0, a - 1) + '…' : t.padEnd(a))
const der = (t: string, a: number): string => (t.length > a ? t.slice(0, a) : t.padStart(a))
const raya = (n = 92): string => '─'.repeat(n)

async function main(): Promise<void> {
  const anio = ANIO_ACTIVO
  const flujo = await calcularFlujo(anio)

  const ventas = flujo.filas.find((f) => f.etiqueta === 'Ventas del mes')
  const economico = flujo.filas.find((f) => f.clave === 'flujo_economico')
  const financiero = flujo.filas.find((f) => f.clave === 'flujo_financiero')
  const saldo = flujo.filas.find((f) => f.clave === 'saldo_inicial')
  if (!ventas || !economico || !financiero || !saldo) throw new Error('No se encontraron las filas.')

  // Lo que decía la planilla, para el antes.
  const manual = await prisma.valorManual.findMany({
    where: { anio, categoria: { nombre: 'Ventas del mes' } },
  })
  const planilla = new Map(manual.map((v) => [v.mes, v.montoCLP]))

  // El flujo financiero recalculado con las ventas de la planilla: el delta de
  // ventas de cada mes se arrastra hacia adelante, igual que en el flujo real.
  const financieroAntes: number[] = []
  let arrastre = 0
  for (const mes of NUMEROS_MES) {
    const i = mes - 1
    arrastre += (planilla.get(mes) ?? 0) - (ventas.montos[i] ?? 0)
    financieroAntes.push((financiero.montos[i] ?? 0) + arrastre)
  }

  console.log('\n' + '═'.repeat(92))
  console.log(`FILA "VENTAS DEL MES": PLANILLA vs SII — ${anio}`)
  console.log('═'.repeat(92))
  console.log(
    izq('Mes', 6) + ' │ ' + izq('Origen', 8) + ' │ ' + der('Planilla', 15) + ' │ ' +
      der('En el flujo', 15) + ' │ ' + der('Diferencia', 14),
  )
  console.log(raya())
  for (const mes of NUMEROS_MES) {
    const i = mes - 1
    const p = planilla.get(mes) ?? 0
    const v = ventas.montos[i] ?? 0
    const origen = ventas.origenPorMes?.[i] ?? 'manual'
    console.log(
      izq(MESES_CORTOS[i] ?? '', 6) + ' │ ' + izq(origen === 'sii' ? 'SII' : 'planilla', 8) + ' │ ' +
        der(fmt(p), 15) + ' │ ' + der(fmt(v), 15) + ' │ ' +
        der(v - p === 0 ? '—' : fmt(v - p), 14),
    )
  }
  console.log(raya())
  const totalPlanilla = [...planilla.values()].reduce((a, b) => a + b, 0)
  console.log(
    izq('Total', 6) + ' │ ' + izq('', 8) + ' │ ' + der(fmt(totalPlanilla), 15) + ' │ ' +
      der(fmt(ventas.total), 15) + ' │ ' + der(fmt(ventas.total - totalPlanilla), 14),
  )

  console.log('\n' + '═'.repeat(92))
  console.log('EFECTO EN EL FLUJO DE CAJA FINANCIERO')
  console.log('═'.repeat(92))
  console.log(
    izq('Mes', 6) + ' │ ' + der('Antes (planilla)', 18) + ' │ ' + der('Ahora (SII)', 18) + ' │ ' +
      der('Diferencia', 15),
  )
  console.log(raya())
  for (const mes of NUMEROS_MES) {
    const i = mes - 1
    const antes = financieroAntes[i] ?? 0
    const ahora = financiero.montos[i] ?? 0
    console.log(
      izq(MESES_CORTOS[i] ?? '', 6) + ' │ ' + der(fmt(antes), 18) + ' │ ' + der(fmt(ahora), 18) +
        ' │ ' + der(fmt(ahora - antes), 15),
    )
  }

  console.log('\n' + '═'.repeat(92))
  console.log('DE DÓNDE SALE CADA MES')
  console.log('═'.repeat(92))
  const porMes = await prisma.documentoVenta.groupBy({
    by: ['mes'],
    where: { anio },
    _count: { _all: true },
  })
  const docs = new Map(porMes.map((d) => [d.mes, d._count._all]))
  const conSII = NUMEROS_MES.filter((m) => (docs.get(m) ?? 0) > 0)
  const sinSII = NUMEROS_MES.filter((m) => (docs.get(m) ?? 0) === 0)
  console.log(
    `  Del SII       : ${conSII.map((m) => MESES_CORTOS[m - 1]).join(' ')} ` +
      `(${conSII.reduce((a, m) => a + (docs.get(m) ?? 0), 0)} documentos)`,
  )
  console.log(
    `  De la planilla: ${sinSII.map((m) => MESES_CORTOS[m - 1]).join(' ')} — proyectados, sin facturar todavía`,
  )

  // Un cierre útil: dónde quedan las notas de crédito que corrigen otro mes.
  const notasCruzadas = await prisma.documentoVenta.findMany({
    where: { anio, tipoDocumento: 61 },
  })
  const referencias = await prisma.documentoVenta.findMany({
    where: { anio, tipoDocumento: { in: [33, 34] } },
    select: { tipoDocumento: true, folio: true, mes: true },
  })
  const mapaRef = new Map(referencias.map((r) => [`${r.tipoDocumento}|${r.folio}`, r.mes]))
  const cruzadas = notasCruzadas.filter((n) => {
    const m = mapaRef.get(`${n.tipoReferencia}|${n.folioReferencia}`)
    return m !== undefined && m !== n.mes
  })
  if (cruzadas.length > 0) {
    console.log('\n  Notas de crédito que corrigen un mes distinto:')
    for (const n of cruzadas) {
      const mesRef = mapaRef.get(`${n.tipoReferencia}|${n.folioReferencia}`)
      console.log(
        `    folio ${n.folio} en ${MESES_CORTOS[n.mes - 1]} por ${fmt(n.montoTotal)}, ` +
          `anula un documento de ${MESES_CORTOS[(mesRef ?? 1) - 1]}. La venta quedó contada en ` +
          `${MESES_CORTOS[(mesRef ?? 1) - 1]} y el descuento cae en ${MESES_CORTOS[n.mes - 1]}.`,
      )
    }
    console.log(
      `    Con el signo del SII el año cierra correcto; lo que cambia es en qué mes pega el ajuste.`,
    )
  }
  console.log(`\n  ${sinSII.length} meses siguen proyectados. Nada se escribió en la base.`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
