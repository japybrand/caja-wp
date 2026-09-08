import { periodoDelNombre, partirLineaCSV } from './ventas'

/**
 * Registro de Compras del SII.
 *
 * Se importa por el credito fiscal: el IVA a pagar es el debito de las ventas menos
 * el credito de las compras. Sin este registro ese numero hay que estimarlo, y la
 * planilla lo estimaba con errores de millones — marzo iba 2,2 millones abajo y
 * abril 2 millones arriba.
 */

export interface DocumentoCompra {
  tipoDocumento: number
  folio: string
  rutProveedor: string
  razonSocial: string
  fechaDocto: Date
  montoExento: number
  montoNeto: number
  /** Credito fiscal: el IVA que se descuenta del debito. */
  montoIVARecuperable: number
  /** IVA que la ley no deja descontar. Es costo, no credito. */
  montoIVANoRecuperable: number
  montoTotal: number
  mes: number
  anio: number
}

export interface ArchivoCompras {
  anio: number
  mes: number
  documentos: DocumentoCompra[]
}

/** 61 es nota de credito: reduce el credito fiscal en vez de aumentarlo. */
const TIPO_NOTA_CREDITO = 61

export function signoCompra(tipoDocumento: number): number {
  return tipoDocumento === TIPO_NOTA_CREDITO ? -1 : 1
}

function numero(texto: string | undefined): number {
  if (!texto) return 0
  const limpio = texto.replace(/\./g, '').replace(',', '.').trim()
  const n = Number(limpio)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** dd/mm/aaaa, que es como el SII escribe las fechas. */
function fecha(texto: string | undefined, anio: number, mes: number): Date {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((texto ?? '').trim())
  if (!m) return new Date(Date.UTC(anio, mes - 1, 1, 12))
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 12))
}

export function parsearCompras(contenidoLatin1: string, nombreArchivo: string): ArchivoCompras {
  const { anio, mes } = periodoDelNombre(nombreArchivo)
  const lineas = contenidoLatin1.split(/\r?\n/).filter((l) => l.trim() !== '')
  const cabecera = partirLineaCSV(lineas[0] ?? '')

  const indice = (etiqueta: string): number =>
    cabecera.findIndex((c) => c.trim().toLowerCase() === etiqueta.toLowerCase())

  const col = {
    tipo: indice('Tipo Doc'),
    rut: indice('RUT Proveedor'),
    razon: indice('Razon Social'),
    folio: indice('Folio'),
    fecha: indice('Fecha Docto'),
    exento: indice('Monto Exento'),
    neto: indice('Monto Neto'),
    iva: indice('Monto IVA Recuperable'),
    ivaNoRec: indice('Monto Iva No Recuperable'),
    total: indice('Monto Total'),
  }
  for (const [nombre, i] of Object.entries(col)) {
    if (i < 0) throw new Error(`${nombreArchivo}: falta la columna "${nombre}" en la cabecera.`)
  }

  const documentos: DocumentoCompra[] = []
  for (const linea of lineas.slice(1)) {
    const c = partirLineaCSV(linea)
    const tipoDocumento = numero(c[col.tipo])
    if (tipoDocumento === 0) continue

    // El SII repite el documento en lineas de continuacion, con el mismo tipo,
    // folio y RUT pero todos los montos en blanco. Son el detalle de otros
    // impuestos, no documentos nuevos. Sin saltarlas, el upsert por
    // (tipo, folio, rut) pisa la fila buena con ceros y se pierde su credito
    // fiscal: asi desaparecian 15.165 de agosto y 24.270 de septiembre.
    if ((c[col.total] ?? '').trim() === '') continue
    documentos.push({
      tipoDocumento,
      folio: (c[col.folio] ?? '').trim(),
      rutProveedor: (c[col.rut] ?? '').trim(),
      razonSocial: (c[col.razon] ?? '').trim(),
      fechaDocto: fecha(c[col.fecha], anio, mes),
      montoExento: numero(c[col.exento]),
      montoNeto: numero(c[col.neto]),
      montoIVARecuperable: numero(c[col.iva]),
      montoIVANoRecuperable: numero(c[col.ivaNoRec]),
      montoTotal: numero(c[col.total]),
      mes,
      anio,
    })
  }

  return { anio, mes, documentos }
}
