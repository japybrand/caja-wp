import { createHash } from 'node:crypto'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { leerXlsx, type HojaXlsx } from './xlsx'

/**
 * Parser de cartolas de Banco Santander.
 *
 * Hay dos formatos:
 *  - Histórica  (hoja "Cartola Historica CtaCte"): trae bloque de línea de crédito
 *    y el resumen de saldos con 7 columnas.
 *  - Provisoria (hoja "CartolaProvisoria"): sin línea de crédito, saldos con 4 columnas.
 *
 * Se leen con el lector propio de ./xlsx: ExcelJS no puede con estos archivos porque
 * la hoja se llama `sheet.xml` y los elementos van con prefijo de namespace.
 *
 * No se asume ninguna fila fija: se busca la cabecera que dice MONTO y DESCRIPCIÓN
 * MOVIMIENTO. Eso importa porque el archivo trae TRES bloques con la misma cabecera:
 *
 *   1. "Detalle movimientos"  ← el único que cuenta
 *   2. "Resumen comisiones"   cabecera repetida, filas marcadas C, importes de centavos
 *      (-10,307) que NO están en el resumen de saldos
 *   3. "Saldos diarios"       solo monto y fecha, sin CARGO/ABONO
 *
 * Leer de corrido infla los abonos con los saldos diarios y descuadra los cargos en
 * 10 o 20 pesos con las comisiones. Por eso se corta al llegar a esos títulos y se
 * exige que CARGO/ABONO sea C o A.
 */

/** Títulos que cierran el bloque de movimientos. */
const TITULOS_DE_CORTE = ['RESUMEN COMISIONES', 'SALDOS DIARIOS']

export interface MovimientoCartola {
  fecha: Date
  mes: number
  anio: number
  /** Negativo para cargos, positivo para abonos. Pesos enteros. */
  monto: number
  descripcion: string
  nDocumento: string
  sucursal: string
  tipo: 'C' | 'A'
  /** Distingue filas idénticas del mismo archivo. Hay 16 casos reales. */
  ordinal: number
  hash: string
}

export interface Cartola {
  archivo: string
  hoja: string
  banco: string
  cuenta: string
  numeroCartola: string
  desde: string
  hasta: string
  saldoInicial: number
  saldoFinal: number
  /** Totales que declara la cabecera del archivo. */
  cabeceraCargos: number
  cabeceraAbonos: number
  /** Totales que suman los movimientos leídos. */
  cargos: number
  abonos: number
  movimientos: MovimientoCartola[]
  /** El bloque "Resumen comisiones", informativo: no entra en los totales. */
  comisiones: { monto: number; descripcion: string }[]
  cuadra: boolean
  difCargos: number
  difAbonos: number
}

function normalizar(valor: unknown): string {
  if (valor === null || valor === undefined) return ''
  return String(valor).replace(/\s+/g, ' ').trim()
}

function enMayusculas(valor: unknown): string {
  return normalizar(valor)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

function comoNumero(valor: unknown): number | null {
  return typeof valor === 'number' ? valor : null
}

/** "02/01/2026" -> Date en UTC. */
function comoFecha(valor: unknown): Date | null {
  if (valor instanceof Date) {
    return new Date(Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate()))
  }
  const texto = normalizar(valor)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto)
  if (!m) return null
  const [, d, mes, anio] = m
  return new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(d)))
}

function extraerEtiqueta(texto: string, etiqueta: string): string {
  const i = texto.toUpperCase().indexOf(etiqueta.toUpperCase())
  if (i < 0) return ''
  return texto.slice(i + etiqueta.length).replace(/^[:\s]+/, '').trim()
}

export function calcularHash(datos: {
  banco: string
  cuenta: string
  fecha: Date
  monto: number
  descripcion: string
  nDocumento: string
  ordinal: number
}): string {
  const clave = [
    datos.banco,
    datos.cuenta,
    datos.fecha.toISOString().slice(0, 10),
    String(datos.monto),
    datos.descripcion,
    datos.nDocumento,
    String(datos.ordinal),
  ].join('|')
  return createHash('sha256').update(clave, 'utf8').digest('hex')
}

