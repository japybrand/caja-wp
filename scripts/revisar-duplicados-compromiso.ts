/**
 * Devuelve a la bandeja los movimientos que repiten un compromiso ya declarado.
 *
 *   node --import tsx --conditions=react-server --env-file=.env.local --env-file=.env \
 *     scripts/revisar-duplicados-compromiso.ts [--firme]
 *
 * Sin --firme solo simula. NO BORRA NADA: los deja en `por_revisar` con la razón
 * escrita en la descripción, así que el rastro de que el proveedor cobró queda, y
 * el movimiento sale de todos los totales del flujo hasta que alguien decida.
 *
 * EL CASO QUE LO ORIGINÓ
 * PayPal avisó por los 1.467 USD de Juan Pablo Ruiz de agosto y la ingesta creó el
 * movimiento en septiembre. La misma deuda ya estaba declarada como compromiso en
 * octubre, que es cuando se paga. Septiembre quedó inflado en 1.369.400 y nada lo
 * mostraba: los dos registros están en meses distintos y cada uno parece legítimo
 * por separado.
 *
 * El compromiso es la representación válida de la deuda; el correo de PayPal es un
 * aviso de cobro, no un pago. Por eso el que vuelve a la bandeja es el de la
 * ingesta.
 */

import { PrismaClient } from '@prisma/client'
import { compromisoQueDuplica } from '../src/lib/duplicados'

const prisma = new PrismaClient()
const FIRME = process.argv.includes('--firme')
const ANIO = 2026

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

const MARCA = 'DUPLICA UN COMPROMISO DECLARADO'

async function main(): Promise<void> {
  const candidatos = await prisma.movimiento.findMany({
    where: { anio: ANIO, estado: 'confirmado', fuente: { not: 'compromiso' } },
    include: { proveedor: { select: { nombre: true } } },
  })

  let encontrados = 0
  for (const m of candidatos) {
    const dup = await compromisoQueDuplica(m)
    if (!dup) continue
    encontrados += 1

    console.log(
      `mes ${String(m.mes).padStart(2)}  ${(m.proveedor?.nombre ?? '?').padEnd(22)} ` +
        `${clp(m.montoCLP).padStart(11)}  fuente=${m.fuente}`,
    )
    console.log(`   ${dup.motivo}`)
    console.log(`   glosa actual: ${m.descripcion.slice(0, 90)}`)

    if (!FIRME) continue

    // La marca va al principio de la descripción para que se lea en la bandeja sin
    // abrir nada. Se evita repetirla si el script ya corrió antes.
    const descripcion = m.descripcion.startsWith(MARCA)
      ? m.descripcion
      : `${MARCA} · ${m.descripcion}`.slice(0, 200)
    await prisma.movimiento.update({
      where: { id: m.id },
      data: { estado: 'por_revisar', descripcion },
    })
    console.log('   -> devuelto a la bandeja')
  }

  console.log(`\n${encontrados} movimientos confirmados repiten un compromiso.`)
  if (encontrados > 0 && !FIRME) console.log('Simulación. Repite con --firme para aplicarlo.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
