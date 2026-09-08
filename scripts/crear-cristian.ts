/**
 * Crea el proveedor Cristián Andrés y sus movimientos de remuneración.
 *
 *   npm run crear-cristian            (simulación)
 *   npm run crear-cristian -- --firme
 *
 * Los 7 cargos de "Transf a CRISTIAN ANDRE" se reparten así:
 *   - 2026-01-02, 200.000  -> NO se toca. Queda sin conciliar en la bandeja: no se
 *     sabe a qué corresponde y no se le inventa categoría.
 *   - ene a may (5 cargos) -> remuneración mensual.
 *   - 2026-06-08           -> finiquito. Va marcado en la descripción porque su monto
 *     (1.139.446) está dentro del rango de un sueldo normal, así que sin la marca no
 *     hay forma de distinguirlo y distorsionaría el promedio mensual.
 *
 * El proveedor queda inactivo: salió de la empresa en junio.
 */

import { PrismaClient } from '@prisma/client'
import { MESES_CORTOS, ANIO_ACTIVO } from '../src/lib/dominio'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')

const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)
const der = (t: string, a: number): string => t.padStart(a)

const NOMBRE = 'Cristián Andrés'
const ALIAS = 'Transf a CRISTIAN ANDRE'
const CATEGORIA = 'Pago de nóminas'
/** El cargo que se deja sin conciliar, identificado por fecha y monto. */
const SIN_CONCILIAR = { fecha: '2026-01-02', monto: -200_000 }
const MES_FINIQUITO = 6

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME: se escribe en la base.\n' : 'MODO SIMULACIÓN: no se escribe nada.\n')

  const categoria = await prisma.categoria.findFirst({ where: { nombre: CATEGORIA } })
  if (!categoria) throw new Error(`No existe la categoría "${CATEGORIA}".`)

  const cargos = await prisma.movimientoBancario.findMany({
    where: { anio: ANIO_ACTIVO, descripcion: { contains: 'CRISTIAN ANDRE' } },
    orderBy: { fecha: 'asc' },
  })

  const aCrear = cargos.filter(
    (c) => !(c.fecha.toISOString().slice(0, 10) === SIN_CONCILIAR.fecha && c.monto === SIN_CONCILIAR.monto),
  )
  const dejados = cargos.filter((c) => !aCrear.includes(c))

  console.log('═'.repeat(78))
  console.log('QUÉ SE VA A CREAR')
  console.log('═'.repeat(78))
  console.log('  Fecha        Mes    ' + der('Monto', 13) + '   Concepto')
  console.log('  ' + '─'.repeat(64))
  for (const c of aCrear) {
    const esFiniquito = c.mes === MES_FINIQUITO
    console.log(
      `  ${c.fecha.toISOString().slice(0, 10)}   ${(MESES_CORTOS[c.mes - 1] ?? '').padEnd(5)}` +
        der(fmt(Math.abs(c.monto)), 13) + `   ${esFiniquito ? 'FINIQUITO' : 'remuneración mensual'}`,
    )
  }
  console.log('  ' + '─'.repeat(64))
  console.log(`  ${aCrear.length} movimientos · ${fmt(aCrear.reduce((a, c) => a + Math.abs(c.monto), 0))}`)

  console.log('\n  Se deja SIN CONCILIAR en la bandeja:')
  for (const c of dejados) {
    console.log(
      `    ${c.fecha.toISOString().slice(0, 10)}  ${fmt(c.monto)}  — no se sabe a qué corresponde`,
    )
  }

  // Efecto en el flujo: Pago de nóminas de enero a junio.
  const actuales = await prisma.movimiento.groupBy({
    by: ['mes'],
    where: { categoriaId: categoria.id, anio: ANIO_ACTIVO },
    _sum: { montoCLP: true },
  })
  const antes = new Map(actuales.map((a) => [a.mes, a._sum.montoCLP ?? 0]))

  console.log('\n' + '═'.repeat(78))
  console.log('EFECTO EN LA FILA "PAGO DE NÓMINAS"')
  console.log('═'.repeat(78))
  console.log('  Mes    ' + der('Antes', 14) + der('Después', 14) + der('Δ', 14))
  console.log('  ' + '─'.repeat(50))
  for (const c of aCrear) {
    const a = antes.get(c.mes) ?? 0
    console.log(
      `  ${(MESES_CORTOS[c.mes - 1] ?? '').padEnd(6)}` + der(fmt(a), 14) +
        der(fmt(a + Math.abs(c.monto)), 14) + der(fmt(Math.abs(c.monto)), 14),
    )
  }
  console.log(
    `\n  El flujo baja ${fmt(aCrear.reduce((a, c) => a + Math.abs(c.monto), 0))} entre enero y junio.`,
  )

  if (!firme) {
    console.log('\n' + '═'.repeat(78))
    console.log('SIMULACIÓN: nada escrito. Para aplicar: npm run crear-cristian -- --firme')
    console.log('═'.repeat(78))
    return
  }

  // --- proveedor -----------------------------------------------------------
  const proveedor = await prisma.proveedor.upsert({
    where: { categoriaId_nombre: { categoriaId: categoria.id, nombre: NOMBRE } },
    create: {
      nombre: NOMBRE,
      categoriaId: categoria.id,
      aliasBancarios: JSON.stringify([ALIAS.toLowerCase()]),
      activo: false,
      orden: 99,
    },
    update: { aliasBancarios: JSON.stringify([ALIAS.toLowerCase()]), activo: false },
  })

  // --- movimientos ---------------------------------------------------------
  let creados = 0
  for (const c of aCrear) {
    const esFiniquito = c.mes === MES_FINIQUITO
    const idExterno = `cartola:${c.hash}`
    const descripcion = esFiniquito
      ? `FINIQUITO · ${NOMBRE} deja la empresa el ${c.fecha.toISOString().slice(0, 10)}. No es un sueldo mensual: no promediar con los demás.`
      : `${NOMBRE} · remuneración`

    const movimiento = await prisma.movimiento.upsert({
      where: { idExterno },
      create: {
        fecha: c.fecha,
        mes: c.mes,
        anio: c.anio,
        montoCLP: Math.abs(c.monto),
        monedaOriginal: 'CLP',
        proveedorId: proveedor.id,
        categoriaId: categoria.id,
        descripcion,
        fuente: 'cartola',
        idExterno,
        estado: 'confirmado',
      },
      update: { montoCLP: Math.abs(c.monto), descripcion },
    })

    await prisma.movimientoBancario.update({
      where: { id: c.id },
      data: {
        estadoConciliacion: 'conciliado',
        movimientoId: movimiento.id,
        proveedorSugerido: NOMBRE,
        viaConciliacion: 'manual',
        notaConciliacion: esFiniquito ? 'finiquito' : 'remuneración mensual',
      },
    })
    creados += 1
  }

  console.log('\n' + '═'.repeat(78))
  console.log(`LISTO`)
  console.log('═'.repeat(78))
  console.log(`  Proveedor "${NOMBRE}" en ${CATEGORIA}, INACTIVO (salió en junio).`)
  console.log(`  Alias bancario: "${ALIAS}"`)
  console.log(`  ${creados} movimientos creados y conciliados.`)
  console.log(`  ${dejados.length} cargo sin conciliar, esperando en la bandeja.`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
