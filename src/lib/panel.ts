import { prisma } from '@/lib/prisma'
import { calcularFlujo, type NaturalezaMes } from '@/lib/flujo'
import { MESES, MESES_CORTOS } from '@/lib/dominio'

/**
 * Datos del panel de inicio.
 *
 * Todo sale de `calcularFlujo`, del calendario de obligaciones y de la cartola. No
 * hay un segundo cálculo del flujo: si el panel y la grilla pudieran discrepar,
 * el panel dejaría de servir para decidir.
 */

export interface Tarjeta {
  etiqueta: string
  valor: number
  /** Contexto corto bajo la cifra. */
  detalle: string
  /** Solo se pinta lo que comunica estado. */
  tono: 'neutro' | 'negativo' | 'alerta'
  href?: string
}

export interface BarraMes {
  mes: string
  ingresos: number
  egresos: number
  saldo: number
  naturaleza: NaturalezaMes
}

export interface Vencimiento {
  fecha: string
  dias: number
  concepto: string
  monto: number
  /** true si ya venció. */
  vencido: boolean
}

export interface DesgloseEgreso {
  grupo: string
  monto: number
}

export interface MesDeficit {
  mes: string
  saldo: number
  naturaleza: NaturalezaMes
}

export interface Comparacion {
  concepto: string
  anterior: number
  actual: number
  variacion: number | null
  /** true cuando subir es malo. */
  masEsPeor: boolean
}

export interface Panel {
  anio: number
  mesActual: number
  tarjetas: Tarjeta[]
  barras: BarraMes[]
  vencimientos: Vencimiento[]
  egresosDelMes: DesgloseEgreso[]
  deficit: MesDeficit[]
  comparacion: Comparacion[]
}

/** Grupos de egreso, con el nombre que se muestra. */
const GRUPOS_EGRESO: { grupo: string; etiqueta: string }[] = [
  { grupo: 'colaboradores', etiqueta: 'Colaboradores' },
  { grupo: 'proveedores', etiqueta: 'Proveedores' },
  { grupo: 'impuestos', etiqueta: 'Impuestos' },
  { grupo: 'deudas', etiqueta: 'Deudas' },
  { grupo: 'retiros', etiqueta: 'Retiros' },
]

const DIAS_AVISO = 15

export async function calcularPanel(anio: number, hoy: Date = new Date()): Promise<Panel> {
  const flujo = await calcularFlujo(anio)
  const mesActual = hoy.getFullYear() === anio ? hoy.getMonth() + 1 : 12

  const fila = (clave: string): number[] =>
    flujo.filas.find((f) => f.clave === clave)?.montos ?? Array<number>(12).fill(0)

  const financiero = fila('flujo_financiero')
  const ingresos = fila('total_ingresos')

  const egresoDelMes = (i: number): number =>
    GRUPOS_EGRESO.reduce((total, g) => {
      const suma = flujo.filas
        .filter((f) => f.grupo === g.grupo && (f.tipo === 'manual' || f.tipo === 'derivada'))
        .reduce((a, f) => a + (f.montos[i] ?? 0), 0)
      return total + suma
    }, 0)

  // ── Saldos ─────────────────────────────────────────────────────────────────
  const [ultimoBancario, movimientosDelDia] = await Promise.all([
    prisma.movimientoBancario.findFirst({ where: { anio }, orderBy: { fecha: 'desc' } }),
    prisma.movimientoBancario.count({ where: { anio } }),
  ])

  /**
   * El saldo de hoy sale de la cartola, no del flujo: el flujo cierra por mes y a
   * mitad de mes su cifra todavía no es el saldo de la cuenta.
   */
  const saldoActual = await saldoALaFecha(anio, ultimoBancario?.fecha ?? hoy)

  const finDeMes = financiero[mesActual - 1] ?? 0
  const indice90 = Math.min(mesActual + 2, 12) - 1
  const saldo90 = financiero[indice90] ?? 0

  // Carga fija de deuda del mes: convenios y línea de crédito.
  const cuotasDelMes = await prisma.cuotaObligacion.findMany({
    where: { anio, mes: mesActual, obligacion: { activa: true } },
  })
  const cargaFija = cuotasDelMes.reduce((a, c) => a + c.monto, 0)

  const porRevisar = await prisma.movimiento.count({ where: { estado: 'por_revisar' } })
  const sinConciliar = await prisma.movimientoBancario.count({
    where: { estadoConciliacion: 'sin_conciliar' },
  })

  const tarjetas: Tarjeta[] = [
    {
      etiqueta: 'Saldo de la cuenta',
      valor: saldoActual,
      detalle: ultimoBancario
        ? `al ${ultimoBancario.fecha.toISOString().slice(0, 10)} · ${movimientosDelDia} movimientos`
        : 'sin cartola cargada',
      tono: saldoActual < 0 ? 'negativo' : 'neutro',
    },
    {
      etiqueta: `Proyectado a fin de ${MESES[mesActual - 1]?.toLowerCase()}`,
      valor: finDeMes,
      detalle: flujo.naturalezaPorMes[mesActual - 1] === 'real' ? 'mes con cartola' : 'proyección',
      tono: finDeMes < 0 ? 'negativo' : 'neutro',
    },
    {
      etiqueta: 'Proyectado a 90 días',
      valor: saldo90,
      detalle: `cierre de ${MESES[indice90]?.toLowerCase()}`,
      tono: saldo90 < 0 ? 'negativo' : 'neutro',
    },
    {
      etiqueta: 'Deuda fija del mes',
      valor: cargaFija,
      detalle: 'convenios TGR y cuota Fogape',
      tono: cargaFija > 0 ? 'alerta' : 'neutro',
    },
    {
      etiqueta: 'Pendientes de revisar',
      valor: porRevisar + sinConciliar,
      detalle: `${porRevisar} movimientos y ${sinConciliar} cargos del banco`,
      tono: porRevisar + sinConciliar > 0 ? 'alerta' : 'neutro',
      href: '/banco',
    },
  ]

  // ── Barras ─────────────────────────────────────────────────────────────────
  const barras: BarraMes[] = MESES_CORTOS.map((nombre, i) => ({
    mes: nombre,
    ingresos: ingresos[i] ?? 0,
    egresos: egresoDelMes(i),
    saldo: financiero[i] ?? 0,
    naturaleza: flujo.naturalezaPorMes[i] ?? 'proyectado',
  }))

  // ── Egresos del mes en curso ───────────────────────────────────────────────
  const egresosDelMes: DesgloseEgreso[] = GRUPOS_EGRESO.map((g) => ({
    grupo: g.etiqueta,
    monto: flujo.filas
      .filter((f) => f.grupo === g.grupo && (f.tipo === 'manual' || f.tipo === 'derivada'))
      .reduce((a, f) => a + (f.montos[mesActual - 1] ?? 0), 0),
  }))
    .filter((g) => g.monto !== 0)
    .sort((a, b) => b.monto - a.monto)

  // ── Meses en déficit ───────────────────────────────────────────────────────
  const deficit: MesDeficit[] = barras
    .map((b, i) => ({ mes: MESES[i] ?? b.mes, saldo: b.saldo, naturaleza: b.naturaleza }))
    .filter((m) => m.saldo < 0)

  // ── Comparación con el mes anterior ────────────────────────────────────────
  const anterior = mesActual - 2
  const actual = mesActual - 1
  const variacion = (a: number, b: number): number | null =>
    a === 0 ? null : ((b - a) / Math.abs(a)) * 100

  const comparacion: Comparacion[] =
    anterior < 0
      ? []
      : [
          {
            concepto: 'Ingresos',
            anterior: ingresos[anterior] ?? 0,
            actual: ingresos[actual] ?? 0,
            variacion: variacion(ingresos[anterior] ?? 0, ingresos[actual] ?? 0),
            masEsPeor: false,
          },
          {
            concepto: 'Egresos',
            anterior: egresoDelMes(anterior),
            actual: egresoDelMes(actual),
            variacion: variacion(egresoDelMes(anterior), egresoDelMes(actual)),
            masEsPeor: true,
          },
          {
            concepto: 'Flujo del mes',
            anterior: (financiero[anterior] ?? 0) - (financiero[anterior - 1] ?? 0),
            actual: (financiero[actual] ?? 0) - (financiero[anterior] ?? 0),
            variacion: null,
            masEsPeor: false,
          },
        ]

  return {
    anio,
    mesActual,
    tarjetas,
    barras,
    vencimientos: await proximosVencimientos(hoy),
    egresosDelMes,
    deficit,
    comparacion,
  }
}

