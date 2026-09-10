/**
 * Manda el cobro de CapCut a su proveedor y enseña al motor a reconocerlo.
 *
 *   npm run capcut            # simula
 *   npm run capcut -- --firme # aplica
 *
 * DATOS DE PRODUCCIÓN: sin --firme no escribe nada.
 *
 * QUÉ PASÓ
 * PayPal cobra por CapCut, por Fernando Vela y por Juan Pablo Ruiz desde el mismo
 * remitente. `service@intl.paypal.com` estaba registrado en los dos colaboradores y
 * en nadie más, así que el modelo tenía que elegir entre ellos aunque el correo
 * dijera CapCut. Lo dejó en la bandeja con la nota correcta —"el correo cobra por
 * CapCut, no por Fernando Vela"— y con confianza 0 en el proveedor: hizo lo que
 * tenía que hacer con la información que tenía.
 *
 * Agregar el remitente a CapCut le da la tercera opción. El modelo elige por el
 * producto que menciona el correo, así que con las tres candidatas debería acertar;
 * y si duda, el guardia de `eleccionFirme` lo manda a la bandeja igual que hoy.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const FIRME = process.argv.includes('--firme')
const REMITENTE = 'service@intl.paypal.com'

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

async function main(): Promise<void> {
  const capcut = await prisma.proveedor.findFirst({
    where: { nombre: 'CapCut' },
    include: { categoria: true },
  })
  if (!capcut) throw new Error('No existe el proveedor CapCut.')

  const movimiento = await prisma.movimiento.findFirst({
    where: { estado: 'por_revisar', descripcion: { contains: 'CapCut' } },
    include: { proveedor: true, categoria: true },
  })

  console.log('1. EL MOVIMIENTO DE LA BANDEJA')
  if (!movimiento) {
    console.log('   Ya no hay ninguno pendiente con CapCut en la glosa.')
  } else {
    console.log(`   ${movimiento.fecha.toISOString().slice(0, 10)}  ${clp(movimiento.montoCLP)}`)
    console.log(
      `   de   ${movimiento.categoria.nombre} / ${movimiento.proveedor?.nombre ?? '—'}  (${movimiento.estado})`,
    )
    console.log(`   a    ${capcut.categoria.nombre} / ${capcut.nombre}  (confirmado)`)
  }

  const remitentes: string[] = JSON.parse(capcut.remitentesEmail || '[]')
  const yaEsta = remitentes.includes(REMITENTE)
  console.log('\n2. REMITENTES DE CAPCUT')
  console.log(`   ahora     ${remitentes.length === 0 ? '(ninguno)' : remitentes.join(', ')}`)
  console.log(`   quedaría  ${yaEsta ? 'sin cambio' : [...remitentes, REMITENTE].join(', ')}`)

  const comparten = await prisma.proveedor.findMany({
    where: { remitentesEmail: { contains: REMITENTE } },
  })
  console.log(
    `   comparten ese remitente: ${comparten.map((p) => p.nombre).join(', ')}` +
      `${yaEsta ? '' : ', CapCut'}`,
  )

  if (!FIRME) {
    console.log('\nSimulación. Repite con --firme para aplicarlo.')
    return
  }

  if (movimiento) {
    await prisma.movimiento.update({
      where: { id: movimiento.id },
      data: {
        categoriaId: capcut.categoriaId,
        proveedorId: capcut.id,
        estado: 'confirmado',
        // El monto no se toca: 22.990 contra los 12.990 de agosto es un cambio de
        // plan, no un error de lectura.
        descripcion: 'Pago a CapCut vía PayPal',
      },
    })
  }
  if (!yaEsta) {
    await prisma.proveedor.update({
      where: { id: capcut.id },
      data: { remitentesEmail: JSON.stringify([...remitentes, REMITENTE]) },
    })
  }
  console.log('\nAplicado.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
