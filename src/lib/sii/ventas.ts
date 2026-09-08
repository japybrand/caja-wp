import path from 'node:path'
import { readFile } from 'node:fs/promises'

/**
 * Lector del Registro de Ventas del SII (RCV).
 *
 * Los archivos vienen en CSV con separador punto y coma y codificación Latin-1,
 * y se llaman RCV_VENTA_<rut>_<AAAAMM>.csv. El período está en el nombre del
 * archivo, no adentro: dentro solo hay fechas de documento, que pueden caer en
 * otro mes.
 */

/** 33 factura afecta, 34 factura exenta: suman. */
export const TIPOS_QUE_SUMAN = [33, 34]
/** 61 nota de crédito: resta. */
export const TIPO_NOTA_CREDITO = 61

/**
 * El tipo 48 (comprobante de pago electrónico) no aparece en el detalle: el SII
 * lo entrega como resumen mensual. Es la causa de las diferencias chicas contra
 * la planilla, que sí los cuenta.
 */
export const TIPO_COMPROBANTE_PAGO = 48

export interface DocumentoVentaSII {
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
  anio: number
  archivoOrigen: string
  tipoReferencia: number | null
  folioReferencia: string | null
}

/** +1 para las que suman, −1 para las notas de crédito, 0 para lo que se ignora. */
export function signo(tipoDocumento: number): number {
  if (TIPOS_QUE_SUMAN.includes(tipoDocumento)) return 1
  if (tipoDocumento === TIPO_NOTA_CREDITO) return -1
  return 0
}

/** Divide una línea de CSV respetando comillas dobles. */
export function partirLineaCSV(linea: string, separador = ';'): string[] {
  const campos: string[] = []
  let actual = ''
  let entreComillas = false
  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i]
    if (c === '"') {
      if (entreComillas && linea[i + 1] === '"') {
        actual += '"'
        i += 1
      } else entreComillas = !entreComillas
    } else if (c === separador && !entreComillas) {
      campos.push(actual)
      actual = ''
    } else actual += c
  }
  campos.push(actual)
  return campos.map((x) => x.trim())
}

/** Los montos vienen enteros, pero puede colarse separador de miles. */
function numero(valor: string | undefined): number {
  const limpio = (valor ?? '').replace(/\./g, '').replace(/,/g, '.').trim()
  if (limpio === '' || limpio === '-') return 0
  const n = Number(limpio)
  return Number.isFinite(n) ? Math.round(n) : 0
}

function entero(valor: string | undefined): number | null {
  const limpio = (valor ?? '').trim()
  if (limpio === '' || limpio === '-' || limpio === '0') return null
  const n = Number(limpio)
  return Number.isInteger(n) ? n : null
}

/** "01/08/2026" -> Date en UTC. */
function fecha(valor: string | undefined): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec((valor ?? '').trim())
  if (!m) return null
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])))
}

/** RCV_VENTA_76513765-9_202608.csv -> { anio: 2026, mes: 8 } */
export function periodoDelNombre(nombreArchivo: string): { anio: number; mes: number } {
  const m = /_(\d{4})(\d{2})\.csv$/i.exec(nombreArchivo)
  if (!m) {
    throw new Error(
      `${nombreArchivo}: el nombre no termina en _AAAAMM.csv, y el período solo está ahí.`,
    )
  }
  const mes = Number(m[2])
  if (mes < 1 || mes > 12) throw new Error(`${nombreArchivo}: mes inválido (${m[2]}).`)
  return { anio: Number(m[1]), mes }
}

export interface ArchivoVentas {
  archivo: string
  anio: number
  mes: number
  documentos: DocumentoVentaSII[]
  /** Documentos que no son 33, 34 ni 61: se cuentan pero no entran en los totales. */
  tiposIgnorados: Map<number, number>
}

export function parsearVentas(contenidoLatin1: string, nombreArchivo: string): ArchivoVentas {
  const { anio, mes } = periodoDelNombre(nombreArchivo)
  const lineas = contenidoLatin1.split(/\r?\n/).filter((l) => l.trim() !== '')
  const cabecera = partirLineaCSV(lineas[0] ?? '')

  const indice = (etiqueta: string): number =>
    cabecera.findIndex((c) => c.toLowerCase() === etiqueta.toLowerCase())

  const col = {
    tipo: indice('Tipo Doc'),
    rut: indice('Rut cliente'),
    razon: indice('Razon Social'),
    folio: indice('Folio'),
    fecha: indice('Fecha Docto'),
    exento: indice('Monto Exento'),
    neto: indice('Monto Neto'),
    iva: indice('Monto IVA'),
    total: indice('Monto total'),
    tipoRef: indice('Tipo Docto. Referencia'),
    folioRef: indice('Folio Docto. Referencia'),
  }
  const faltantes = Object.entries(col)
    .filter(([, i]) => i < 0)
    .map(([k]) => k)
  if (faltantes.length > 0) {
    throw new Error(`${nombreArchivo}: faltan columnas en la cabecera: ${faltantes.join(', ')}`)
  }

  const documentos: DocumentoVentaSII[] = []
  const tiposIgnorados = new Map<number, number>()

  for (const linea of lineas.slice(1)) {
    const campos = partirLineaCSV(linea)
    const tipoDocumento = Number((campos[col.tipo] ?? '').trim())
    if (!Number.isInteger(tipoDocumento)) continue

    if (signo(tipoDocumento) === 0) {
      tiposIgnorados.set(tipoDocumento, (tiposIgnorados.get(tipoDocumento) ?? 0) + 1)
      continue
    }

    const fechaDocto = fecha(campos[col.fecha])
    if (!fechaDocto) continue

    documentos.push({
      tipoDocumento,
      folio: (campos[col.folio] ?? '').trim(),
      rutCliente: (campos[col.rut] ?? '').trim(),
      razonSocial: (campos[col.razon] ?? '').trim(),
      fechaDocto,
      montoExento: numero(campos[col.exento]),
      montoNeto: numero(campos[col.neto]),
      montoIVA: numero(campos[col.iva]),
      montoTotal: numero(campos[col.total]),
      mes,
      anio,
      archivoOrigen: nombreArchivo,
      tipoReferencia: entero(campos[col.tipoRef]),
      folioReferencia: (campos[col.folioRef] ?? '').trim() || null,
    })
  }

  return { archivo: nombreArchivo, anio, mes, documentos, tiposIgnorados }
}

export async function leerArchivoVentas(ruta: string): Promise<ArchivoVentas> {
  // Latin-1: los nombres con eñes y acentos salen mal si se lee como UTF-8.
  const contenido = (await readFile(ruta)).toString('latin1')
  return parsearVentas(contenido, path.basename(ruta))
}

export async function leerCarpetaVentas(carpeta: string): Promise<ArchivoVentas[]> {
  const { readdir } = await import('node:fs/promises')
  const archivos = (await readdir(carpeta)).filter((n) => /\.csv$/i.test(n)).sort()
  const resultado: ArchivoVentas[] = []
  for (const nombre of archivos) resultado.push(await leerArchivoVentas(path.join(carpeta, nombre)))
  return resultado
}
