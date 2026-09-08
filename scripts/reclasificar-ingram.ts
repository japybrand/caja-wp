/**
 * Saca de ignorados la compra del notebook ASUS y la deja como gasto de la empresa.
 *
 *   node --import tsx --conditions=react-server --env-file=.env.local --env-file=.env \
 *     scripts/reclasificar-ingram.ts [--firme]
 *
 * Sin --firme solo simula.
 *
 * EL CARGO ES DE MAYO, NO DE AGOSTO
 * El cargo `Compra MERCADOPAGO *ASUS` es del 08/05/2026 y la factura 2626958 de
 * Ingram Micro tiene esa misma fecha. El gasto entra en mayo.
 *
 * EL FLUJO LLEVA 1.845.990 Y NO 1.899.990
 * La factura son 1.899.990, pero de la cuenta salieron 1.845.990: los 54.000 de
 * diferencia son el descuento de Mercado Pago, que nunca fue plata. El flujo de
 * caja registra lo que se pagó; el IVA de la factura ya viaja por el registro de
 * compras del SII y de ahí al F29, así que no se toca.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const FIRME = process.argv.includes('--firme')
const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

const CATEGORIA = 'Gastos generales'
const PROVEEDOR = 'Ingram Micro'
const GLOSA = 'Compra MERCADOPAGO *ASUS'

async function main(): Promise<void> {
  const cargo = await prisma.movimientoBancario.findFirst({
    where: { descripcion: { contains: 'ASUS' }, monto: { lt: 0 } },
  })
  if (!cargo) throw new Error('no se encontró el cargo del notebook')

  const categoria = await prisma.categoria.findFirst({ where: { nombre: CATEGORIA } })
  if (!categoria) throw new Error(`no existe la categoría "${CATEGORIA}"`)

  const factura = await prisma.documentoCompra.findFirst({
    where: { razonSocial: { contains: 'INGRAM' } },
  })

  console.log(`cargo    ${cargo.fecha.toISOString().slice(0, 10)}  ${clp(cargo.monto)}  ${cargo.descripcion}`)
  console.log(`         estado actual: ${cargo.estadoConciliacion} — ${cargo.notaConciliacion}`)
  if (factura) {
    console.log(
      `factura  ${factura.fechaDocto.toISOString().slice(0, 10)}  ${clp(factura.montoTotal)}  ` +
        `${factura.razonSocial} folio ${factura.folio}  (IVA recuperable ${clp(factura.montoIVARecuperable)})`,
    )
    console.log(`         descuento Mercado Pago: ${clp(factura.montoTotal - Math.abs(cargo.monto))}`)
  }
  console.log(`\nqueda como: ${CATEGORIA} / ${PROVEEDOR}, ${clp(Math.abs(cargo.monto))} en el mes ${cargo.mes}`)

  if (cargo.estadoConciliacion === 'conciliado' && cargo.movimientoId) {
    console.log('\nYa estaba reclasificado. No hay nada que hacer.')
    return
  }
  if (!FIRME) {
    console.log('\nSimulación. Repite con --firme para aplicarlo.')
    return
  }

  const proveedor =
    (await prisma.proveedor.findFirst({ where: { nombre: PROVEEDOR, categoriaId: categoria.id } })) ??
    (await prisma.proveedor.create({
      data: {
        nombre: PROVEEDOR,
        categoriaId: categoria.id,
        orden: (await prisma.proveedor.count({ where: { categoriaId: categoria.id } })) + 1,
      },
    }))

  // `fuente: 'cartola'` porque el monto sale de un cargo real, no de la planilla.
  // Eso además lo protege del importador del Excel.
  const movimiento = await prisma.movimiento.create({
    data: {
      fecha: cargo.fecha,
      mes: cargo.mes,
      anio: cargo.anio,
      montoCLP: Math.abs(cargo.monto),
      monedaOriginal: 'CLP',
      proveedorId: proveedor.id,
      categoriaId: categoria.id,
      descripcion: GLOSA,
      fuente: 'cartola',
      idExterno: `cartola:${cargo.id}`,
      estado: 'confirmado',
    },
  })

  await prisma.movimientoBancario.update({
    where: { id: cargo.id },
    data: {
      estadoConciliacion: 'conciliado',
      movimientoId: movimiento.id,
      viaConciliacion: 'manual',
      notaConciliacion:
        'notebook ASUS con factura 2626958 de Ingram Micro a nombre de Japybrand WP; ' +
        'los 54.000 de diferencia son el descuento de Mercado Pago',
      proveedorSugerido: PROVEEDOR,
    },
  })

  console.log('\nAplicado.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
