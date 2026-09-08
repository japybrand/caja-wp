/**
 * Reparte los pagos de T.G.R. y Previred entre las filas manuales del
 * flujo que les corresponden.
 *
 *   npm run resolver-impuestos            (simulación)
 *   npm run resolver-impuestos -- --firme
 *
 * Un pago del banco puede cubrir más de una fila del Excel: en marzo, un solo
 * pago a Previred de 1.527.823 son 766.551 de cotizaciones más 761.272 de pagos
 * postergados. El reparto queda anotado en la nota de cada movimiento bancario.
 */

import { PrismaClient } from '@prisma/client'
import { MESES_CORTOS } from '../src/lib/dominio'

// La linea Fogape Maxxa NO se resuelve aqui: tiene tabla de desarrollo propia y
// vive en scripts/fogape.ts.

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)
const izq = (t: string, a: number): string => (t.length > a ? t.slice(0, a - 1) + '…' : t.padEnd(a))
const der = (t: string, a: number): string => t.padStart(a)

/** Tolerancia para dar por igual el monto del banco y el del Excel. */
const TOLERANCIA = 0.01

const CASOS: { etiqueta: string; glosa: string; filas: string[] }[] = [
  {
    etiqueta: 'T.G.R.',
    glosa: 'PAGO EN LINEA T.G.R.',
    filas: ['TGR convenio', 'TGR pie inicial'],
  },
  {
    etiqueta: 'Previred',
    glosa: 'PAGO EN LINEA PREVIRED',
    filas: ['Pago de cotizaciones Previred', 'Previred pagos postergados'],
  },
]

function cerca(a: number, b: number): boolean {
  const mayor = Math.max(Math.abs(a), Math.abs(b))
  return mayor > 0 && Math.abs(a - b) / mayor <= TOLERANCIA
}

/**
 * Cómo repartir el monto del banco entre las filas candidatas.
 *
 * 1. Si calza con el total de todas, se reparte proporcional (marzo de Previred).
 * 2. Si calza con UNA sola fila, va entera ahí. Sin esto, febrero de Previred
 *    —829.632, exactamente los pagos postergados— se partiría en dos por el
 *    reparto proporcional y perdería un calce exacto.
 * 3. Si solo una fila tiene monto ese mes, va entera ahí.
 * 4. Si ninguna tiene, va a la primera y queda anotado.
 */
