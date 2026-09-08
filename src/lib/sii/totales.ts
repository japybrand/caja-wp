import { signo, TIPO_NOTA_CREDITO } from './ventas'

/**
 * Totales y ranking a partir de documentos de venta del SII.
 *
 * Sirve tanto al importador como a la pantalla /ventas, así que trabaja sobre una
 * forma mínima del documento y no depende de Prisma.
 */

export interface DocumentoParaTotales {
  tipoDocumento: number
  folio: string
  rutCliente: string
  razonSocial: string
  fechaDocto: Date
  montoExento: number
  montoNeto: number
  montoIVA: number
  montoTotal: number
  mes: number
  tipoReferencia?: number | null
  folioReferencia?: string | null
}

export interface TotalMes {
  mes: number
  documentos: number
  notasCredito: number
  exento: number
  neto: number
  iva: number
  total: number
}

const vacio = (mes: number): TotalMes => ({
  mes,
  documentos: 0,
  notasCredito: 0,
  exento: 0,
  neto: 0,
  iva: 0,
  total: 0,
})

/** Un arreglo de 12 posiciones, con el mes 1 en el índice 0. */
export function totalesPorMes(documentos: DocumentoParaTotales[]): TotalMes[] {
  const meses = Array.from({ length: 12 }, (_, i) => vacio(i + 1))
  for (const d of documentos) {
    const t = meses[d.mes - 1]
    if (!t) continue
    const s = signo(d.tipoDocumento)
    if (s === 0) continue
    t.documentos += 1
    if (d.tipoDocumento === TIPO_NOTA_CREDITO) t.notasCredito += 1
    t.exento += s * d.montoExento
    t.neto += s * d.montoNeto
    t.iva += s * d.montoIVA
    t.total += s * d.montoTotal
  }
  return meses
}

export interface ClienteRanking {
  rut: string
  razonSocial: string
  documentos: number
  total: number
  neto: number
  iva: number
}

/**
 * Ranking por cliente, agrupado por RUT y no por razón social: el mismo RUT viene
 * escrito de más de una forma (por ejemplo "RC INGENIERIA" y "RC INGENIERA"), y
 * agrupar por nombre lo parte en dos.
 */
export function rankingClientes(documentos: DocumentoParaTotales[]): ClienteRanking[] {
  const porRut = new Map<string, ClienteRanking & { ultimaFecha: Date }>()

  for (const d of documentos) {
    const s = signo(d.tipoDocumento)
    if (s === 0) continue
    const rut = d.rutCliente.trim()
    let c = porRut.get(rut)
    if (!c) {
      c = {
        rut,
        razonSocial: d.razonSocial,
        documentos: 0,
        total: 0,
        neto: 0,
        iva: 0,
        ultimaFecha: d.fechaDocto,
      }
      porRut.set(rut, c)
    }
    c.documentos += 1
    c.total += s * d.montoTotal
    c.neto += s * d.montoNeto
    c.iva += s * d.montoIVA
    // Se muestra la razón social más reciente.
    if (d.fechaDocto >= c.ultimaFecha) {
      c.ultimaFecha = d.fechaDocto
      c.razonSocial = d.razonSocial
    }
  }

  return [...porRut.values()]
    .map(({ ultimaFecha: _ultimaFecha, ...resto }) => resto)
    .sort((a, b) => b.total - a.total)
}

export interface NotaCredito {
  mes: number
  folio: string
  fechaDocto: Date
  rutCliente: string
  razonSocial: string
  montoTotal: number
  tipoReferencia: number | null
  folioReferencia: string | null
  /** El documento al que apunta, si está entre los cargados. */
  referencia: {
    mes: number
    fechaDocto: Date
    montoTotal: number
    mismoMonto: boolean
  } | null
}

/**
 * Las notas de crédito con el documento que anulan resuelto. Sin esto una 61 es un
 * monto suelto y no se ve que está corrigiendo una factura de otro mes.
 */
export function notasCredito(documentos: DocumentoParaTotales[]): NotaCredito[] {
  const porTipoFolio = new Map<string, DocumentoParaTotales>()
  for (const d of documentos) porTipoFolio.set(`${d.tipoDocumento}|${d.folio}`, d)

  return documentos
    .filter((d) => d.tipoDocumento === TIPO_NOTA_CREDITO)
    .map((d) => {
      const clave =
        d.tipoReferencia && d.folioReferencia ? `${d.tipoReferencia}|${d.folioReferencia}` : ''
      const ref = clave === '' ? undefined : porTipoFolio.get(clave)
      return {
        mes: d.mes,
        folio: d.folio,
        fechaDocto: d.fechaDocto,
        rutCliente: d.rutCliente,
        razonSocial: d.razonSocial,
        montoTotal: d.montoTotal,
        tipoReferencia: d.tipoReferencia ?? null,
        folioReferencia: d.folioReferencia ?? null,
        referencia: ref
          ? {
              mes: ref.mes,
              fechaDocto: ref.fechaDocto,
              montoTotal: ref.montoTotal,
              mismoMonto: ref.montoTotal === d.montoTotal,
            }
          : null,
      }
    })
    .sort((a, b) => a.mes - b.mes || a.folio.localeCompare(b.folio))
}
