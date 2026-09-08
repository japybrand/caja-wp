import { leerXlsx } from '@/lib/banco/xlsx'

/**
 * Lector del export de movimientos de la cuenta Global66.
 *
 * Los pagos internacionales no salen uno a uno desde Santander: se transfiere un
 * monto a la cuenta propia en Global66 y desde ahi se paga a cada colaborador. La
 * cartola solo ve la transferencia total, asi que sin este export habia que repartir
 * a ojo. Con el, cada envio trae nombre, monto en dolares y fecha.
 *
 * Tres tipos de fila:
 *
 *  - "Envio a cuenta bancaria": el pago. Debita USD y nombra al destinatario.
 *  - "Comision envio": 5 USD fijos por envio. Se enlaza al envio porque el `idFees`
 *    del envio es el `idTransaccion` de la comision, no al reves.
 *  - "Conversion de divisas": acredita USD comprados con pesos, con el tipo de
 *    cambio aplicado y su costo.
 *
 * El archivo viene con extension .xls pero es xlsx: se lee con el mismo lector que
 * las cartolas de Santander.
 */

export type TipoMovimientoG66 = 'envio' | 'comision' | 'conversion' | 'costo_cambio' | 'otro'

export interface MovimientoG66 {
  tipo: TipoMovimientoG66
  /** Texto original del tipo, para no perder los casos que no clasificamos. */
  tipoOriginal: string
  fecha: Date
  anio: number
  mes: number
  /** USD que salen de la cuenta. */
  debitado: number
  /** USD que entran a la cuenta. */
  acreditado: number
  /** Costo del cambio, en pesos. */
  costoCambio: number
  /** En un envio, el id de su comision. */
  idFees: string
  /** Destinatario del envio, tal como lo escribe Global66. */
  tercero: string
  /** Pesos por dolar de la conversion. En los envios viene 1. */
  tipoCambio: number
  idTransaccion: string
  comentario: string
}

export interface ExportG66 {
  archivo: string
  hoja: string
  /** Texto del "Periodo consultado" de la fila 2. */
  periodo: string
  desde: Date | null
  hasta: Date | null
  movimientos: MovimientoG66[]
}

const COLUMNAS = {
  tipo: 1,
  fecha: 2,
  debitado: 3,
  acreditado: 4,
  costoCambio: 5,
  idFees: 6,
  tarjeta: 7,
  tercero: 8,
  dni: 9,
  cuenta: 10,
  pais: 11,
  tipoCambio: 12,
  idTransaccion: 13,
  comentario: 14,
} as const

/** La cabecera esta en la fila 4 y los datos empiezan en la 5. */
const FILA_CABECERA = 4

function texto(v: string | number | null): string {
  return v === null ? '' : String(v).trim()
}

/**
 * Los numeros llegan a veces como texto ("5.00", "300.0") y a veces como numero.
 * El separador decimal es el punto, sin miles, asi que no hay que normalizar comas.
 */
function numero(v: string | number | null): number {
  if (v === null) return 0
  if (typeof v === 'number') return v
  const limpio = v.replace(/[^\d.-]/g, '')
  const n = Number(limpio)
  return Number.isFinite(n) ? n : 0
}

/** "2026-09-04 17:41:55" -> Date. */
function fechaDe(v: string | number | null): Date | null {
  const t = texto(v)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
}

/**
 * El texto del tipo trae el nombre del destinatario pegado
 * ("Envío a cuenta bancaria Juan pablo ruiz guerra"), asi que hay que clasificar
 * por prefijo y no por igualdad.
 *
 * Hay dos formas de envio: "Envío a cuenta bancaria X" cuando sale a un banco, y
 * "Envío a X" cuando va a otra cuenta Global66. La segunda no cobra los 5 USD de
 * comision, y por eso en 2026 hay 19 envios y solo 18 comisiones.
 */
function clasificar(tipo: string): TipoMovimientoG66 {
  const t = tipo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  if (t.startsWith('comision env')) return 'comision'
  if (t.startsWith('conversion de divisas')) return 'conversion'
  if (t.startsWith('envio a')) return 'envio'
  // En 2025 los pagos se llamaban "Transferencia enviada" y el costo del cambio
  // venia en su propia fila en vez de la columna de la conversion.
  if (t.startsWith('transferencia enviada')) return 'envio'
  if (t.startsWith('costo tipo de cambio')) return 'costo_cambio'
  return 'otro'
}

/**
 * Reconoce un export de Global66 por el contenido, no por el nombre del archivo.
 *
 * Hace falta porque el nombre solo trae el rango de fechas
 * ("movements-01-2026_09-2026.xls") y no dice ni que es ni de que periodo: el
 * periodo real esta en la fila 2 de la hoja.
 */
export function esExportGlobal66(datos: Uint8Array): boolean {
  try {
    const hoja = leerXlsx(datos)
    if (!/movimientos de cuenta/i.test(hoja.nombre)) return false
    const cabecera = texto(hoja.celda(FILA_CABECERA, COLUMNAS.tipo))
    return /tipo de transacci/i.test(cabecera)
  } catch {
    return false
  }
}

export function parsearExportG66(datos: Uint8Array, nombreArchivo: string): ExportG66 {
  const hoja = leerXlsx(datos)

  const cabecera = texto(hoja.celda(FILA_CABECERA, COLUMNAS.tipo))
  if (!/tipo de transacci/i.test(cabecera)) {
    throw new Error(
      `"${nombreArchivo}" no parece un export de Global66: la fila ${FILA_CABECERA} dice "${cabecera}".`,
    )
  }

  const periodo = texto(hoja.celda(2, 1))
  const fechas = [...periodo.matchAll(/(\d{2})[-/](\d{2})[-/](\d{4})|(\d{4})-(\d{2})-(\d{2})/g)].map(
    (m) =>
      m[4]
        ? new Date(Date.UTC(Number(m[4]), Number(m[5]) - 1, Number(m[6]), 12))
        : new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12)),
  )

  const movimientos: MovimientoG66[] = []
  for (let f = FILA_CABECERA + 1; f <= hoja.filas; f += 1) {
    const tipoOriginal = texto(hoja.celda(f, COLUMNAS.tipo))
    if (tipoOriginal === '') continue
    const fecha = fechaDe(hoja.celda(f, COLUMNAS.fecha))
    if (!fecha) continue

    movimientos.push({
      tipo: clasificar(tipoOriginal),
      tipoOriginal,
      fecha,
      anio: fecha.getUTCFullYear(),
      mes: fecha.getUTCMonth() + 1,
      debitado: numero(hoja.celda(f, COLUMNAS.debitado)),
      acreditado: numero(hoja.celda(f, COLUMNAS.acreditado)),
      costoCambio: numero(hoja.celda(f, COLUMNAS.costoCambio)),
      idFees: texto(hoja.celda(f, COLUMNAS.idFees)),
      tercero: texto(hoja.celda(f, COLUMNAS.tercero)),
      tipoCambio: numero(hoja.celda(f, COLUMNAS.tipoCambio)),
      idTransaccion: texto(hoja.celda(f, COLUMNAS.idTransaccion)),
      comentario: texto(hoja.celda(f, COLUMNAS.comentario)),
    })
  }

  movimientos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime())

  return {
    archivo: nombreArchivo,
    hoja: hoja.nombre,
    periodo,
    desde: fechas[0] ?? null,
    hasta: fechas[1] ?? null,
    movimientos,
  }
}
