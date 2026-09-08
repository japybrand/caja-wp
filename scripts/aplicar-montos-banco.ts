/**
 * Reemplaza los montos proyectados del Excel por lo que realmente salió del banco.
 *
 *   npm run aplicar-banco            (simulación, no escribe)
 *   npm run aplicar-banco -- --firme
 *
 * Los montos del Excel eran una proyección anual armada al empezar el año: por eso
 * 24 de 39 proveedores repiten uno o dos valores en 12 meses (Verpex 233.511 los
 * doce, Microsoft Office 8.490 los doce). Son suscripciones en dólares pagadas con
 * tarjeta chilena, así que el cargo real varía con el tipo de cambio.
 *
 * Solo se tocan los meses que tienen cartola. Octubre a diciembre siguen siendo
 * proyección, que es lo único que hay para esos meses.
 */

import { PrismaClient } from '@prisma/client'
import { leerRemitentes } from '../src/lib/dominio'
import { buscarProveedor } from '../src/lib/banco/glosa'
import { MESES_CORTOS, ANIO_ACTIVO } from '../src/lib/dominio'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')

const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)
const izq = (t: string, a: number): string => (t.length > a ? t.slice(0, a - 1) + '…' : t.padEnd(a))
const der = (t: string, a: number): string => (t.length > a ? t.slice(0, a) : t.padStart(a))

/**
 * Glosas que NO deben alimentar el monto de un proveedor aunque el nombre calce:
 * son traspasos o reglas propias, no el gasto del proveedor.
 */
const GLOSAS_EXCLUIDAS = ['Transf a Japybrand SPA', 'Transf a MOLINA OVALLE']

interface Cambio {
  proveedor: string
  categoria: string
  mes: number
  movimientoId: string
  antes: number
  ahora: number
  cargos: number
}

