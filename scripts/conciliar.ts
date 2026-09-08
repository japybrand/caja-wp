/**
 * Concilia la cartola contra los movimientos del flujo.
 *
 *   npm run conciliar            (simulación, no escribe)
 *   npm run conciliar -- --firme
 *
 * Ni en firme se crea ni se modifica ningún Movimiento del flujo: lo único que
 * cambia es el estado de conciliación de MovimientoBancario.
 */

import { PrismaClient } from '@prisma/client'
import { simularConciliacion, aplicarConciliacion } from '../src/lib/banco/conciliar'
import { ANIO_ACTIVO, MESES_CORTOS } from '../src/lib/dominio'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)
const izq = (t: string, a: number): string => (t.length > a ? t.slice(0, a - 1) + '…' : t.padEnd(a))
const der = (t: string, a: number): string => (t.length > a ? t.slice(0, a) : t.padStart(a))

async function main(): Promise<void> {
  console.log(
    firme
      ? 'MODO FIRME: se escribe el estado de conciliación.\n'
      : 'MODO SIMULACIÓN: no se escribe nada. Usa --firme para aplicar.\n',
  )

  const r = await simularConciliacion(ANIO_ACTIVO)

  console.log('═'.repeat(84))
  console.log('RESUMEN')
  console.log('═'.repeat(84))
  console.log(`  Movimientos bancarios evaluados : ${r.total}`)
  console.log(`  Se enlazarían a un movimiento   : ${r.enlazados}  (${fmt(r.montoEnlazado)})`)
  console.log(`  Quedarían sin conciliar         : ${r.sinConciliar}  (${fmt(r.montoSinConciliar)})`)
  console.log('\n  Por vía de emparejamiento:')
  for (const [via, n] of Object.entries(r.porVia)) {
    if (n > 0) console.log(`    ${izq(via, 12)} ${n}`)
  }

  console.log('\n' + '═'.repeat(110))
  console.log(`SE ENLAZARÍAN (${r.enlazados})`)
  console.log('═'.repeat(110))
  console.log(
    izq('Fecha', 11) + der('Monto', 13) + '  ' + izq('Glosa del banco', 32) + izq('→ Proveedor', 22) +
      izq('Vía', 9) + 'Movimiento',
  )
  console.log('─'.repeat(110))
  for (const p of r.propuestas.filter((x) => !x.sinConciliar)) {
    console.log(
      izq(p.fecha.toISOString().slice(0, 10), 11) + der(fmt(p.monto), 13) + '  ' +
        izq(p.descripcion, 32) + izq(p.proveedorNombre ?? '—', 22) + izq(p.via, 9) +
        `${fmt(p.movimientoMonto ?? 0)} · ${(p.movimientoDescripcion ?? '').slice(0, 26)}`,
    )
  }

  const sueltas = r.propuestas.filter((x) => x.sinConciliar)
  const conProveedor = sueltas.filter((x) => x.proveedorNombre !== null)
  const sinProveedor = sueltas.filter((x) => x.proveedorNombre === null)

  console.log('\n' + '═'.repeat(110))
  console.log(`SIN CONCILIAR CON PROVEEDOR IDENTIFICADO (${conProveedor.length})`)
  console.log('  Se identificó el proveedor pero no hay un movimiento del flujo al que enlazar.')
  console.log('═'.repeat(110))
  for (const p of conProveedor.slice(0, 30)) {
    console.log(
      izq(p.fecha.toISOString().slice(0, 10), 11) + der(fmt(p.monto), 13) + '  ' +
        izq(p.descripcion, 32) + izq(p.proveedorNombre ?? '', 22) + p.nota.slice(0, 40),
    )
  }
  if (conProveedor.length > 30) console.log(`  … y ${conProveedor.length - 30} más`)

  console.log('\n' + '═'.repeat(110))
  console.log(`SIN PROVEEDOR IDENTIFICADO (${sinProveedor.length})`)
  console.log('═'.repeat(110))
  const porGlosa = new Map<string, { n: number; total: number; nota: string }>()
  for (const p of sinProveedor) {
    const e = porGlosa.get(p.descripcion) ?? { n: 0, total: 0, nota: p.nota }
    e.n += 1
    e.total += p.monto
    porGlosa.set(p.descripcion, e)
  }
  const glosas = [...porGlosa.entries()].sort((a, b) => a[1].total - b[1].total)
  console.log(izq('Glosa', 38) + der('Veces', 6) + der('Total', 15) + '  Motivo')
  console.log('─'.repeat(110))
  for (const [glosa, e] of glosas.slice(0, 30)) {
    console.log(izq(glosa, 38) + der(String(e.n), 6) + der(fmt(e.total), 15) + '  ' + e.nota.slice(0, 44))
  }
  if (glosas.length > 30) console.log(`  … y ${glosas.length - 30} glosas más`)

  console.log('\n' + '═'.repeat(84))
  console.log('LO QUE NO CAMBIA')
  console.log('═'.repeat(84))
  const movs = await prisma.movimiento.count()
  const porMes = new Map<number, number>()
  for (const p of r.propuestas.filter((x) => !x.sinConciliar)) {
    porMes.set(p.mes, (porMes.get(p.mes) ?? 0) + 1)
  }
  console.log(`  Movimiento del flujo: ${movs}. Conciliar ENLAZA, no crea ni modifica ninguno.`)
  console.log(`  Lo único que cambia es el estado de conciliación de MovimientoBancario.`)
  console.log(
    '\n  Enlaces por mes: ' +
      [...porMes.keys()].sort((a, b) => a - b).map((m) => `${MESES_CORTOS[m - 1]} ${porMes.get(m)}`).join(' · '),
  )

  if (!firme) {
    console.log('\n' + '═'.repeat(84))
    console.log('SIMULACIÓN: nada escrito. Para aplicar:  npm run conciliar -- --firme')
    console.log('═'.repeat(84))
    return
  }

  const aplicados = await aplicarConciliacion(r)
  console.log(`\nLISTO: ${aplicados} movimientos bancarios marcados como conciliados.`)
  console.log(`  Movimiento del flujo: ${await prisma.movimiento.count()} (sin cambios)`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
