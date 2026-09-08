import { createHash } from 'node:crypto'
import type { MovimientoG66 } from './parser'

/**
 * Reparto de los pagos internacionales a partir del export de Global66.
 *
 * Antes esto habia que estimarlo: la cartola de Santander solo ve la transferencia
 * total a la cuenta propia en Global66, no a quien se le pago. La estimacion se
 * equivocaba justo donde importa, en los meses en que no alcanzo para todos.
 */

/** Nombres como los escribe Global66 -> proveedor de la app. */
const EQUIVALENCIAS: { patron: RegExp; proveedor: string }[] = [
  { patron: /jimena/i, proveedor: 'Jimena Simos' },
  { patron: /juan pablo/i, proveedor: 'Juan Pablo Ruiz' },
  { patron: /vela/i, proveedor: 'Fernando Vela' },
  { patron: /angelina/i, proveedor: 'Angelina Solano' },
  { patron: /kevin/i, proveedor: 'Kevin Soto' },
]

/**
 * A quien va un envio.
 *
 * Se mira el nombre del tercero y, si viene vacio, el texto del tipo: Global66 le
 * pega el destinatario al tipo de transaccion ("Envío a cuenta bancaria Juan pablo
 * ruiz guerra").
 */
export function proveedorDelEnvio(m: MovimientoG66): string | null {
  const texto = `${m.tercero} ${m.tipoOriginal}`
  return EQUIVALENCIAS.find((e) => e.patron.test(texto))?.proveedor ?? null
}

export interface MesReparto {
  anio: number
  mes: number
  /** Pesos por dolar, ponderado por los dolares comprados en el mes. */
  tipoCambio: number
  /** USD comprados en las conversiones del mes. */
  usdComprado: number
  envios: { proveedor: string | null; tercero: string; usd: number; montoCLP: number }[]
  /** Comisiones de envio, 5 USD cada una. */
  comisionUSD: number
  comisionCLP: number
  /** Costo del cambio, ya en pesos. */
  costoCambio: number
}

/**
 * Convierte cada envio a pesos con el tipo de cambio del mes.
 *
 * Se pondera por los dolares comprados y no se usa un promedio simple: en abril hay
 * cinco conversiones de tamanos muy distintos, y un promedio simple le daria el
 * mismo peso a una de 25 dolares que a una de 2.171.
 *
 * Los dolares son fungibles y la cuenta arrastra saldo de un mes a otro, asi que
 * atribuir a cada envio la conversion exacta que lo financio no es posible ni
 * significativo. Lo que si cuadra, y al peso, es el total: `USD x TC + costo de
 * cambio` reproduce la transferencia de Santander de ese mes.
 */
export function repartirPorMes(movimientos: MovimientoG66[]): MesReparto[] {
  const claves = [...new Set(movimientos.map((m) => `${m.anio}-${String(m.mes).padStart(2, '0')}`))]
  claves.sort()

  return claves.map((clave) => {
    const [anio, mes] = clave.split('-').map(Number) as [number, number]
    const delMes = movimientos.filter((m) => m.anio === anio && m.mes === mes)

    const conversiones = delMes.filter((m) => m.tipo === 'conversion')
    const usdComprado = conversiones.reduce((a, m) => a + m.acreditado, 0)
    const tipoCambio =
      usdComprado > 0
        ? conversiones.reduce((a, m) => a + m.acreditado * m.tipoCambio, 0) / usdComprado
        : 0

    const comisionUSD = delMes
      .filter((m) => m.tipo === 'comision')
      .reduce((a, m) => a + m.debitado, 0)

    return {
      anio,
      mes,
      tipoCambio,
      usdComprado,
      envios: delMes
        .filter((m) => m.tipo === 'envio')
        .map((m) => ({
          proveedor: proveedorDelEnvio(m),
          tercero: m.tercero || m.tipoOriginal,
          usd: m.debitado,
          montoCLP: Math.round(m.debitado * tipoCambio),
        })),
      comisionUSD,
      comisionCLP: Math.round(comisionUSD * tipoCambio),
      costoCambio: delMes.reduce((a, m) => a + m.costoCambio, 0),
    }
  })
}

/** Clave estable de una fila del export, para que reimportar no duplique. */
export function hashMovimiento(m: MovimientoG66, archivo: string, ordinal: number): string {
  return createHash('sha256')
    .update(
      [
        archivo,
        m.fecha.toISOString().slice(0, 10),
        m.tipoOriginal,
        m.debitado,
        m.acreditado,
        m.idTransaccion,
        ordinal,
      ].join('|'),
    )
    .digest('hex')
}