/** Saldo de la cuenta sumando la cartola desde el saldo inicial de enero. */
async function saldoALaFecha(anio: number, fecha: Date): Promise<number> {
  const inicial = await prisma.valorManual.findFirst({
    where: { anio, mes: 1, categoria: { grupo: 'saldo_inicial' } },
  })
  const movimientos = await prisma.movimientoBancario.aggregate({
    where: { anio, fecha: { lte: fecha } },
    _sum: { monto: true },
  })
  return (inicial?.montoCLP ?? 0) + (movimientos._sum.monto ?? 0)
}

/**
 * Lo que vence en los próximos 15 días, más lo que ya está atrasado.
 *
 * Lo atrasado se incluye aunque su fecha haya pasado: es justamente lo que hay que
 * mirar, y esconderlo por ser viejo sería lo contrario de lo que sirve.
 */
async function proximosVencimientos(hoy: Date): Promise<Vencimiento[]> {
  const limite = new Date(hoy.getTime() + DIAS_AVISO * 24 * 3600 * 1000)
  const dias = (f: Date): number =>
    Math.round((f.getTime() - hoy.getTime()) / (24 * 3600 * 1000))

  const lista: Vencimiento[] = []

  const cuotas = await prisma.cuotaObligacion.findMany({
    where: { estado: { in: ['pendiente', 'atrasada'] }, obligacion: { activa: true } },
    include: { obligacion: true },
  })
  for (const c of cuotas) {
    // Los convenios vencen a fin de mes y la cuota Fogape el día 5.
    const dia = c.obligacion.tipo === 'linea_credito' ? 5 : 28
    const vence = new Date(Date.UTC(c.anio, c.mes - 1, dia, 12))
    if (vence > limite) continue
    lista.push({
      fecha: vence.toISOString().slice(0, 10),
      dias: dias(vence),
      concepto: `${c.obligacion.institucion} ${c.obligacion.numero}`,
      monto: c.monto,
      vencido: vence < hoy,
    })
  }

  const cotizaciones = await prisma.cotizacionPrevisional.findMany({
    where: { estado: { in: ['pendiente', 'atrasada'] } },
  })
  for (const c of cotizaciones) {
    const vence = c.fechaVencimiento ?? new Date(Date.UTC(c.anioPeriodo, c.mesPeriodo, 13, 12))
    if (vence > limite) continue
    lista.push({
      fecha: vence.toISOString().slice(0, 10),
      dias: dias(vence),
      concepto: `Cotización previsional ${MESES_CORTOS[c.mesPeriodo - 1]} ${c.anioPeriodo}`,
      monto: c.monto,
      vencido: vence < hoy,
    })
  }

  return lista.sort((a, b) => a.fecha.localeCompare(b.fecha))
}
