/**
 * Modela los acuerdos de pago con RC Ingeniería e Inmotion como obligaciones.
 *
 *   npm run acuerdos            # simula
 *   npm run acuerdos -- --firme # aplica
 *
 * DATOS DE PRODUCCIÓN: sin --firme no escribe nada, y la simulación muestra cuota
 * por cuota lo que se crearía y cómo queda el flujo.
 *
 * POR QUÉ MODELARLOS
 * Eran filas del flujo y nada más: no entraban en el total de deuda, no aparecían
 * en /obligaciones y nunca disparaban aviso por vencer. Dos de las cinco cosas que
 * se deben hoy eran invisibles para el sistema que existe justamente para no
 * olvidarse de pagar.
 *
 * EL CALENDARIO PISA AL VALOR MANUAL, PERO SOLO EN LOS MESES QUE TIENE
 * `calcularFlujo` reemplaza el ValorManual con la cuota del mes, y deja intactos los
 * meses sin cuota. Por eso los meses ya pagados —marzo a agosto de Inmotion, con su
 * monto real tomado de la cartola— no se tocan: el calendario parte donde empieza lo
 * que falta por pagar.
 *
 * LAS CUOTAS PAGADAS SE MARCAN COMO TALES
 * RC Ingeniería tiene julio y agosto conciliados contra la cartola. Se crean con
 * estado 'pagada' para que no aparezcan como deuda ni disparen avisos.
 */

import { PrismaClient } from '@prisma/client'
import { MESES } from '../src/lib/dominio'

const prisma = new PrismaClient()
const FIRME = process.argv.includes('--firme')

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

interface Plan {
  categoria: string
  institucion: string
  numero: string
  marco: string
  cuotaMensual: number
  /** Primera cuota del calendario: [anio, mes]. */
  desde: [number, number]
  /** Cuántas cuotas van desde ahí. */
  cuotas: number
  /** Meses ya pagados, como "2026-07". Se crean con estado 'pagada'. */
  pagadas: string[]
  nota: string
}

const PLANES: Plan[] = [
  {
    categoria: 'RC Ingeniería - acuerdo de pago',
    institucion: 'RC Ingeniería',
    numero: 'acuerdo',
    marco: 'Acuerdo directo',
    cuotaMensual: 533_120,
    desde: [2026, 7],
    cuotas: 3,
    // Julio y agosto están conciliados contra cargos de la cartola.
    pagadas: ['2026-07', '2026-08'],
    nota: 'Tres cuotas. La de septiembre de 2026 es la última.',
  },
  {
    categoria: 'Inmotion - acuerdo de pago',
    institucion: 'Inmotion',
    numero: 'acuerdo',
    marco: 'Acuerdo directo',
    cuotaMensual: 1_166_378,
    // Septiembre entra al calendario aunque Pipe contó 11 desde octubre: la cuota de
    // septiembre está impaga y sin ella no aparecería en /obligaciones ni avisaría.
    // Marzo a agosto quedan fuera porque ya se pagaron y su monto real viene de la
    // cartola; meterlas al calendario no agregaría nada y arriesgaría pisarlas.
    desde: [2026, 9],
    cuotas: 12,
    pagadas: [],
    nota: 'Doce cuotas desde septiembre de 2026 hasta agosto de 2027. Las seis de marzo a agosto de 2026 ya están pagadas y viven en el flujo con su monto real de la cartola.',
  },
]

const clave = (anio: number, mes: number): string => `${anio}-${String(mes).padStart(2, '0')}`

function calendario(plan: Plan): { anio: number; mes: number; pagada: boolean }[] {
  const salida = []
  let [anio, mes] = plan.desde
  for (let i = 0; i < plan.cuotas; i += 1) {
    salida.push({ anio, mes, pagada: plan.pagadas.includes(clave(anio, mes)) })
    mes += 1
    if (mes > 12) {
      mes = 1
      anio += 1
    }
  }
  return salida
}

async function main(): Promise<void> {
  for (const plan of PLANES) {
    const categoria = await prisma.categoria.findFirst({ where: { nombre: plan.categoria } })
    if (!categoria) throw new Error(`No existe la categoría "${plan.categoria}".`)

    const yaExiste = await prisma.obligacionFinanciera.findFirst({
      where: { categoriaId: categoria.id, institucion: plan.institucion },
    })

    const cuotas = calendario(plan)
    const ultima = cuotas.at(-1)
    const porPagar = cuotas.filter((c) => !c.pagada)

    console.log(`\n=== ${plan.institucion} ===`)
    if (yaExiste) {
      console.log('  Ya existe una obligación para esta categoría. No se toca.')
      continue
    }
    console.log(`  categoría   ${plan.categoria}`)
    console.log(`  cuota       ${clp(plan.cuotaMensual)} mensual`)
    console.log(
      `  calendario  ${cuotas.length} cuotas, de ${MESES[(plan.desde[1] ?? 1) - 1]?.toLowerCase()} ${plan.desde[0]}` +
        ` a ${MESES[(ultima?.mes ?? 1) - 1]?.toLowerCase()} ${ultima?.anio}`,
    )
    console.log(`  por pagar   ${porPagar.length} cuotas, ${clp(porPagar.length * plan.cuotaMensual)}`)
    for (const c of cuotas) {
      console.log(
        `    ${MESES[c.mes - 1]?.slice(0, 3).toLowerCase()} ${c.anio}  ${clp(plan.cuotaMensual).padStart(11)}  ${c.pagada ? 'pagada' : 'pendiente'}`,
      )
    }

    if (!FIRME) continue

    const obligacion = await prisma.obligacionFinanciera.create({
      data: {
        tipo: 'acuerdo_pago',
        institucion: plan.institucion,
        numero: plan.numero,
        marco: plan.marco,
        fechaActivacion: new Date(Date.UTC(plan.desde[0], (plan.desde[1] ?? 1) - 1, 1, 12)),
        cuotaMensual: plan.cuotaMensual,
        fechaUltimaCuota: new Date(Date.UTC(ultima?.anio ?? 2026, (ultima?.mes ?? 1) - 1, 15, 12)),
        cuotasPorGenerar: 0,
        activa: true,
        categoriaId: categoria.id,
        nota: plan.nota,
      },
    })
    await prisma.cuotaObligacion.createMany({
      data: cuotas.map((c) => ({
        obligacionId: obligacion.id,
        anio: c.anio,
        mes: c.mes,
        monto: plan.cuotaMensual,
        estado: c.pagada ? 'pagada' : 'pendiente',
      })),
    })
    console.log(`  -> creada con ${cuotas.length} cuotas`)
  }

  if (!FIRME) console.log('\nSimulación. Repite con --firme para aplicarlo.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
