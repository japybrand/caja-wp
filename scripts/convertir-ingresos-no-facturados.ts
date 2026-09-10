/**
 * Convierte "Ingresos no facturados" de fila manual a fila con detalle.
 *
 *   npm run ingresos-derivada            # simula
 *   npm run ingresos-derivada -- --firme # aplica
 *
 * DATOS DE PRODUCCIÓN: sin --firme no escribe nada.
 *
 * POR QUÉ
 * El registro rápido solo acepta categorías derivadas: las manuales guardan un solo
 * número por mes, sin quién ni cuándo, y sumar ahí un pago sería peor que no
 * registrarlo. "Ingresos no facturados" es manual, así que hoy no se puede usar para
 * lo que se pensó: anotar un cobro que entró y no está facturado.
 *
 * QUÉ CAMBIA Y QUÉ NO
 * Los montos son los mismos: nueve abonos de 2.500 de Álvaro Ramiro, ya conciliados
 * contra la cartola, que hoy viven como ocho ValorManual —mayo tiene 5.000 porque
 * ese mes hubo dos transferencias—. Pasan a ser nueve movimientos, uno por abono,
 * cada uno enlazado a su cargo del banco.
 *
 * Se gana el detalle por persona y la posibilidad de registrar cobros nuevos. Y se
 * gana precisión: hoy el mes es un número suelto; después, cada peso apunta a su
 * abono en la cartola.
 *
 * EL VALOR MANUAL SE BORRA, SI NO SE CUENTA DOS VECES
 * Con la categoría ya derivada, `calcularFlujo` suma los movimientos e IGNORA el
 * ValorManual, así que dejarlo no rompería nada hoy. Se borra igual: un dato muerto
 * que dice otra cosa que el vivo es una trampa para el próximo que lo lea.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const FIRME = process.argv.includes('--firme')
const CATEGORIA = 'Ingresos no facturados'
const PROVEEDOR = 'Álvaro Ramiro'
const GLOSA = 'Álvaro'

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

async function main(): Promise<void> {
  const categoria = await prisma.categoria.findFirst({
    where: { nombre: CATEGORIA },
    include: { proveedores: true },
  })
  if (!categoria) throw new Error(`No existe la categoría "${CATEGORIA}".`)

  const abonos = await prisma.movimientoBancario.findMany({
    where: { categoriaManualId: categoria.id },
    orderBy: { fecha: 'asc' },
  })
  const valores = await prisma.valorManual.findMany({
    where: { categoriaId: categoria.id },
    orderBy: [{ anio: 'asc' }, { mes: 'asc' }],
  })
  const conMonto = valores.filter((v) => v.montoCLP !== 0)

  const totalAbonos = abonos.reduce((a, b) => a + b.monto, 0)
  const totalValores = conMonto.reduce((a, v) => a + v.montoCLP, 0)

  console.log(`CATEGORÍA "${CATEGORIA}"`)
  console.log(`  esManual        ${categoria.esManual} → false`)
  console.log(`  proveedores     ${categoria.proveedores.length} → 1 (${PROVEEDOR})`)
  console.log(`  abonos del banco imputados: ${abonos.length}, ${clp(totalAbonos)}`)
  console.log(`  valores manuales con monto: ${conMonto.length}, ${clp(totalValores)}`)

  if (totalAbonos !== totalValores) {
    console.log(
      `\n  NO CUADRA: ${clp(totalAbonos)} de abonos contra ${clp(totalValores)} de valores.`,
    )
    console.log('  No se escribe nada. Revisa antes de insistir.')
    process.exitCode = 1
    return
  }
  console.log(`  cuadran al peso: ${clp(totalAbonos)}\n`)

  console.log('MOVIMIENTOS QUE SE CREARÍAN, uno por abono')
  for (const b of abonos) {
    console.log(
      `  ${b.fecha.toISOString().slice(0, 10)}  ${clp(b.monto).padStart(8)}  ${b.descripcion.slice(0, 40)}`,
    )
  }

  if (!FIRME) {
    console.log('\nSimulación. Repite con --firme para aplicarlo.')
    return
  }

  const proveedor =
    categoria.proveedores.find((p) => p.nombre === PROVEEDOR) ??
    (await prisma.proveedor.create({
      data: {
        nombre: PROVEEDOR,
        categoriaId: categoria.id,
        orden: 1,
        aliasBancarios: JSON.stringify([GLOSA]),
      },
    }))

  for (const b of abonos) {
    const movimiento = await prisma.movimiento.create({
      data: {
        fecha: b.fecha,
        mes: b.mes,
        anio: b.anio,
        montoCLP: b.monto,
        monedaOriginal: 'CLP',
        proveedorId: proveedor.id,
        categoriaId: categoria.id,
        descripcion: 'Hosting mensual, cobrado sin factura',
        // 'cartola' y no 'declarado': salió de un abono real, ya conciliado.
        fuente: 'cartola',
        idExterno: `cartola:${b.id}`,
        estado: 'confirmado',
      },
    })
    // El abono pasa a colgar del movimiento. `categoriaManualId` se limpia: era el
    // mecanismo de las filas manuales y esta ya no lo es.
    await prisma.movimientoBancario.update({
      where: { id: b.id },
      data: { movimientoId: movimiento.id, categoriaManualId: null },
    })
  }

  await prisma.valorManual.deleteMany({ where: { categoriaId: categoria.id } })
  await prisma.categoria.update({
    where: { id: categoria.id },
    data: {
      esManual: false,
      nota:
        'Ingresos cobrados sin factura, así que el Registro de Ventas del SII no los cuenta. ' +
        'Va aparte de "Ventas del mes" porque esa fila la pisa el SII en todo mes con ' +
        'documentos. Lleva detalle por persona: acepta registro rápido de cobros.',
    },
  })

  console.log(`\nAplicado: ${abonos.length} movimientos creados, la fila queda derivada.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
