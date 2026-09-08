/**
 * Registra la deuda pendiente con colaboradores internacionales.
 *
 *   npm run compromisos            (simulacion)
 *   npm run compromisos -- --firme
 *
 * LA DEUDA SE DECLARA, NO SE DEDUCE
 * Restar lo enviado a lo que dicen las planillas da una deuda falsa: las planillas
 * son fuente confiable de cuanto se facturo, no de que quedo pagado. Sus estados de
 * pago estan desactualizados y arrastran meses que ya se regularizaron. La deuda
 * real de agosto de 2026 son 1.467 USD con Juan Pablo y 600 con Fernando Vela, y
 * nada mas: lo anterior de Juan Pablo se corrio a agosto y se acordo pagarlo en
 * cuotas.
 *
 * COMO ENTRA AL FLUJO
 * Como Movimiento con fuente "compromiso" en el mes en que se espera pagar. No hace
 * falta una tabla aparte: el compromiso ES la salida futura, y tenerlo en un solo
 * lugar evita que la vista de pendientes y el flujo se contradigan.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

const CATEGORIA = 'Pago de servicios Internacional'

/**
 * Ultimo tipo de cambio realmente pagado, de la conversion del 04/09/2026 en el
 * export de Global66. Se usa ese y no el dolar observado porque es el precio al que
 * Global66 vende de verdad, que es lo que va a costar pagar esta deuda.
 */
const TIPO_CAMBIO = 934.5
const FECHA_TIPO_CAMBIO = '2026-09-04'

/** Mes en que se espera pagar. Octubre es el primer mes sin cartola. */
const ANIO_PAGO = 2026
const MES_PAGO = 10

const COMPROMISOS: { proveedor: string; usd: number; periodo: string }[] = [
  { proveedor: 'Juan Pablo Ruiz', usd: 1467, periodo: 'agosto 2026' },
  { proveedor: 'Fernando Vela', usd: 600, periodo: 'agosto 2026' },
]

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  const categoria = await prisma.categoria.findFirst({ where: { nombre: CATEGORIA } })
  if (!categoria) throw new Error(`No existe la categoría "${CATEGORIA}".`)

  console.log(`Tipo de cambio ${TIPO_CAMBIO} (conversión Global66 del ${FECHA_TIPO_CAMBIO})`)
  console.log(`Se registran como salida de ${String(MES_PAGO).padStart(2, '0')}/${ANIO_PAGO}\n`)
  console.log('Colaborador          Período          USD          CLP')
  console.log('─'.repeat(58))

  let totalUSD = 0
  let totalCLP = 0
  for (const c of COMPROMISOS) {
    const proveedor = await prisma.proveedor.findFirst({ where: { nombre: c.proveedor } })
    if (!proveedor) throw new Error(`No existe el proveedor "${c.proveedor}".`)

    const montoCLP = Math.round(c.usd * TIPO_CAMBIO)
    totalUSD += c.usd
    totalCLP += montoCLP
    console.log(
      `${c.proveedor.padEnd(20)} ${c.periodo.padEnd(14)} ${String(c.usd).padStart(6)} ${fmt(montoCLP).padStart(12)}`,
    )

    if (!firme) continue

    // Clave estable: si el monto o el tipo de cambio cambian, se actualiza en vez
    // de duplicar.
    const idExterno = `compromiso:${proveedor.id}:${ANIO_PAGO}-${MES_PAGO}`
    await prisma.movimiento.upsert({
      where: { idExterno },
      create: {
        fecha: new Date(Date.UTC(ANIO_PAGO, MES_PAGO - 1, 5, 12)),
        mes: MES_PAGO,
        anio: ANIO_PAGO,
        montoCLP,
        monedaOriginal: 'USD',
        montoOriginal: c.usd,
        proveedorId: proveedor.id,
        categoriaId: categoria.id,
        descripcion: `Deuda de ${c.periodo}, ${c.usd} USD`,
        fuente: 'compromiso',
        idExterno,
        estado: 'confirmado',
      },
      update: { montoCLP, montoOriginal: c.usd },
    })
  }

  console.log('─'.repeat(58))
  console.log(`${'TOTAL'.padEnd(35)} ${String(totalUSD).padStart(6)} ${fmt(totalCLP).padStart(12)}`)

  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito.')
    return
  }
  const cuantos = await prisma.movimiento.count({ where: { fuente: 'compromiso' } })
  console.log(`\nLISTO. ${cuantos} compromisos registrados.`)
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