async function main(): Promise<void> {
  console.log(
    firme
      ? 'MODO FIRME: se van a actualizar montos de movimientos existentes.\n'
      : 'MODO SIMULACIÓN: no se escribe nada. Usa --firme para aplicar.\n',
  )

  const [proveedores, bancarios, movimientos] = await Promise.all([
    prisma.proveedor.findMany({ include: { categoria: { select: { nombre: true } } } }),
    prisma.movimientoBancario.findMany({ where: { anio: ANIO_ACTIVO, monto: { lt: 0 } } }),
    prisma.movimiento.findMany({
      where: { anio: ANIO_ACTIVO, fuente: 'excel', proveedorId: { not: null } },
      include: { proveedor: { select: { nombre: true } }, categoria: { select: { nombre: true } } },
    }),
  ])

  const conAlias = proveedores.map((p) => ({ ...p, alias: leerRemitentes(p.aliasBancarios) }))
  const mesesConCartola = new Set(bancarios.map((b) => b.mes))

  // proveedorId|mes -> { suma, cargos }
  const real = new Map<string, { suma: number; cargos: number }>()
  let sinProveedor = 0
  for (const b of bancarios) {
    if (GLOSAS_EXCLUIDAS.some((g) => b.descripcion.includes(g))) continue
    const calce = buscarProveedor(b.descripcion, conAlias)
    if (!calce) {
      sinProveedor += 1
      continue
    }
    const clave = `${calce.proveedor.id}|${b.mes}`
    const e = real.get(clave) ?? { suma: 0, cargos: 0 }
    e.suma += Math.abs(b.monto)
    e.cargos += 1
    real.set(clave, e)
  }

  const cambios: Cambio[] = []
  const sinCambio: string[] = []
  for (const m of movimientos) {
    if (!mesesConCartola.has(m.mes)) continue
    const e = real.get(`${m.proveedorId}|${m.mes}`)
    if (!e) continue
    if (e.suma === m.montoCLP) {
      sinCambio.push(`${m.proveedor?.nombre} ${MESES_CORTOS[m.mes - 1]}`)
      continue
    }
    cambios.push({
      proveedor: m.proveedor?.nombre ?? '—',
      categoria: m.categoria.nombre,
      mes: m.mes,
      movimientoId: m.id,
      antes: m.montoCLP,
      ahora: e.suma,
      cargos: e.cargos,
    })
  }

  // Cargos del banco de un proveedor que NO tiene movimiento del Excel ese mes.
  const claveConMovimiento = new Set(movimientos.map((m) => `${m.proveedorId}|${m.mes}`))
  const faltantes = [...real.entries()]
    .filter(([clave]) => !claveConMovimiento.has(clave) && mesesConCartola.has(Number(clave.split('|')[1])))
    .map(([clave, e]) => {
      const [provId, mes] = clave.split('|') as [string, string]
      const p = proveedores.find((x) => x.id === provId)
      return { proveedor: p?.nombre ?? '—', mes: Number(mes), suma: e.suma, cargos: e.cargos }
    })
    .sort((a, b) => b.suma - a.suma)

  // ------------------------------------------------------------------ reporte
  console.log('═'.repeat(96))
  console.log('MONTOS QUE CAMBIAN')
  console.log('═'.repeat(96))
  console.log(
    izq('Proveedor', 24) + izq('Categoría', 20) + der('Mes', 5) + der('Cargos', 7) +
      der('Proyectado', 14) + der('Real', 14) + der('Δ', 13),
  )
  console.log('─'.repeat(96))
  const ordenados = [...cambios].sort(
    (a, b) => a.proveedor.localeCompare(b.proveedor, 'es') || a.mes - b.mes,
  )
  let previo = ''
  for (const c of ordenados) {
    console.log(
      izq(c.proveedor === previo ? '' : c.proveedor, 24) + izq(c.proveedor === previo ? '' : c.categoria, 20) +
        der(MESES_CORTOS[c.mes - 1] ?? '', 5) + der(String(c.cargos), 7) + der(fmt(c.antes), 14) +
        der(fmt(c.ahora), 14) + der(fmt(c.ahora - c.antes), 13),
    )
    previo = c.proveedor
  }
  console.log('─'.repeat(96))
  const delta = cambios.reduce((a, c) => a + (c.ahora - c.antes), 0)
  console.log(
    `  ${cambios.length} movimientos cambian · ${sinCambio.length} ya coincidían · ` +
      `efecto neto en egresos: ${fmt(delta)}`,
  )

  // Efecto por mes, que es lo que mueve el flujo.
  const porMes = new Map<number, number>()
  for (const c of cambios) porMes.set(c.mes, (porMes.get(c.mes) ?? 0) + (c.ahora - c.antes))
  console.log('\n  Efecto por mes en el flujo (un egreso mayor baja el flujo):')
  console.log('  ' + izq('Mes', 8) + der('Δ egresos', 15) + der('Efecto en el flujo', 22))
  console.log('  ' + '─'.repeat(45))
  for (const mes of [...porMes.keys()].sort((a, b) => a - b)) {
    const d = porMes.get(mes) ?? 0
    console.log('  ' + izq(MESES_CORTOS[mes - 1] ?? '', 8) + der(fmt(d), 15) + der(fmt(-d), 22))
  }

  if (faltantes.length > 0) {
    console.log('\n' + '═'.repeat(96))
    console.log(`CARGOS DEL BANCO SIN MOVIMIENTO EN EL EXCEL (${faltantes.length})`)
    console.log('  NO se crean: solo se informan. Crearlos es una decisión aparte.')
    console.log('═'.repeat(96))
    console.log('  ' + izq('Proveedor', 26) + der('Mes', 5) + der('Cargos', 8) + der('Monto', 14))
    console.log('  ' + '─'.repeat(53))
    for (const f of faltantes.slice(0, 20)) {
      console.log(
        '  ' + izq(f.proveedor, 26) + der(MESES_CORTOS[f.mes - 1] ?? '', 5) + der(String(f.cargos), 8) +
          der(fmt(f.suma), 14),
      )
    }
    if (faltantes.length > 20) console.log(`  … y ${faltantes.length - 20} más`)
    console.log(`\n  Suman ${fmt(faltantes.reduce((a, f) => a + f.suma, 0))}.`)
  }

  console.log('\n' + '═'.repeat(96))
  console.log('LO QUE NO SE TOCA')
  console.log('═'.repeat(96))
  console.log(
    `  Meses sin cartola (${[...Array(12).keys()]
      .map((i) => i + 1)
      .filter((m) => !mesesConCartola.has(m))
      .map((m) => MESES_CORTOS[m - 1])
      .join(' ')}): siguen con la proyección, que es lo único que hay.`,
  )
  console.log(`  ${sinProveedor} cargos del banco sin proveedor identificado: no alimentan ningún monto.`)
  console.log('  Los movimientos de Gmail, manuales y de retiros no se tocan: solo los de fuente "excel".')

  if (!firme) {
    console.log('\n' + '═'.repeat(96))
    console.log(`SIMULACIÓN: ${cambios.length} movimientos cambiarían. Nada escrito.`)
    console.log('Para aplicar:  npm run aplicar-banco -- --firme')
    console.log('═'.repeat(96))
    return
  }

  const LOTE = 50
  for (let i = 0; i < cambios.length; i += LOTE) {
    await prisma.$transaction(
      cambios.slice(i, i + LOTE).map((c) =>
        prisma.movimiento.update({
          where: { id: c.movimientoId },
          data: {
            montoCLP: c.ahora,
            fuente: 'cartola',
            descripcion: `${c.proveedor} · ${c.cargos} ${c.cargos === 1 ? 'cargo' : 'cargos'} del banco`,
          },
        }),
      ),
    )
  }

  console.log('\n' + '═'.repeat(96))
  console.log(`LISTO: ${cambios.length} movimientos actualizados con el monto real del banco.`)
  console.log(`  Pasaron a fuente "cartola". Los de fuente "excel" que quedan son los meses proyectados.`)
  console.log('═'.repeat(96))
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
