import { prisma } from '@/lib/prisma'
import { ivaPorMes, type IvaDelMes } from './iva'

/**
 * Formulario 29: lo que efectivamente se paga de impuestos cada mes.
 *
 * El IVA es solo una parte. El F29 suma ademas PPM, retenciones de honorarios y
 * otros conceptos, y esos no se pueden derivar de ningun registro: los informa el
 * contador. Para el periodo agosto de 2026 el IVA son 1.470.812 y el formulario
 * completo 2.429.918.
 *
 * QUE MANDA CUANDO HAY DOS NUMEROS
 * Si el contador informo un total, ese manda sobre la suma de las partes. Es
 * frecuente recibir el monto a pagar antes que el desglose, y el monto a pagar es
 * el hecho: la suma de partes incompletas seria menor y haria parecer que hay mas
 * plata de la que hay.
 */

export interface F29DelMes {
  anioPeriodo: number
  mesPeriodo: number
  /** Calculado desde el SII. Null si falta algun registro del periodo. */
  iva: IvaDelMes | null
  ppm: number
  retencionesHonorarios: number
  otros: number
  /** Lo que informa el contador, si ya lo mandó. */
  totalDeclarado: number | null
  /** Lo que hay que pagar: el declarado si existe, si no la suma de las partes. */
  total: number
  /** true cuando el total sale del formulario y no de una suma parcial. */
  completo: boolean
  /** Cuánto del total no está explicado por el desglose conocido. */
  sinDesglosar: number
  estado: string
  venceEl: string
  mesDePago: { anio: number; mes: number }
  nota: string
}

/** El F29 vence el dia 20 del mes siguiente al periodo. */
const DIA_VENCIMIENTO = 20

function mesSiguiente(anio: number, mes: number): { anio: number; mes: number } {
  return mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 }
}

/**
 * Los F29 de un año, por período.
 *
 * Devuelve un mes aunque no haya declaración cargada: mientras el contador no
 * mande el formulario, el IVA calculado es lo mejor que se sabe, y esconder el
 * período haría parecer que no hay nada que pagar.
 */
export async function f29PorMes(anio: number): Promise<F29DelMes[]> {
  const [ivas, declaraciones] = await Promise.all([
    ivaPorMes(anio),
    prisma.declaracionF29.findMany({ where: { anioPeriodo: anio } }),
  ])
  const porMes = new Map(declaraciones.map((d) => [d.mesPeriodo, d]))

  // Un período existe si tiene IVA calculado o declaración cargada.
  const meses = [...new Set([...ivas.map((i) => i.mes), ...porMes.keys()])].sort((a, b) => a - b)

  return meses.map((mes) => {
    const iva = ivas.find((i) => i.mes === mes) ?? null
    const d = porMes.get(mes)
    const ppm = d?.ppm ?? 0
    const retenciones = d?.retencionesHonorarios ?? 0
    const otros = d?.otros ?? 0
    const suma = (iva?.aPagar ?? 0) + ppm + retenciones + otros
    const total = d?.totalDeclarado ?? suma
    const mesDePago = mesSiguiente(anio, mes)

    return {
      anioPeriodo: anio,
      mesPeriodo: mes,
      iva,
      ppm,
      retencionesHonorarios: retenciones,
      otros,
      totalDeclarado: d?.totalDeclarado ?? null,
      total,
      completo: d?.totalDeclarado != null,
      sinDesglosar: Math.max(total - suma, 0),
      estado: d?.estado ?? 'pendiente',
      venceEl: new Date(Date.UTC(mesDePago.anio, mesDePago.mes - 1, DIA_VENCIMIENTO, 12))
        .toISOString()
        .slice(0, 10),
      mesDePago,
      nota: d?.nota ?? '',
    }
  })
}

/**
 * Los F29 indexados por el mes en que sale la plata.
 *
 * Es lo que consume el flujo: la fila de impuestos de septiembre lleva el F29 del
 * período agosto. Mira también diciembre del año anterior, que se paga en enero.
 */
export async function f29PorMesDePago(anio: number): Promise<Map<number, F29DelMes>> {
  const [previo, actual] = await Promise.all([f29PorMes(anio - 1), f29PorMes(anio)])
  const porPago = new Map<number, F29DelMes>()
  for (const f of [...previo, ...actual]) {
    if (f.mesDePago.anio !== anio) continue
    porPago.set(f.mesDePago.mes, f)
  }
  return porPago
}