export async function leerCartola(rutaArchivo: string): Promise<Cartola> {
  const datos = await readFile(rutaArchivo)
  return parsearCartola(new Uint8Array(datos), path.basename(rutaArchivo))
}

/** Igual que leerCartola pero desde los bytes, para la carga por la web. */
export function parsearCartola(datos: Uint8Array, nombreArchivo: string): Cartola {
  let hoja: HojaXlsx
  try {
    hoja = leerXlsx(datos)
  } catch (error: unknown) {
    throw new Error(
      `${nombreArchivo}: no se pudo leer el archivo. ${error instanceof Error ? error.message : ''}`,
    )
  }

  const maxFila = hoja.filas
  const maxCol = Math.max(hoja.columnas, 8)
  const celda = (f: number, c: number): unknown => hoja.celda(f, c)

  // --- Cabecera de la tabla de movimientos --------------------------------
  let filaCabecera = 0
  const columna: Record<string, number> = {}
  for (let f = 1; f <= Math.min(maxFila, 40); f += 1) {
    const valores: string[] = []
    for (let c = 1; c <= maxCol; c += 1) valores.push(enMayusculas(celda(f, c)))
    if (valores.includes('MONTO') && valores.some((v) => v.startsWith('DESCRIPCION'))) {
      filaCabecera = f
      for (let c = 1; c <= maxCol; c += 1) {
        const v = valores[c - 1] ?? ''
        if (v === 'MONTO') columna['monto'] = c
        else if (v.startsWith('DESCRIPCION')) columna['descripcion'] = c
        else if (v === 'FECHA') columna['fecha'] = c
        else if (v.includes('DOCUMENTO')) columna['nDocumento'] = c
        else if (v === 'SUCURSAL') columna['sucursal'] = c
        else if (v.includes('CARGO')) columna['tipo'] = c
      }
      break
    }
  }
  if (filaCabecera === 0) {
    throw new Error(
      `${nombreArchivo}: no se encontró la cabecera con MONTO y DESCRIPCIÓN MOVIMIENTO.`,
    )
  }

  // --- Datos de la cuenta y resumen de saldos -----------------------------
  let cuenta = ''
  let numeroCartola = ''
  let desde = ''
  let hasta = ''
  let filaSaldos = 0
  for (let f = 1; f < filaCabecera; f += 1) {
    for (let c = 1; c <= maxCol; c += 1) {
      const bruto = normalizar(celda(f, c))
      if (bruto === '') continue
      const arriba = bruto.toUpperCase()
      if (cuenta === '' && arriba.includes('CUENTA') && /\d-\d{3}-\d{7}-\d/.test(bruto)) {
        cuenta = /(\d-\d{3}-\d{7}-\d)/.exec(bruto)?.[1] ?? ''
      }
      if (numeroCartola === '' && arriba.startsWith('NUMERO CARTOLA')) {
        numeroCartola = extraerEtiqueta(bruto, 'cartola')
      }
      if (desde === '' && arriba.includes('FECHA DESDE')) desde = extraerEtiqueta(bruto, 'desde')
      if (hasta === '' && arriba.includes('FECHA HASTA')) hasta = extraerEtiqueta(bruto, 'hasta')
      if (filaSaldos === 0 && arriba === 'SALDO INICIAL') filaSaldos = f
    }
  }

  const saldos: Record<string, number> = {}
  if (filaSaldos > 0) {
    for (let c = 1; c <= maxCol; c += 1) {
      const etiqueta = enMayusculas(celda(filaSaldos, c))
      const valor = comoNumero(celda(filaSaldos + 1, c))
      if (etiqueta !== '' && valor !== null) saldos[etiqueta] = valor
    }
  }

  const saldoInicial = saldos['SALDO INICIAL'] ?? 0
  const saldoFinal = saldos['SALDO FINAL'] ?? 0
  // Histórica: DEPÓSITOS + OTROS ABONOS / CHEQUES + OTROS CARGOS + IMPUESTOS.
  // Provisoria: ABONOS / CARGOS.
  const esHistorica = 'OTROS ABONOS' in saldos
  const cabeceraAbonos = esHistorica
    ? (saldos['DEPOSITOS'] ?? 0) + (saldos['OTROS ABONOS'] ?? 0)
    : (saldos['ABONOS'] ?? 0)
  const cabeceraCargos = esHistorica
    ? (saldos['CHEQUES'] ?? 0) + (saldos['OTROS CARGOS'] ?? 0) + (saldos['IMPUESTOS'] ?? 0)
    : (saldos['CARGOS'] ?? 0)

  // --- Movimientos --------------------------------------------------------
  const movimientos: MovimientoCartola[] = []
  const comisiones: { monto: number; descripcion: string }[] = []
  const vistos = new Map<string, number>()
  let enComisiones = false

  for (let f = filaCabecera + 1; f <= maxFila; f += 1) {
    const primera = enMayusculas(celda(f, 1))
    if (TITULOS_DE_CORTE.includes(primera)) {
      if (primera === 'SALDOS DIARIOS') break
      enComisiones = true
      continue
    }
    // La cabecera se repite dentro del bloque de comisiones.
    if (primera === 'MONTO' || primera === 'SALDO') continue

    const monto = comoNumero(celda(f, columna['monto'] ?? 1))
    const tipo = enMayusculas(celda(f, columna['tipo'] ?? 8))
    if (monto === null || (tipo !== 'C' && tipo !== 'A')) continue

    const descripcion = normalizar(celda(f, columna['descripcion'] ?? 2))
    if (descripcion === '') continue

    if (enComisiones) {
      comisiones.push({ monto, descripcion })
      continue
    }

    const fecha = comoFecha(celda(f, columna['fecha'] ?? 4))
    if (!fecha) continue

    const nDocumento = normalizar(celda(f, columna['nDocumento'] ?? 5))
    const sucursal = normalizar(celda(f, columna['sucursal'] ?? 6))
    const redondeado = Math.round(monto)

    // Dos filas idénticas en el mismo archivo son dos movimientos distintos:
    // el ordinal las separa sin perder ninguna.
    const clave = `${fecha.toISOString().slice(0, 10)}|${redondeado}|${descripcion}|${nDocumento}`
    const ordinal = (vistos.get(clave) ?? 0) + 1
    vistos.set(clave, ordinal)

    movimientos.push({
      fecha,
      mes: fecha.getUTCMonth() + 1,
      anio: fecha.getUTCFullYear(),
      monto: redondeado,
      descripcion,
      nDocumento,
      sucursal,
      tipo,
      ordinal,
      hash: calcularHash({
        banco: 'Santander',
        cuenta,
        fecha,
        monto: redondeado,
        descripcion,
        nDocumento,
        ordinal,
      }),
    })
  }

  const cargos = movimientos.filter((m) => m.monto < 0).reduce((a, m) => a + m.monto, 0)
  const abonos = movimientos.filter((m) => m.monto > 0).reduce((a, m) => a + m.monto, 0)
  const difCargos = cargos - cabeceraCargos
  const difAbonos = abonos - cabeceraAbonos

  return {
    archivo: nombreArchivo,
    hoja: hoja.nombre,
    banco: 'Santander',
    cuenta,
    numeroCartola,
    desde,
    hasta,
    saldoInicial,
    saldoFinal,
    cabeceraCargos,
    cabeceraAbonos,
    cargos,
    abonos,
    movimientos,
    comisiones,
    cuadra: difCargos === 0 && difAbonos === 0,
    difCargos,
    difAbonos,
  }
}

/** Lee todas las cartolas de una carpeta, ordenadas por nombre de archivo. */
export async function leerCarpeta(carpeta: string): Promise<Cartola[]> {
  const { readdir } = await import('node:fs/promises')
  const archivos = (await readdir(carpeta))
    .filter((n) => /\.xlsx?$/i.test(n) && !n.startsWith('~$'))
    .sort()
  const cartolas: Cartola[] = []
  for (const nombre of archivos) cartolas.push(await leerCartola(path.join(carpeta, nombre)))
  return cartolas
}
