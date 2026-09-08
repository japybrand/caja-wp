/**
 * Carga las cartolas de Santander en MovimientoBancario.
 *
 *   npm run importar-cartolas -- --simular    (por defecto)
 *   npm run importar-cartolas -- --firme
 *
 * IMPORTANTE: cargar la cartola NO crea ni modifica ningún Movimiento del flujo.
 * Son tablas distintas: MovimientoBancario es lo que dice el banco, Movimiento es
 * lo que entra al flujo. Enlazarlas es trabajo de la conciliación, aparte.
 *
 * Es idempotente por el hash de cada línea.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { leerCarpeta } from '../src/lib/banco/parser'
import { MESES_CORTOS } from '../src/lib/dominio'

const prisma = new PrismaClient()
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARPETA = path.join(RAIZ, 'cartolas')

const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)
const izq = (t: string, a: number): string => (t.length > a ? t.slice(0, a - 1) + '…' : t.padEnd(a))
const der = (t: string, a: number): string => (t.length > a ? t.slice(0, a) : t.padStart(a))

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME: se va a escribir en la base.\n' : 'MODO SIMULACIÓN: no se escribe nada. Usa --firme para aplicar.\n')

  const cartolas = await leerCarpeta(CARPETA)
  const descuadradas = cartolas.filter((c) => !c.cuadra)
  if (descuadradas.length > 0) {
    console.error('Hay cartolas que no cuadran con su cabecera de saldos:')
    for (const c of descuadradas) {
      console.error(`  ${c.archivo}: cargos ${fmt(c.difCargos)} · abonos ${fmt(c.difAbonos)}`)
    }
    console.error('\nNo se importa nada hasta resolverlo.')
    process.exitCode = 1
    return
  }

  const movimientos = cartolas.flatMap((c) =>
    c.movimientos.map((m) => ({
      fecha: m.fecha,
      mes: m.mes,
      anio: m.anio,
      monto: m.monto,
      descripcion: m.descripcion,
      nDocumento: m.nDocumento,
      sucursal: m.sucursal,
      tipo: m.tipo,
      banco: c.banco,
      cuenta: c.cuenta,
      archivoOrigen: c.archivo,
      hash: m.hash,
    })),
  )

  const existentes = new Set(
    (await prisma.movimientoBancario.findMany({ select: { hash: true } })).map((x) => x.hash),
  )
  const nuevos = movimientos.filter((m) => !existentes.has(m.hash))
  const yaEstaban = movimientos.length - nuevos.length

  console.log('═'.repeat(86))
  console.log('CARTOLAS LEÍDAS')
  console.log('═'.repeat(86))
  console.log(
    izq('Archivo', 34) + ' │ ' + der('Mov.', 5) + ' │ ' + der('Cargos', 14) + ' │ ' +
      der('Abonos', 14) + ' │ Cuadra',
  )
  console.log('─'.repeat(86))
  for (const c of cartolas) {
    console.log(
      izq(c.archivo.replace(/-\d+-\d+\.xlsx$/, ''), 34) + ' │ ' + der(String(c.movimientos.length), 5) +
        ' │ ' + der(fmt(c.cargos), 14) + ' │ ' + der(fmt(c.abonos), 14) + ' │ ' + (c.cuadra ? 'sí' : 'NO'),
    )
  }
  console.log('─'.repeat(86))
  console.log(
    `  ${movimientos.length} movimientos · ${nuevos.length} nuevos · ${yaEstaban} ya estaban en la base`,
  )

  // Reparto por mes, para ver qué entra.
  const porMes = new Map<number, { n: number; cargos: number; abonos: number }>()
  for (const m of movimientos) {
    const e = porMes.get(m.mes) ?? { n: 0, cargos: 0, abonos: 0 }
    e.n += 1
    if (m.monto < 0) e.cargos += m.monto
    else e.abonos += m.monto
    porMes.set(m.mes, e)
  }
  console.log('\n' + izq('Mes', 6) + der('Mov.', 6) + der('Cargos', 16) + der('Abonos', 16))
  console.log('─'.repeat(44))
  for (const mes of [...porMes.keys()].sort((a, b) => a - b)) {
    const e = porMes.get(mes)
    if (!e) continue
    console.log(
      izq(MESES_CORTOS[mes - 1] ?? '', 6) + der(String(e.n), 6) + der(fmt(e.cargos), 16) +
        der(fmt(e.abonos), 16),
    )
  }

  console.log('\n' + '═'.repeat(86))
  console.log('LO QUE NO SE TOCA')
  console.log('═'.repeat(86))
  const [movs, movsConf] = await Promise.all([
    prisma.movimiento.count(),
    prisma.movimiento.count({ where: { estado: 'confirmado' } }),
  ])
  console.log(`  Movimiento del flujo: ${movs} (${movsConf} confirmados). Ninguno se crea ni se modifica.`)
  console.log('  Cargar la cartola solo llena MovimientoBancario. Enlazar es trabajo de la conciliación.')

  if (!firme) {
    console.log('\n' + '═'.repeat(86))
    console.log(`SIMULACIÓN: se insertarían ${nuevos.length} movimientos bancarios. Nada escrito.`)
    console.log('Para aplicar:  npm run importar-cartolas -- --firme')
    console.log('═'.repeat(86))
    return
  }

  // Inserción por lotes: 695 filas de una en una es lento en SQLite.
  const LOTE = 100
  let insertados = 0
  for (let i = 0; i < nuevos.length; i += LOTE) {
    const lote = nuevos.slice(i, i + LOTE)
    await prisma.$transaction(lote.map((data) => prisma.movimientoBancario.create({ data })))
    insertados += lote.length
  }

  console.log('\n' + '═'.repeat(86))
  console.log(`LISTO: ${insertados} movimientos bancarios insertados.`)
  console.log(`  Total en la base: ${await prisma.movimientoBancario.count()}`)
  console.log(`  Movimiento del flujo: ${await prisma.movimiento.count()} (sin cambios)`)
  console.log('═'.repeat(86))
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
