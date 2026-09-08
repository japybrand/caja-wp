import { prisma } from '@/lib/prisma'
import { calcularFlujo, type NaturalezaMes } from '@/lib/flujo'
import { ivaPorMes, type IvaDelMes } from '@/lib/sii/iva'
import { MESES, MESES_CORTOS } from '@/lib/dominio'

/**
 * Panel de inicio, en lenguaje de dueño de empresa y no de contador.
 *
 * Responde siete preguntas concretas. Cada bloque trae el numero grande, una frase
 * que explica que significa y, si hay que hacer algo, un verbo con fecha.
 *
 * EL SALDO ACUMULADO DEL FLUJO NO ES PLATA
 * La grilla de /flujo cierra septiembre en -26 millones, pero la cuenta tiene
 * 113.711 y nunca podria llegar ahi: simplemente no se paga todo. Ese numero es la
 * brecha acumulada entre lo comprometido y lo que entro, no un pronostico de caja.
 * Mostrarlo como "cuanta plata vas a tener" seria mentir.
 *
 * Por eso el panel proyecta hacia adelante desde el saldo real del banco: saldo de
 * hoy, mas lo que falta cobrar del mes, menos lo que falta pagar. El resultado se
 * lee como "te faltan X para cubrir el mes", que es la pregunta verdadera.
 */

/** Dias que mira el panel hacia adelante. Es el plazo en que todavia se puede hacer algo. */
export const DIAS_VENTANA = 15

export interface Vencimiento {
  fecha: string
  dias: number
  concepto: string
  /** Que hacer, en imperativo. */
  accion: string
  monto: number
  vencido: boolean
}

export interface Deuda {
  quien: string
  monto: number
  detalle: string
  atrasado: boolean
}

export interface Costo {
  concepto: string
  monto: number
  porcentaje: number
}

export interface BarraMes {
  mes: string
  ingresos: number
  egresos: number
  saldo: number
  naturaleza: NaturalezaMes
}

export interface Comparacion {
  concepto: string
  anterior: number
  actual: number
  variacion: number | null
  masEsPeor: boolean
}

export interface MesDeficit {
  mes: string
  saldo: number
  naturaleza: NaturalezaMes
}

export interface Panel {
  anio: number
  mesActual: number
  nombreMes: string
  hoy: string
  hasta: string

  /** 1. Cuanta plata tengo. */
  saldoHoy: number
  fechaSaldo: string | null
  /** Positivo = sobra, negativo = falta, para cerrar el mes. */
  brechaDelMes: number
  /** true si el registro de ventas del mes esta a medias. */
  mesAMedias: boolean

  /** 2. Atrasos. */
  atrasados: Vencimiento[]
  totalAtrasado: number

  /** 3. Proximos 15 dias. */
  proximos: Vencimiento[]
  totalProximos: number

  /** 4. Alcanza o no. */
  falta: number

  /** 5. IVA. */
  iva: IvaDelMes | null
  ivaEnCurso: IvaDelMes | null

  /** 6. Que cuesta mas. */
  costos: Costo[]
  totalCostos: number

  /** 7. A quien le debo. */
  deudas: Deuda[]
  totalDeuda: number
  cuotaFijaMensual: number

  /** Detalle de abajo. */
  barras: BarraMes[]
  deficit: MesDeficit[]
  comparacion: Comparacion[]
  porRevisar: number
  sinConciliar: number
}

const GRUPOS_EGRESO: { grupo: string; etiqueta: string }[] = [
  { grupo: 'deudas', etiqueta: 'Deudas y convenios' },
  { grupo: 'colaboradores', etiqueta: 'Colaboradores' },
  { grupo: 'proveedores', etiqueta: 'Proveedores' },
  { grupo: 'impuestos', etiqueta: 'Impuestos' },
  { grupo: 'retiros', etiqueta: 'Retiros' },
]

const iso = (d: Date): string => d.toISOString().slice(0, 10)

