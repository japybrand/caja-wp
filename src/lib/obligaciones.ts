import { prisma } from '@/lib/prisma'
import { MESES_CORTOS } from '@/lib/dominio'

/**
 * Estado de las obligaciones con calendario cerrado (convenios de la Tesorería y
 * la línea Fogape) y de las cotizaciones previsionales.
 *
 * Las dos cosas se modelan aparte a propósito. Un convenio es un compromiso con
 * calendario conocido de punta a punta: se sabe cuántas cuotas quedan y cuándo
 * termina. Una cotización nace cada mes con la remuneración y no tiene calendario
 * pactado; lo que importa de ella es si está al día y cuánto se atrasó.
 */

export interface CuotaVista {
  anio: number
  mes: number
  monto: number
  estado: string
}

export interface ObligacionVista {
  id: string
  tipo: string
  institucion: string
  numero: string
  marco: string
  fechaActivacion: string
  cuotaMensual: number
  /** Cuotas emitidas que siguen sin pagarse. */
  pendientes: number
  /** Comprometidas que la institución todavía no emite. */
  porGenerar: number
  pagadas: number
  /** Lo que falta por pagar, incluyendo las cuotas por generar. */
  saldo: number
  /** Todo lo que costará la obligación de principio a fin. */
  totalComprometido: number
  primerMes: { anio: number; mes: number } | null
  ultimoMes: { anio: number; mes: number } | null
  cuotas: CuotaVista[]
}

export interface ColumnaCalendario {
  anio: number
  mes: number
  etiqueta: string
  /** Monto por obligación, en el mismo orden que `obligaciones`. */
  montos: number[]
  total: number
  /** true si el mes ya pasó respecto de hoy. */
  pasado: boolean
}

export interface CotizacionVista {
  anio: number
  mes: number
  etiqueta: string
  monto: number
  montoCertificado: number
  /** Lo cotizado por trabajadores distintos de Felipe. */
  resto: number
  estado: string
  fechaPago: string | null
  fechaVencimiento: string | null
  /** Días pasados del vencimiento legal, que es el 13 del mes siguiente. */
  diasDeAtraso: number | null
  nota: string
}

/**
 * Deuda con un colaborador. Se DECLARA, no se deduce.
 *
 * Restar lo enviado a lo que dicen las planillas da una deuda falsa: las planillas
 * son fuente confiable de cuanto se factura, no de que quedo pagado, y sus estados
 * de pago arrastran meses ya regularizados. Por eso la deuda vive como un
 * Movimiento con fuente "compromiso" en el mes en que se espera pagarla: asi la
 * vista de pendientes y el flujo no se pueden contradecir, porque son el mismo dato.
 */
export interface CompromisoVista {
  colaborador: string
  descripcion: string
  usd: number | null
  montoCLP: number
  anio: number
  mes: number
}

export interface EstadoObligaciones {
  obligaciones: ObligacionVista[]
  calendario: ColumnaCalendario[]
  cotizaciones: CotizacionVista[]
  totales: {
    pagado: number
    pendiente: number
    porGenerar: number
    /** El mes más caro del calendario. */
    peak: { etiqueta: string; monto: number } | null
  }
  cotizacionesAtrasadas: number
  compromisos: CompromisoVista[]
  totalCompromisos: number
}

const clave = (anio: number, mes: number): string => `${anio}-${String(mes).padStart(2, '0')}`
const etiquetaMes = (anio: number, mes: number): string =>
  `${MESES_CORTOS[mes - 1] ?? mes} ${String(anio).slice(2)}`

