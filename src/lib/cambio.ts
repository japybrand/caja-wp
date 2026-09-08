import 'server-only'
import { prisma } from '@/lib/prisma'

/**
 * Dólar observado desde mindicador.cl, cacheado en TipoCambio.
 *
 * mindicador publica solo días hábiles: para un sábado, un domingo o un feriado
 * la serie viene vacía, así que se camina hacia atrás hasta encontrar el último
 * día publicado. `fechaFuente` guarda de qué día salió realmente el valor, para
 * que después se pueda auditar de dónde vino un monto convertido.
 */

const DIAS_HACIA_ATRAS = 7

/** Fecha en UTC a medianoche, que es como se guardan las claves de la caché. */
function aDia(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()))
}

function comoDDMMAAAA(fecha: Date): string {
  const dia = String(fecha.getUTCDate()).padStart(2, '0')
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, '0')
  return `${dia}-${mes}-${fecha.getUTCFullYear()}`
}

interface RespuestaMindicador {
  serie?: { fecha?: string; valor?: number }[]
}

async function consultarMindicador(fecha: Date): Promise<number | null> {
  const url = `https://mindicador.cl/api/dolar/${comoDDMMAAAA(fecha)}`
  const respuesta = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!respuesta.ok) throw new Error(`mindicador.cl respondió ${respuesta.status}`)

  const datos = (await respuesta.json()) as RespuestaMindicador
  const valor = datos.serie?.[0]?.valor
  return typeof valor === 'number' && valor > 0 ? valor : null
}

export interface Conversion {
  valorCLP: number
  fechaFuente: Date
}

/**
 * Valor del dólar observado para una fecha. Devuelve null si mindicador no
 * responde o no hay dato en los últimos 7 días hábiles.
 */
export async function dolarObservado(fecha: Date): Promise<Conversion | null> {
  // mindicador no publica el futuro: una fecha por delante de hoy se ancla en hoy.
  const hoy = aDia(new Date())
  const pedida = aDia(fecha)
  const dia = pedida > hoy ? hoy : pedida

  const enCache = await prisma.tipoCambio.findUnique({
    where: { moneda_fecha: { moneda: 'USD', fecha: dia } },
  })
  if (enCache) return { valorCLP: enCache.valorCLP, fechaFuente: enCache.fechaFuente }

  for (let atras = 0; atras < DIAS_HACIA_ATRAS; atras += 1) {
    const candidata = new Date(dia)
    candidata.setUTCDate(candidata.getUTCDate() - atras)

    const valor = await consultarMindicador(candidata)
    if (valor === null) continue

    // Se cachea bajo el día pedido, con nota de qué día salió el valor.
    await prisma.tipoCambio.upsert({
      where: { moneda_fecha: { moneda: 'USD', fecha: dia } },
      create: { moneda: 'USD', fecha: dia, valorCLP: valor, fechaFuente: candidata },
      update: { valorCLP: valor, fechaFuente: candidata },
    })
    return { valorCLP: valor, fechaFuente: candidata }
  }

  return null
}

export interface ResultadoConversion {
  montoCLP: number
  tasa: number | null
  fechaFuente: Date | null
  error?: string
}

/** Convierte a pesos enteros. Un monto ya en CLP pasa derecho. */
export async function aPesos(
  monto: number,
  moneda: string,
  fecha: Date,
): Promise<ResultadoConversion> {
  if (moneda === 'CLP') {
    return { montoCLP: Math.round(monto), tasa: null, fechaFuente: null }
  }

  try {
    const conversion = await dolarObservado(fecha)
    if (!conversion) {
      return {
        montoCLP: 0,
        tasa: null,
        fechaFuente: null,
        error: `No se encontró el dólar observado para el ${fecha.toISOString().slice(0, 10)}.`,
      }
    }
    return {
      montoCLP: Math.round(monto * conversion.valorCLP),
      tasa: conversion.valorCLP,
      fechaFuente: conversion.fechaFuente,
    }
  } catch (error: unknown) {
    return {
      montoCLP: 0,
      tasa: null,
      fechaFuente: null,
      error: error instanceof Error ? error.message : 'Falló la consulta del tipo de cambio.',
    }
  }
}
