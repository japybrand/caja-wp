import { unzipSync, strFromU8 } from 'fflate'

/**
 * Lector mínimo de xlsx, escrito para las cartolas de Santander.
 *
 * ExcelJS no puede con estos archivos por dos razones: la hoja se llama
 * `xl/worksheets/sheet.xml` en vez de `sheet1.xml`, y todos los elementos van con
 * el prefijo de namespace `x:` (`<x:row>`, `<x:c>`, `<x:v>`) además de un BOM.
 *
 * Lo que se necesita de estos archivos es poco —una hoja, celdas de texto y de
 * número, sin fórmulas ni fechas serializadas— así que sale más barato y más
 * robusto leerlo directo que forzar una librería general.
 */

export interface HojaXlsx {
  nombre: string
  filas: number
  columnas: number
  /** Valor de una celda 1-indexada. null si está vacía. */
  celda: (fila: number, columna: number) => string | number | null
}

/** Quita el prefijo de namespace: "x:row" -> "row". */
function sinPrefijo(etiqueta: string): string {
  const i = etiqueta.indexOf(':')
  return i < 0 ? etiqueta : etiqueta.slice(i + 1)
}

function decodificar(texto: string): string {
  return texto
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

/** "BC12" -> { columna: 55, fila: 12 } */
function referencia(ref: string): { columna: number; fila: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) return null
  const [, letras, digitos] = m as unknown as [string, string, string]
  let columna = 0
  for (const letra of letras) columna = columna * 26 + (letra.charCodeAt(0) - 64)
  return { columna, fila: Number(digitos) }
}

/** Los textos compartidos: <si> puede traer varios <t> cuando hay texto enriquecido. */
function leerCadenas(xml: string): string[] {
  const cadenas: string[] = []
  const bloques = xml.split(/<(?:\w+:)?si[\s>]/).slice(1)
  for (const bloque of bloques) {
    const fin = bloque.indexOf('</' + (bloque.includes('x:si>') ? 'x:si>' : 'si>'))
    const contenido = fin > 0 ? bloque.slice(0, fin) : bloque
    let texto = ''
    const re = /<(\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(contenido)) !== null) texto += decodificar(m[2] ?? '')
    cadenas.push(texto)
  }
  return cadenas
}

export function leerXlsx(datos: Uint8Array): HojaXlsx {
  const archivos = unzipSync(datos)

  const texto = (ruta: string): string => {
    const encontrado =
      archivos[ruta] ??
      archivos[Object.keys(archivos).find((k) => k.toLowerCase() === ruta.toLowerCase()) ?? '']
    if (!encontrado) return ''
    return strFromU8(encontrado).replace(/^﻿/, '')
  }

  // Nombre de la hoja, del workbook.
  const workbook = texto('xl/workbook.xml')
  const nombre = decodificar(/<(?:\w+:)?sheet\b[^>]*\bname="([^"]*)"/.exec(workbook)?.[1] ?? 'Hoja1')

  // La hoja puede llamarse sheet.xml o sheet1.xml.
  const rutaHoja =
    Object.keys(archivos).find((k) => /^xl\/worksheets\/sheet[^/]*\.xml$/i.test(k)) ?? ''
  if (rutaHoja === '') throw new Error('El archivo no tiene ninguna hoja legible.')

  const cadenas = leerCadenas(texto('xl/sharedStrings.xml'))
  const hoja = texto(rutaHoja)

  const valores = new Map<string, string | number>()
  let maxFila = 0
  let maxColumna = 0

  // Cada celda: <x:c r="A17" t="s"><x:v>3</x:v></x:c>, o <x:c r="A17"/> si está vacía.
  //
  // Los atributos van con cuantificador perezoso y el `/>` se prueba primero: con
  // `[^>]*` glotón, la barra de una celda autocerrada se cuela en los atributos, la
  // alternativa con contenido se queda esperando el `</x:c>` de la celda SIGUIENTE y
  // se traga las celdas intermedias. El síntoma es que todo queda corrido de columna.
  const reCelda = /<(\w+:)?c\b([^>]*?)\s*(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g
  let m: RegExpExecArray | null
  while ((m = reCelda.exec(hoja)) !== null) {
    const atributos = m[2] ?? ''
    const cuerpo = m[3] ?? ''
    const ref = /\br="([A-Z]+\d+)"/.exec(atributos)?.[1]
    if (!ref) continue
    const pos = referencia(ref)
    if (!pos) continue

    const tipo = /\bt="([^"]*)"/.exec(atributos)?.[1] ?? 'n'
    let valor: string | number | null = null

    if (tipo === 'inlineStr') {
      let acumulado = ''
      const reT = /<(\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g
      let t: RegExpExecArray | null
      while ((t = reT.exec(cuerpo)) !== null) acumulado += decodificar(t[2] ?? '')
      valor = acumulado
    } else {
      const bruto = /<(?:\w+:)?v(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cuerpo)?.[1]
      if (bruto === undefined) continue
      if (tipo === 's') {
        valor = cadenas[Number(bruto)] ?? ''
      } else if (tipo === 'str' || tipo === 'e') {
        valor = decodificar(bruto)
      } else if (tipo === 'b') {
        valor = bruto === '1' ? 'TRUE' : 'FALSE'
      } else {
        const n = Number(bruto)
        valor = Number.isFinite(n) ? n : decodificar(bruto)
      }
    }

    if (valor === null || valor === '') continue
    valores.set(`${pos.fila}:${pos.columna}`, valor)
    if (pos.fila > maxFila) maxFila = pos.fila
    if (pos.columna > maxColumna) maxColumna = pos.columna
  }

  return {
    nombre,
    filas: maxFila,
    columnas: maxColumna,
    celda: (fila, columna) => valores.get(`${fila}:${columna}`) ?? null,
  }
}