export async function estadoObligaciones(hoy: Date = new Date()): Promise<EstadoObligaciones> {
  const [registros, cotizaciones, compromisos] = await Promise.all([
    prisma.obligacionFinanciera.findMany({
      where: { activa: true },
      include: { cuotas: { orderBy: [{ anio: 'asc' }, { mes: 'asc' }] } },
      orderBy: [{ tipo: 'asc' }, { fechaActivacion: 'asc' }],
    }),
    prisma.cotizacionPrevisional.findMany({
      orderBy: [{ anioPeriodo: 'asc' }, { mesPeriodo: 'asc' }],
    }),
    prisma.movimiento.findMany({
      where: { fuente: 'compromiso' },
      include: { proveedor: true },
      orderBy: [{ anio: 'asc' }, { mes: 'asc' }],
    }),
  ])

  const obligaciones: ObligacionVista[] = registros.map((o) => {
    const pendientes = o.cuotas.filter((c) => c.estado === 'pendiente' || c.estado === 'atrasada')
    const porGenerar = o.cuotas.filter((c) => c.estado === 'por_generar')
    const pagadas = o.cuotas.filter((c) => c.estado === 'pagada')
    const primera = o.cuotas[0]
    const ultima = o.cuotas[o.cuotas.length - 1]
    const suma = (cs: typeof o.cuotas): number => cs.reduce((a, c) => a + c.monto, 0)
    return {
      id: o.id,
      tipo: o.tipo,
      institucion: o.institucion,
      numero: o.numero,
      marco: o.marco,
      fechaActivacion: o.fechaActivacion.toISOString().slice(0, 10),
      cuotaMensual: o.cuotaMensual,
      pendientes: pendientes.length,
      porGenerar: porGenerar.length,
      pagadas: pagadas.length,
      saldo: suma(pendientes) + suma(porGenerar),
      totalComprometido: suma(o.cuotas),
      primerMes: primera ? { anio: primera.anio, mes: primera.mes } : null,
      ultimoMes: ultima ? { anio: ultima.anio, mes: ultima.mes } : null,
      cuotas: o.cuotas.map((c) => ({ anio: c.anio, mes: c.mes, monto: c.monto, estado: c.estado })),
    }
  })

  // Calendario combinado: una fila por mes, una columna por obligación.
  const meses = new Map<string, { anio: number; mes: number }>()
  for (const o of registros) {
    for (const c of o.cuotas) meses.set(clave(c.anio, c.mes), { anio: c.anio, mes: c.mes })
  }
  const ordenados = [...meses.values()].sort((a, b) => a.anio - b.anio || a.mes - b.mes)
  const indiceMesHoy = hoy.getFullYear() * 12 + hoy.getMonth()

  const calendario: ColumnaCalendario[] = ordenados.map(({ anio, mes }) => {
    const montos = registros.map(
      (o) => o.cuotas.find((c) => c.anio === anio && c.mes === mes)?.monto ?? 0,
    )
    return {
      anio,
      mes,
      etiqueta: etiquetaMes(anio, mes),
      montos,
      total: montos.reduce((a, b) => a + b, 0),
      pasado: anio * 12 + (mes - 1) < indiceMesHoy,
    }
  })

  const peak = calendario.reduce<ColumnaCalendario | null>(
    (mejor, c) => (mejor === null || c.total > mejor.total ? c : mejor),
    null,
  )

  /**
   * Las cotizaciones se pagan por internet hasta el 13 del mes siguiente al
   * período. Todo lo que pase de ahí es atraso, y medirlo es lo que hace visible
   * el rezago acumulado.
   */
  const atraso = (anio: number, mes: number, pago: Date | null): number | null => {
    if (!pago) return null
    const vence = Date.UTC(anio, mes, 13, 12)
    const dias = Math.round((pago.getTime() - vence) / (24 * 3600 * 1000))
    return dias > 0 ? dias : 0
  }

  return {
    obligaciones,
    calendario,
    cotizaciones: cotizaciones.map((c) => ({
      anio: c.anioPeriodo,
      mes: c.mesPeriodo,
      etiqueta: etiquetaMes(c.anioPeriodo, c.mesPeriodo),
      monto: c.monto,
      montoCertificado: c.montoCertificado,
      resto: c.montoCertificado > 0 ? c.monto - c.montoCertificado : 0,
      estado: c.estado,
      fechaPago: c.fechaPago?.toISOString().slice(0, 10) ?? null,
      fechaVencimiento: c.fechaVencimiento?.toISOString().slice(0, 10) ?? null,
      diasDeAtraso: atraso(c.anioPeriodo, c.mesPeriodo, c.fechaPago),
      nota: c.nota,
    })),
    totales: {
      pagado: obligaciones.reduce((a, o) => a + (o.totalComprometido - o.saldo), 0),
      pendiente: obligaciones.reduce(
        (a, o) => a + o.cuotas.filter((c) => c.estado !== 'pagada' && c.estado !== 'por_generar').reduce((x, c) => x + c.monto, 0),
        0,
      ),
      porGenerar: obligaciones.reduce(
        (a, o) => a + o.cuotas.filter((c) => c.estado === 'por_generar').reduce((x, c) => x + c.monto, 0),
        0,
      ),
      peak: peak ? { etiqueta: peak.etiqueta, monto: peak.total } : null,
    },
    cotizacionesAtrasadas: cotizaciones.filter((c) => c.estado === 'atrasada').length,
    compromisos: compromisos.map((m) => ({
      colaborador: m.proveedor?.nombre ?? 'Sin proveedor',
      descripcion: m.descripcion,
      usd: m.monedaOriginal === 'USD' ? m.montoOriginal : null,
      montoCLP: m.montoCLP,
      anio: m.anio,
      mes: m.mes,
    })),
    totalCompromisos: compromisos.reduce((a, m) => a + m.montoCLP, 0),
  }
}
