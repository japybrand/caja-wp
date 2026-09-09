/**
 * Agrega al calendario de Inmotion las seis cuotas ya pagadas.
 *
 *   npm run inmotion-historial            # simula
 *   npm run inmotion-historial -- --firme # aplica
 *
 * DATOS DE PRODUCCIÓN: sin --firme no escribe nada.
 *
 * POR QUÉ HAY QUE COMPLETARLO
 * El calendario se cargó solo con las cinco cuotas que faltan, para no pisar con un
 * supuesto los meses ya conciliados contra la cartola. Esa precaución resultó
 * equivocada apenas se quiso mostrar el avance: con seis cuotas pagadas fuera del
 * calendario, la obligación decía "0% pagado" de un acuerdo que va por la mitad, y
 * su total comprometido era 6.135.951 en vez de 13.134.219.
 *
 * POR QUÉ AHORA SÍ ES SEGURO
 * El monto de cada cuota es idéntico al que ya tiene el flujo: 1.166.378 en marzo,
 * abril, mayo, junio, julio y agosto, que es el neto conciliado —junio y julio
 * tuvieron cheque protestado y reemplazo por transferencia, y netean una cuota cada
 * uno—. El calendario reemplaza el valor manual solo en los meses que tiene, así que
 * escribe exactamente el mismo número. Se comprueba antes de escribir: si algún mes
 * no calza al peso, el script se detiene.
 *
 * Editar esas celdas a mano sigue siendo posible: la grilla solo bloquea los meses
 * de origen 'sii', no los de calendario.
 */

import { PrismaClient } from '@prisma/client'
import { MESES } from '../src/lib/dominio'

const prisma = new PrismaClient()
const FIRME = process.argv.includes('--firme')
const ANIO = 2026
const CUOTA = 1_166_378
const MESES_PAGADOS = [3, 4, 5, 6, 7, 8]

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

async function main(): Promise<void> {
  const categoria = await prisma.categoria.findFirst({
    where: { nombre: 'Inmotion - acuerdo de pago' },
  })
  if (!categoria) throw new Error('No existe la categoría de Inmotion.')

  const obligacion = await prisma.obligacionFinanciera.findFirst({
    where: { categoriaId: categoria.id },
    include: { cuotas: { orderBy: [{ anio: 'asc' }, { mes: 'asc' }] } },
  })
  if (!obligacion) throw new Error('No existe la obligación de Inmotion.')

  const valores = await prisma.valorManual.findMany({
    where: { categoriaId: categoria.id, anio: ANIO, mes: { in: MESES_PAGADOS } },
  })
  const porMes = new Map(valores.map((v) => [v.mes, v]))

  console.log('COMPROBACIÓN: el calendario tiene que escribir el mismo monto que ya está\n')
  const faltantes: number[] = []
  let problemas = 0
  for (const mes of MESES_PAGADOS) {
    const ya = obligacion.cuotas.find((c) => c.anio === ANIO && c.mes === mes)
    const valor = porMes.get(mes)
    const calza = valor?.montoCLP === CUOTA
    if (!calza) problemas += 1
    if (!ya) faltantes.push(mes)
    console.log(
      `  ${MESES[mes - 1]?.padEnd(11)} flujo ${clp(valor?.montoCLP ?? 0).padStart(11)}` +
        `  origen ${(valor?.origen ?? '—').padEnd(7)}` +
        `  cuota a crear ${clp(CUOTA).padStart(11)}` +
        `  ${calza ? 'calza' : 'NO CALZA'}` +
        (ya ? '   (ya existe, se salta)' : ''),
    )
  }
  if (problemas > 0) {
    console.log(`\n${problemas} meses no calzan. No se escribe nada: revisa antes de insistir.`)
    process.exitCode = 1
    return
  }

  const totalDespues = obligacion.cuotas.reduce((a, c) => a + c.monto, 0) + faltantes.length * CUOTA
  console.log(`\n  cuotas hoy         ${obligacion.cuotas.length}`)
  console.log(`  se agregan         ${faltantes.length} pagadas`)
  console.log(`  quedaría en        ${obligacion.cuotas.length + faltantes.length} cuotas`)
  console.log(`  total comprometido ${clp(obligacion.cuotas.reduce((a, c) => a + c.monto, 0))} -> ${clp(totalDespues)}`)

  if (faltantes.length === 0) {
    console.log('\nNo hay nada que agregar.')
    return
  }
  if (!FIRME) {
    console.log('\nSimulación. Repite con --firme para aplicarlo.')
    return
  }

  await prisma.cuotaObligacion.createMany({
    data: faltantes.map((mes) => ({
      obligacionId: obligacion.id,
      anio: ANIO,
      mes,
      monto: CUOTA,
      estado: 'pagada',
      // Sin `fechaPago`: no se pagaron hoy. La evidencia de cuándo salió cada una
      // vive en la cartola, conciliada contra la fila del flujo.
    })),
  })
  await prisma.obligacionFinanciera.update({
    where: { id: obligacion.id },
    data: {
      fechaActivacion: new Date(Date.UTC(ANIO, 2, 1, 12)),
      nota: 'Acuerdo de 11 cuotas por 13.134.219: diez de 1.166.378 y la última de 1.470.439. Las seis de marzo a agosto de 2026 están pagadas y conciliadas contra la cartola; junio y julio tuvieron cheque protestado y reemplazo por transferencia, y netean una cuota cada uno.',
    },
  })
  console.log(`\nAplicado: ${faltantes.length} cuotas pagadas agregadas al calendario.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