export async function calcularPanel(anio: number, hoy: Date = new Date()): Promise<Panel> {
  const flujo = await calcularFlujo(anio)
  const mesActual = hoy.getFullYear() === anio ? hoy.getMonth() + 1 : 12
  const i = mesActual - 1
  const hasta = new Date(hoy.getTime() + DIAS_VENTANA * 24 * 3600 * 1000)
  const dias = (f: Date): number => Math.round((f.getTime() - hoy.getTime()) / (24 * 3600 * 1000))

  const fila = (clave: string): number[] =>
    flujo.filas.find((f) => f.clave === clave)?.montos ?? Array<number>(12).fill(0)

  const sumaGrupo = (grupo: string, mes: number): number =>
    flujo.filas
      .filter((f) => f.grupo === grupo && (f.tipo === 'manual' || f.tipo === 'derivada'))
      .reduce((a, f) => a + (f.montos[mes - 1] ?? 0), 0)

  const egresosDelMes = (mes: number): number =>
    GRUPOS_EGRESO.reduce((a, g) => a + sumaGrupo(g.grupo, mes), 0)

  // ── 1. Plata de hoy y brecha del mes ───────────────────────────────────────
  const [inicial, ultimo, entradas, salidas] = await Promise.all([
    prisma.valorManual.findFirst({ where: { anio, mes: 1, categoria: { grupo: 'saldo_inicial' } } }),
    prisma.movimientoBancario.findFirst({ where: { anio }, orderBy: { fecha: 'desc' } }),
    prisma.movimientoBancario.aggregate({
      where: { anio, mes: mesActual, monto: { gt: 0 } },
      _sum: { monto: true },
    }),
    prisma.movimientoBancario.aggregate({
      where: { anio, mes: mesActual, monto: { lt: 0 } },
      _sum: { monto: true },
    }),
  ])
  const acumulado = await prisma.movimientoBancario.aggregate({
    where: { anio, fecha: { lte: ultimo?.fecha ?? hoy } },
    _sum: { monto: true },
  })
  const saldoHoy = (inicial?.montoCLP ?? 0) + (acumulado._sum.monto ?? 0)

  const yaCobrado = entradas._sum.monto ?? 0
  const yaPagado = -(salidas._sum.monto ?? 0)
  const ingresosMes = fila('total_ingresos')[i] ?? 0
  const porCobrar = Math.max(ingresosMes - yaCobrado, 0)
  const porPagar = Math.max(egresosDelMes(mesActual) - yaPagado, 0)
  const brechaDelMes = saldoHoy + porCobrar - porPagar

  // ── 5. IVA ─────────────────────────────────────────────────────────────────
  const filasIva = await ivaPorMes(anio)
  // El que se paga este mes es el del periodo anterior.
  const iva = filasIva.find((f) => f.mesDePago.anio === anio && f.mesDePago.mes === mesActual) ?? null
  const ivaEnCurso = filasIva.find((f) => f.mes === mesActual) ?? null

  // ── 2 y 3. Vencimientos ────────────────────────────────────────────────────
  const todos: Vencimiento[] = []

  const cuotas = await prisma.cuotaObligacion.findMany({
    where: { estado: { in: ['pendiente', 'atrasada'] }, obligacion: { activa: true } },
    include: { obligacion: true },
  })
  for (const c of cuotas) {
    const dia = c.obligacion.tipo === 'linea_credito' ? 5 : 30
    const vence = new Date(Date.UTC(c.anio, c.mes - 1, dia, 12))
    if (vence > hasta) continue
    const esFogape = c.obligacion.tipo === 'linea_credito'
    todos.push({
      fecha: iso(vence),
      dias: dias(vence),
      concepto: esFogape
        ? `Cuota Fogape de ${MESES[c.mes - 1]?.toLowerCase()}`
        : `Convenio TGR ${c.obligacion.numero}`,
      accion: 'Paga la cuota',
      monto: c.monto,
      vencido: vence < hoy,
    })
  }

  const cotizaciones = await prisma.cotizacionPrevisional.findMany({
    where: { estado: { in: ['pendiente', 'atrasada'] } },
  })
  for (const c of cotizaciones) {
    const vence = c.fechaVencimiento ?? new Date(Date.UTC(c.anioPeriodo, c.mesPeriodo, 13, 12))
    if (vence > hasta) continue
    todos.push({
      fecha: iso(vence),
      dias: dias(vence),
      concepto: `Cotización previsional de ${MESES[c.mesPeriodo - 1]?.toLowerCase()}`,
      accion: 'Paga en Previred',
      monto: c.monto,
      vencido: vence < hoy,
    })
  }

  if (iva && iva.aPagar > 0) {
    const vence = new Date(`${iva.venceEl}T12:00:00Z`)
    if (vence <= hasta) {
      todos.push({
        fecha: iva.venceEl,
        dias: dias(vence),
        concepto: `IVA del período ${MESES[iva.mes - 1]?.toLowerCase()}`,
        accion: 'Declara y paga el F29',
        monto: iva.aPagar,
        vencido: vence < hoy,
      })
    }
  }

  todos.sort((a, b) => a.fecha.localeCompare(b.fecha))
  const atrasados = todos.filter((v) => v.vencido)
  const proximos = todos.filter((v) => !v.vencido)
  const totalAtrasado = atrasados.reduce((a, v) => a + v.monto, 0)
  const totalProximos = todos.reduce((a, v) => a + v.monto, 0)

  // ── 6. Qué cuesta más ──────────────────────────────────────────────────────
  const bruto = GRUPOS_EGRESO.map((g) => ({
    concepto: g.etiqueta,
    monto: sumaGrupo(g.grupo, mesActual),
  })).filter((c) => c.monto > 0)
  const totalCostos = bruto.reduce((a, c) => a + c.monto, 0)
  const costos: Costo[] = bruto
    .map((c) => ({ ...c, porcentaje: totalCostos === 0 ? 0 : (c.monto / totalCostos) * 100 }))
    .sort((a, b) => b.monto - a.monto)

  // ── 7. A quién le debo ─────────────────────────────────────────────────────
  const obligaciones = await prisma.obligacionFinanciera.findMany({
    where: { activa: true },
    include: { cuotas: true },
  })
  const deudas: Deuda[] = []
  const convenios = obligaciones.filter((o) => o.tipo === 'convenio_tgr')
  const saldoDe = (o: (typeof obligaciones)[number]): number =>
    o.cuotas.filter((c) => c.estado !== 'pagada').reduce((a, c) => a + c.monto, 0)

  if (convenios.length > 0) {
    const ultimoMes = convenios
      .flatMap((o) => o.cuotas)
      .reduce((max, c) => Math.max(max, c.anio * 12 + c.mes), 0)
    deudas.push({
      quien: `Tesorería, ${convenios.length} convenios`,
      monto: convenios.reduce((a, o) => a + saldoDe(o), 0),
      detalle: `hasta ${MESES_CORTOS[(ultimoMes % 12) - 1 < 0 ? 11 : (ultimoMes % 12) - 1]?.toLowerCase()} ${Math.floor(ultimoMes / 12)}`,
      atrasado: false,
    })
  }
  for (const o of obligaciones.filter((x) => x.tipo === 'linea_credito')) {
    const ultima = o.cuotas.reduce((max, c) => Math.max(max, c.anio * 12 + c.mes), 0)
    deudas.push({
      quien: `${o.institucion}, línea ${o.marco}`,
      monto: saldoDe(o),
      detalle: `hasta ${MESES_CORTOS[(ultima % 12) - 1 < 0 ? 11 : (ultima % 12) - 1]?.toLowerCase()} ${Math.floor(ultima / 12)}`,
      atrasado: false,
    })
  }

  const compromisos = await prisma.movimiento.findMany({
    where: { fuente: 'compromiso' },
    include: { proveedor: true },
  })
  if (compromisos.length > 0) {
    const mesSalida = compromisos[0]?.mes ?? mesActual
    deudas.push({
      quien: 'Colaboradores',
      monto: compromisos.reduce((a, m) => a + m.montoCLP, 0),
      detalle: `sale en ${MESES[mesSalida - 1]?.toLowerCase()}`,
      atrasado: false,
    })
  }
  for (const c of cotizaciones.filter((x) => x.estado === 'atrasada')) {
    deudas.push({
      quien: `Cotización de ${MESES[c.mesPeriodo - 1]?.toLowerCase()}`,
      monto: c.monto,
      detalle: 'atrasada',
      atrasado: true,
    })
  }
  deudas.sort((a, b) => b.monto - a.monto)
  const totalDeuda = deudas.reduce((a, d) => a + d.monto, 0)

  const cuotasProximoMes = await prisma.cuotaObligacion.findMany({
    where: { anio, mes: Math.min(mesActual + 1, 12), obligacion: { activa: true } },
  })
  const cuotaFijaMensual = cuotasProximoMes.reduce((a, c) => a + c.monto, 0)

  // ── Detalle de abajo ───────────────────────────────────────────────────────
  const financiero = fila('flujo_financiero')
  const ingresos = fila('total_ingresos')
  const barras: BarraMes[] = MESES_CORTOS.map((nombre, k) => ({
    mes: nombre,
    ingresos: ingresos[k] ?? 0,
    egresos: egresosDelMes(k + 1),
    saldo: financiero[k] ?? 0,
    naturaleza: flujo.naturalezaPorMes[k] ?? 'proyectado',
  }))

  const deficit: MesDeficit[] = barras
    .map((b, k) => ({ mes: MESES[k] ?? b.mes, saldo: b.saldo, naturaleza: b.naturaleza }))
    .filter((m) => m.saldo < 0)

  const anterior = mesActual - 2
  const variacion = (a: number, b: number): number | null =>
    a === 0 ? null : ((b - a) / Math.abs(a)) * 100
  const comparacion: Comparacion[] =
    anterior < 0
      ? []
      : [
          {
            concepto: 'Ingresos',
            anterior: ingresos[anterior] ?? 0,
            actual: ingresos[i] ?? 0,
            variacion: variacion(ingresos[anterior] ?? 0, ingresos[i] ?? 0),
            masEsPeor: false,
          },
          {
            concepto: 'Egresos',
            anterior: egresosDelMes(anterior + 1),
            actual: egresosDelMes(mesActual),
            variacion: variacion(egresosDelMes(anterior + 1), egresosDelMes(mesActual)),
            masEsPeor: true,
          },
        ]

  const [porRevisar, sinConciliar] = await Promise.all([
    prisma.movimiento.count({ where: { estado: 'por_revisar' } }),
    prisma.movimientoBancario.count({ where: { estadoConciliacion: 'sin_conciliar' } }),
  ])

  return {
    anio,
    mesActual,
    nombreMes: MESES[i] ?? '',
    hoy: iso(hoy),
    hasta: iso(hasta),
    saldoHoy,
    fechaSaldo: ultimo ? iso(ultimo.fecha) : null,
    brechaDelMes,
    // El registro de ventas del mes en curso llega hasta donde el SII alcanzo a
    // registrar, asi que la proyeccion queda corta a proposito. Antes que estimar
    // desde promedios —que es lo que hacia la planilla y por eso fallaba— se avisa.
    mesAMedias: (ivaEnCurso?.documentosVenta ?? 0) > 0 && mesActual === hoy.getMonth() + 1,
    atrasados,
    totalAtrasado,
    proximos,
    totalProximos,
    falta: Math.max(totalProximos - saldoHoy, 0),
    iva,
    ivaEnCurso,
    costos,
    totalCostos,
    deudas,
    totalDeuda,
    cuotaFijaMensual,
    barras,
    deficit,
    comparacion,
    porRevisar,
    sinConciliar,
  }
}
