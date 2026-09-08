import 'server-only'
import type { gmail_v1 } from 'googleapis'
import { extractText, getDocumentProxy } from 'unpdf'
import { conReintento } from './cliente'

/**
 * Extrae el texto de un correo: cuerpo en texto plano (o el HTML convertido) y,
 * si trae un PDF adjunto, su texto con una extracción simple.
 */

/** Lo que se le manda al modelo. Más que esto es pagar tokens por pie de página. */
const MAX_CUERPO = 12_000
const MAX_PDF = 8_000
/** Un PDF más grande que esto casi nunca es un recibo. */
const MAX_BYTES_PDF = 5 * 1024 * 1024

export interface ContenidoCorreo {
  texto: string
  pdf: { nombre: string; texto: string } | null
  /** Notas de lo que no se pudo leer, para dejar rastro en CorreoProcesado. */
  avisos: string[]
}

function desdeBase64Url(datos: string): Buffer {
  return Buffer.from(datos.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** Conversión de HTML a texto suficiente para un recibo: sin dependencias. */
export function htmlATexto(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<td[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

/** Recorre el árbol de partes MIME acumulando cuerpos y adjuntos PDF. */
function recorrer(
  parte: gmail_v1.Schema$MessagePart | undefined,
  acumulado: {
    plano: string[]
    html: string[]
    pdfs: { nombre: string; attachmentId: string; tamano: number }[]
  },
): void {
  if (!parte) return

  const tipo = (parte.mimeType ?? '').toLowerCase()
  const nombre = parte.filename ?? ''
  const datos = parte.body?.data

  if (nombre !== '' && parte.body?.attachmentId) {
    const esPdf = tipo === 'application/pdf' || nombre.toLowerCase().endsWith('.pdf')
    if (esPdf) {
      acumulado.pdfs.push({
        nombre,
        attachmentId: parte.body.attachmentId,
        tamano: parte.body.size ?? 0,
      })
    }
  } else if (datos) {
    if (tipo === 'text/plain') acumulado.plano.push(desdeBase64Url(datos).toString('utf8'))
    else if (tipo === 'text/html') acumulado.html.push(desdeBase64Url(datos).toString('utf8'))
  }

  for (const hija of parte.parts ?? []) recorrer(hija, acumulado)
}

export async function extraerContenido(
  gmail: gmail_v1.Gmail,
  mensaje: gmail_v1.Schema$Message,
): Promise<ContenidoCorreo> {
  const avisos: string[] = []
  const acumulado = { plano: [] as string[], html: [] as string[], pdfs: [] as {
    nombre: string
    attachmentId: string
    tamano: number
  }[] }

  recorrer(mensaje.payload, acumulado)

  // El texto plano manda; el HTML es el respaldo cuando no viene.
  let texto = acumulado.plano.join('\n\n').trim()
  if (texto === '' && acumulado.html.length > 0) {
    texto = htmlATexto(acumulado.html.join('\n\n'))
  }
  if (texto === '' && mensaje.snippet) {
    texto = mensaje.snippet
    avisos.push('Sin cuerpo legible: se usó el snippet de Gmail.')
  }
  if (texto.length > MAX_CUERPO) {
    texto = texto.slice(0, MAX_CUERPO)
    avisos.push('Cuerpo recortado a 12.000 caracteres.')
  }

  // Solo el primer PDF: los recibos no traen dos.
  let pdf: ContenidoCorreo['pdf'] = null
  const primerPdf = acumulado.pdfs[0]
  if (primerPdf && mensaje.id) {
    if (primerPdf.tamano > MAX_BYTES_PDF) {
      avisos.push(`PDF "${primerPdf.nombre}" omitido por tamaño (${primerPdf.tamano} bytes).`)
    } else {
      try {
        const adjunto = await conReintento(() =>
          gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: mensaje.id as string,
            id: primerPdf.attachmentId,
          }),
        )
        const datos = adjunto.data.data
        if (datos) {
          const bytes = new Uint8Array(desdeBase64Url(datos))
          const documento = await getDocumentProxy(bytes)
          const { text } = await extractText(documento, { mergePages: true })
          const textoPdf = String(text).replace(/[ \t]+/g, ' ').trim()
          if (textoPdf !== '') {
            pdf = { nombre: primerPdf.nombre, texto: textoPdf.slice(0, MAX_PDF) }
            if (textoPdf.length > MAX_PDF) avisos.push('PDF recortado a 8.000 caracteres.')
          } else {
            avisos.push(`El PDF "${primerPdf.nombre}" no tiene texto (probablemente escaneado).`)
          }
        }
      } catch (error: unknown) {
        avisos.push(
          `No se pudo leer el PDF "${primerPdf.nombre}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
  }
  if (acumulado.pdfs.length > 1) {
    avisos.push(`El correo trae ${acumulado.pdfs.length} PDF; solo se leyó el primero.`)
  }

  return { texto, pdf, avisos }
}
