/**
 * Dos casos puntuales de la bandeja.
 *
 *   npm run resolver-syt-webpay            (simulacion)
 *   npm run resolver-syt-webpay -- --firme
 *
 * SYT IMPRESORES
 * Proveedor de impresion. Cinco cargos y un abono de 118.530 en abril que es una
 * devolucion suya. El abono se guarda como un Movimiento NEGATIVO en vez de
 * ignorarse: "Proveedores nacional" es una fila calculada, se alimenta de
 * Movimientos, y un gasto que despues se devuelve tiene que bajar el total del
 * proveedor. Ignorar el abono dejaria el gasto inflado en 118.530.
 *
 * WEBPAY
 * Siete reversos de compra el 17 y 20 de agosto y siete anulaciones el 19. Suman
 * exactamente cero: la tarjeta devolvio y volvio a cobrar. No es gasto ni ingreso.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

/** RUT 76.321.799-K. Distinto de "SyT SpA", que es 76.597.741-K. */
const ALIAS_SYT = 'SYT Impresores'
const PROVEEDOR_SYT = 'SyT Impresores'
const CATEGORIA_SYT = 'Proveedores nacional'

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  // ── SyT Impresores ─────────────────────────────────────────────────────────
  const movs = await prisma.movimientoBancario.findMany({
    where: { estadoConciliacion: 'sin_conciliar', descripcion: { contains: '076321799K' } },
    orderBy: { fecha: 'asc' },
  })

  const categoria = await prisma.categoria.findFirst({ where: { nombre: CATEGORIA_SYT } })
  if (!categoria) throw new Error(`No existe la categoría "${CATEGORIA_SYT}".`)

  console.log(`SyT Impresores → ${CATEGORIA_SYT}`)
  let neto = 0
  for (const m of movs) {
    neto += -m.monto
    console.log(
      `  ${m.fecha.toISOString().slice(0, 10)} ${fmt(m.monto).padStart(10)}  ` +
        `${m.monto > 0 ? 'devolución (Movimiento negativo)' : 'gasto'}`,
    )
  }
  console.log(`  ${movs.length} movimientos · gasto neto del año ${fmt(neto)}`)

  if (firme && movs.length > 0) {
    let proveedor = await prisma.proveedor.findFirst({ where: { nombre: PROVEEDOR_SYT } })
    if (!proveedor) {
      const ultimo = await prisma.proveedor.findFirst({
        where: { categoriaId: categoria.id },
        orderBy: { orden: 'desc' },
      })
      proveedor = await prisma.proveedor.create({
        data: {
          nombre: PROVEEDOR_SYT,
          categoriaId: categoria.id,
          orden: (ultimo?.orden ?? 0) + 1,
          aliasBancarios: JSON.stringify([ALIAS_SYT]),
        },
      })
    }

    for (const m of movs) {
      const idExterno = `cartola:${m.hash}`
      const esDevolucion = m.monto > 0
      const movimiento = await prisma.movimiento.upsert({
        where: { idExterno },
        create: {
          fecha: m.fecha,
          mes: m.mes,
          anio: m.anio,
          // El signo importa: la devolucion entra negativa para bajar el total.
          montoCLP: -m.monto,
          monedaOriginal: 'CLP',
          proveedorId: proveedor.id,
          categoriaId: categoria.id,
          descripcion: esDevolucion ? 'SyT Impresores · devolución' : 'SyT Impresores',
          fuente: 'cartola',
          idExterno,
          estado: 'confirmado',
        },
        update: { montoCLP: -m.monto },
      })
      await prisma.movimientoBancario.update({
        where: { id: m.id },
        data: {
          estadoConciliacion: 'conciliado',
          viaConciliacion: 'alias',
          movimientoId: movimiento.id,
          proveedorSugerido: proveedor.nombre,
          notaConciliacion: esDevolucion
            ? 'devolución de SyT Impresores: baja el gasto del proveedor'
            : 'gasto de SyT Impresores, creado desde la cartola',
        },
      })
    }
  }

  // ── WebPay ─────────────────────────────────────────────────────────────────
  const webpay = await prisma.movimientoBancario.findMany({
    where: { estadoConciliacion: 'sin_conciliar', descripcion: { contains: 'WebPay' } },
    orderBy: { fecha: 'asc' },
  })
  const sumaWebpay = webpay.reduce((a, m) => a + m.monto, 0)
  console.log(`\nWebPay: ${webpay.length} movimientos, neto ${fmt(sumaWebpay)}`)
  if (sumaWebpay !== 0) {
    console.log('  OJO: no netean cero. No se ignoran.')
  } else if (firme) {
    await prisma.movimientoBancario.updateMany({
      where: { id: { in: webpay.map((m) => m.id) } },
      data: {
        estadoConciliacion: 'ignorado',
        movimientoId: null,
        notaConciliacion:
          'reverso de compra con tarjeta y su anulación; el grupo suma cero, no es gasto ni ingreso',
      },
    })
  }

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