function repartir(banco: number, excel: number[]): { montos: number[]; motivo: string } {
  const suma = excel.reduce((a, b) => a + b, 0)

  if (excel.length === 1) return { montos: [banco], motivo: 'única fila' }

  for (let i = 0; i < excel.length; i += 1) {
    const valor = excel[i] ?? 0
    if (valor > 0 && cerca(banco, valor)) {
      return {
        montos: excel.map((_, j) => (j === i ? banco : 0)),
        motivo: 'calza exacto con una fila',
      }
    }
  }

  if (suma > 0 && cerca(banco, suma)) {
    const montos = excel.map((e) => Math.round((banco * e) / suma))
    const dif = banco - montos.reduce((a, b) => a + b, 0)
    montos[0] = (montos[0] ?? 0) + dif
    return { montos, motivo: 'cubre las dos filas, repartido según el Excel' }
  }

  const conMonto = excel.filter((e) => e > 0).length
  if (conMonto === 1) {
    const i = excel.findIndex((e) => e > 0)
    return {
      montos: excel.map((_, j) => (j === i ? banco : 0)),
      motivo: 'solo una fila tiene monto ese mes',
    }
  }

  if (suma > 0) {
    const montos = excel.map((e) => Math.round((banco * e) / suma))
    const dif = banco - montos.reduce((a, b) => a + b, 0)
    montos[0] = (montos[0] ?? 0) + dif
    return { montos, motivo: 'repartido según la proporción del Excel' }
  }

  return {
    montos: excel.map((_, j) => (j === 0 ? banco : 0)),
    motivo: 'el Excel no registra nada ese mes',
  }
}

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'MODO SIMULACIÓN: usa --firme para aplicar.\n')

  for (const caso of CASOS) {
    const movimientos = await prisma.movimientoBancario.findMany({
      where: { anio: 2026, estadoConciliacion: 'sin_conciliar', descripcion: { contains: caso.glosa } },
      orderBy: { fecha: 'asc' },
    })
    if (movimientos.length === 0) {
      console.log(`\n${caso.etiqueta}: nada pendiente.`)
      continue
    }

    const cats = []
    for (const nombre of caso.filas) {
      const c = await prisma.categoria.findFirst({ where: { nombre } })
      if (!c) throw new Error(`No existe la categoría "${nombre}".`)
      const valores = await prisma.valorManual.findMany({ where: { categoriaId: c.id, anio: 2026 } })
      cats.push({ ...c, porMes: new Map(valores.map((v) => [v.mes, v.montoCLP])) })
    }

    const porMes = new Map<number, { total: number; ids: string[] }>()
    for (const m of movimientos) {
      const e = porMes.get(m.mes) ?? { total: 0, ids: [] }
      // Signo neto: en una fila de egreso el cargo suma; en financiamiento el
      // abono suma. La glosa de cada caso trae siempre el mismo signo.
      e.total += cats[0]?.grupo === 'financiamiento' || cats[0]?.grupo === 'ingresos' ? m.monto : -m.monto
      e.ids.push(m.id)
      porMes.set(m.mes, e)
    }

    console.log(`\n${'═'.repeat(96)}`)
    console.log(`${caso.etiqueta} — glosa "${caso.glosa}" → ${caso.filas.join(' / ')}`)
    console.log('═'.repeat(96))
    console.log(
      izq('Mes', 6) + der('Banco', 13) + caso.filas.map((n) => der(n.slice(0, 20), 22)).join('') + '   Motivo',
    )
    console.log('─'.repeat(96))

    for (const [mes, e] of [...porMes.entries()].sort((a, b) => a[0] - b[0])) {
      const excel = cats.map((c) => c.porMes.get(mes) ?? 0)
      const { montos, motivo } = repartir(e.total, excel)
      console.log(
        izq(MESES_CORTOS[mes - 1] ?? '', 6) + der(fmt(e.total), 13) +
          montos.map((m, i) => der(`${fmt(excel[i] ?? 0)} → ${fmt(m)}`, 22)).join('') + '   ' + motivo,
      )

      if (firme) {
        for (let i = 0; i < cats.length; i += 1) {
          const cat = cats[i]
          const monto = montos[i] ?? 0
          if (!cat || (monto === 0 && (excel[i] ?? 0) === 0)) continue
          await prisma.valorManual.upsert({
            where: { categoriaId_anio_mes: { categoriaId: cat.id, anio: 2026, mes } },
            create: { categoriaId: cat.id, anio: 2026, mes, montoCLP: monto },
            update: { montoCLP: monto },
          })
        }
        const nota =
          `${caso.etiqueta} ${MESES_CORTOS[mes - 1]}: ${fmt(e.total)} → ` +
          cats.map((c, i) => `${c.nombre} ${fmt(montos[i] ?? 0)}`).join(' + ') +
          ` (${motivo})`
        await prisma.movimientoBancario.updateMany({
          where: { id: { in: e.ids } },
          data: {
            estadoConciliacion: 'conciliado',
            viaConciliacion: 'manual',
            categoriaManualId: cats[0]?.id ?? null,
            notaConciliacion: nota,
          },
        })
      }
    }
  }

  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito. Para aplicar: npm run resolver-impuestos -- --firme')
    return
  }
  const quedan = await prisma.movimientoBancario.count({
    where: { anio: 2026, estadoConciliacion: 'sin_conciliar' },
  })
  console.log(`\nLISTO. Sin conciliar: ${quedan}`)
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
