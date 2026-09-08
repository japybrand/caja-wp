/**
 * Enero de 2026: los pagos internacionales que no pasaron por la cuenta USD.
 *
 *   npm run global66-enero            (simulacion)
 *   npm run global66-enero -- --firme
 *
 * DOS MODALIDADES DE PAGO
 * Global66 permite dos caminos y enero uso el segundo:
 *
 *  1. Convertir pesos a la cuenta USD y desde ahi enviar. Es lo habitual desde
 *     febrero, y es lo que aparece en el export "Movimientos de cuenta USD".
 *  2. Envio internacional directo desde el monedero en pesos, con la conversion
 *     dentro de la misma operacion. NO deja rastro en la cuenta USD.
 *
 * Por eso enero mostraba 1.633.482 transferidos desde Santander y ninguna conversion
 * en el export: los pagos existieron, pero por el otro camino.
 *
 * CUADRATURA
 * Santander cargo 1.830.133 y devolvio 196.651, neto 1.633.482. Los cuatro egresos
 * del monedero CLP —dos envios y sus dos costos de cambio— suman exactamente esos
 * 1.633.482.
 *
 * EL ABONO DE 196.651 NO ES UN GASTO NEGATIVO
 * Es plata que volvio: el envio a Juan Pablo se devolvio porque ya se le habia
 * pagado por PayPal ese mismo dia (Compra PAYPAL *JUAN RUIZ, 161.676). Se concilia
 * con nota y sin crear movimiento, porque el egreso que compensa tampoco se
 * registra: solo se cargan los 1.633.482 que si salieron.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

const CATEGORIA_INTERNACIONAL = 'Pago de servicios Internacional'
const CATEGORIA_COSTO = 'Global66 - costo y spread'
const FECHA = new Date(Date.UTC(2026, 0, 5, 12))

/** Glosa de los dos envios: enero pago servicios de diciembre de 2025. */
const GLOSA = 'PAGO SERVICIOS FREELANCE INTERNACIONAL DICIEMBRE 2025'

const ENVIOS = [
  { proveedor: 'Angelina Solano', montoCLP: 1_324_126, costoCambio: 27_022, usd: 1465.6, tc: 903.46 },
  { proveedor: 'Jimena Simos', montoCLP: 271_041, costoCambio: 11_293, usd: 300, tc: 903.46 },
]

/** Lo que Santander cargo neto en enero, y que este reparto debe explicar. */
const NETO_SANTANDER = 1_633_482

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  const suma = ENVIOS.reduce((a, e) => a + e.montoCLP + e.costoCambio, 0)
  console.log('Envío                    CLP        costo cambio      USD        TC')
  console.log('─'.repeat(70))
  for (const e of ENVIOS) {
    console.log(
      `${e.proveedor.padEnd(20)} ${fmt(e.montoCLP).padStart(11)} ${fmt(e.costoCambio).padStart(15)} ` +
        `${e.usd.toFixed(2).padStart(9)} ${e.tc.toFixed(2).padStart(9)}`,
    )
  }
  console.log('─'.repeat(70))
  console.log(`${'Suma'.padEnd(20)} ${fmt(suma).padStart(11)}`)
  console.log(`${'Neto de Santander'.padEnd(20)} ${fmt(NETO_SANTANDER).padStart(11)}`)
  if (suma !== NETO_SANTANDER) {
    throw new Error(`No cuadra: la suma da ${fmt(suma)} y Santander ${fmt(NETO_SANTANDER)}.`)
  }
  console.log('  cuadra al peso\n')

  const catInternacional = await prisma.categoria.findFirst({
    where: { nombre: CATEGORIA_INTERNACIONAL },
  })
  const catCosto = await prisma.categoria.findFirst({ where: { nombre: CATEGORIA_COSTO } })
  if (!catInternacional || !catCosto) throw new Error('Faltan categorías.')

  const totalCosto = ENVIOS.reduce((a, e) => a + e.costoCambio, 0)
  console.log(`Costo de cambio a "${CATEGORIA_COSTO}": ${fmt(totalCosto)}`)

  const abono = await prisma.movimientoBancario.findFirst({
    where: { anio: 2026, mes: 1, monto: 196_651, descripcion: { contains: 'Japybrand SPA' } },
  })
  console.log(
    abono
      ? `Abono de ${fmt(abono.monto)} del ${abono.fecha.toISOString().slice(0, 10)}: se concilia como devolución.`
      : 'El abono de 196.651 ya no está pendiente.',
  )

  const cargo = await prisma.movimientoBancario.findFirst({
    where: { anio: 2026, mes: 1, monto: -1_830_133, descripcion: { contains: 'Japybrand SPA' } },
  })

  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito.')
    return
  }

  for (const e of ENVIOS) {
    const proveedor = await prisma.proveedor.findFirst({ where: { nombre: e.proveedor } })
    if (!proveedor) throw new Error(`No existe el proveedor "${e.proveedor}".`)
    const idExterno = `g66-clp:2026-1:${proveedor.id}`
    await prisma.movimiento.upsert({
      where: { idExterno },
      create: {
        fecha: FECHA,
        mes: 1,
        anio: 2026,
        montoCLP: e.montoCLP,
        monedaOriginal: 'USD',
        montoOriginal: e.usd,
        proveedorId: proveedor.id,
        categoriaId: catInternacional.id,
        descripcion: `${e.usd} USD a ${e.tc} · envío directo desde el monedero CLP · ${GLOSA}`,
        fuente: 'global66',
        idExterno,
        estado: 'confirmado',
      },
      update: { montoCLP: e.montoCLP, montoOriginal: e.usd },
    })
  }

  const idCosto = 'g66-costo:2026-1'
  await prisma.movimiento.upsert({
    where: { idExterno: idCosto },
    create: {
      fecha: FECHA,
      mes: 1,
      anio: 2026,
      montoCLP: totalCosto,
      monedaOriginal: 'CLP',
      proveedorId: null,
      categoriaId: catCosto.id,
      descripcion: 'Costo de cambio de dos envíos internacionales directos desde el monedero CLP',
      fuente: 'global66',
      idExterno: idCosto,
      estado: 'confirmado',
    },
    update: { montoCLP: totalCosto },
  })

  if (cargo) {
    await prisma.movimientoBancario.update({
      where: { id: cargo.id },
      data: {
        estadoConciliacion: 'conciliado',
        viaConciliacion: 'manual',
        notaConciliacion:
          'envíos internacionales directos desde el monedero CLP de Global66, ' +
          'sin pasar por la cuenta USD: Angelina Solano y Jimena Simos, servicios de diciembre 2025',
      },
    })
  }
  if (abono) {
    await prisma.movimientoBancario.update({
      where: { id: abono.id },
      data: {
        estadoConciliacion: 'conciliado',
        viaConciliacion: 'manual',
        notaConciliacion:
          'devolución desde Global66: el envío a Juan Pablo Ruiz por diciembre 2025 no se cursó ' +
          'porque se le pagó por PayPal el mismo día',
      },
    })
  }

  const quedan = await prisma.movimientoBancario.count({
    where: { estadoConciliacion: 'sin_conciliar' },
  })
  console.log(`\nLISTO. Bandeja: ${quedan}`)
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
