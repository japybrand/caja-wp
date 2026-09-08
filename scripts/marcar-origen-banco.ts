/**
 * Marca con origen "banco" los valores manuales que ya venian de la cartola.
 *
 *   npm run marcar-origen-banco            (simulacion)
 *   npm run marcar-origen-banco -- --firme
 *
 * Es una correccion de una sola vez: el campo `origen` se agrego despues de que
 * varios scripts ya hubieran escrito valores desde el banco, y esos quedaron
 * marcados como "excel". Sin corregirlos, el proximo `npm run importar` los
 * pisaria con la proyeccion de la planilla.
 *
 * La regla no es una lista a mano: un valor viene del banco si hay un movimiento
 * bancario conciliado apuntando a esa fila en ese mes. Asi la marca se mantiene
 * sola aunque cambien los scripts.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')

/**
 * Casos que la regla no alcanza porque no tienen movimiento bancario asociado.
 *
 *  - El saldo inicial sale de la cabecera de la cartola, no de una transaccion.
 *  - Los ceros de agosto en las dos filas de TGR son una correccion: el Excel
 *    anotaba el embargo dos veces y esas filas se vaciaron. Si el importador las
 *    repone, vuelve el doble conteo.
 */
const EXTRA: { categoria: string; meses: number[] }[] = [
  { categoria: 'Saldo Inicial', meses: [1] },
  { categoria: 'TGR convenio', meses: [8] },
  { categoria: 'TGR pie inicial', meses: [8] },
]

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  const pares = new Map<string, { categoriaId: string; nombre: string; mes: number }>()

  const bancarios = await prisma.movimientoBancario.findMany({
    where: { estadoConciliacion: 'conciliado', categoriaManualId: { not: null }, anio: 2026 },
    select: { categoriaManualId: true, mes: true, categoriaManual: { select: { nombre: true } } },
  })
  for (const b of bancarios) {
    if (!b.categoriaManualId) continue
    pares.set(`${b.categoriaManualId}|${b.mes}`, {
      categoriaId: b.categoriaManualId,
      nombre: b.categoriaManual?.nombre ?? '?',
      mes: b.mes,
    })
  }

  for (const e of EXTRA) {
    const c = await prisma.categoria.findFirst({ where: { nombre: e.categoria } })
    if (!c) continue
    for (const mes of e.meses) {
      pares.set(`${c.id}|${mes}`, { categoriaId: c.id, nombre: c.nombre, mes })
    }
  }

  const porFila = new Map<string, number[]>()
  let cambiados = 0
  for (const p of pares.values()) {
    const v = await prisma.valorManual.findUnique({
      where: { categoriaId_anio_mes: { categoriaId: p.categoriaId, anio: 2026, mes: p.mes } },
    })
    if (!v || v.origen === 'banco') continue
    const l = porFila.get(p.nombre) ?? []
    l.push(p.mes)
    porFila.set(p.nombre, l)
    cambiados += 1
    if (firme) {
      await prisma.valorManual.update({ where: { id: v.id }, data: { origen: 'banco' } })
    }
  }

  for (const [nombre, meses] of porFila) {
    console.log(`  ${nombre.padEnd(34)} meses ${meses.sort((a, b) => a - b).join(',')}`)
  }
  console.log(`\n${cambiados} valores pasan de "excel" a "banco".`)
  if (!firme) console.log('SIMULACIÓN: nada escrito.')
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
