import { baseUrl, type Correo } from './enviar'

/**
 * La plantilla de los avisos.
 *
 * SOBRIA Y CON UNA SOLA ACCIÓN
 * Un aviso se lee en el teléfono, de pasada, y tiene que dejar claras tres cosas:
 * qué pasa, cuánto pesa y adónde ir. Por eso lleva un párrafo, una tabla opcional y
 * un solo botón. Sin logos, sin columnas, sin colores decorativos: el rojo y el
 * ámbar quedan para el estado, igual que en la aplicación.
 *
 * TODO EN LÍNEA Y CON VERSIÓN DE TEXTO
 * Los clientes de correo ignoran las hojas de estilo externas y muchos recortan las
 * etiquetas `<style>`, así que el CSS va en cada elemento. La versión de texto
 * plano no es un trámite: es la que se ve en la notificación del teléfono, que
 * muchas veces es lo único que se lee.
 */

const TINTA = '#14181d'
const TENUE = '#5f6875'
const LINEA = '#e6e9ed'

export interface Fila {
  concepto: string
  detalle?: string
  monto?: string
}

export interface Aviso {
  asunto: string
  /** Una frase con el hecho. Sin rodeos y con la cifra adentro. */
  encabezado: string
  /** Por qué importa. Opcional: si el encabezado se basta, se omite. */
  explicacion?: string
  filas?: Fila[]
  /** Ruta relativa, sin dominio. */
  ruta: string
  textoBoton: string
}

const escapar = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function componer(aviso: Aviso): Correo {
  const url = `${baseUrl()}${aviso.ruta}`

  const filas = (aviso.filas ?? [])
    .map(
      (f) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid ${LINEA};font-size:14px;color:${TINTA}">
            ${escapar(f.concepto)}
            ${f.detalle ? `<div style="font-size:12px;color:${TENUE};margin-top:2px">${escapar(f.detalle)}</div>` : ''}
          </td>
          <td style="padding:8px 0;border-bottom:1px solid ${LINEA};font-size:14px;color:${TINTA};text-align:right;white-space:nowrap">
            ${f.monto ? escapar(f.monto) : ''}
          </td>
        </tr>`,
    )
    .join('')

  const html = `<!doctype html>
<html lang="es-CL"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid ${LINEA};border-radius:12px;padding:24px">
    <div style="font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#98a1ad">Caja WP</div>
    <p style="margin:12px 0 0;font-size:16px;line-height:1.45;color:${TINTA};font-weight:600">${escapar(aviso.encabezado)}</p>
    ${aviso.explicacion ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:${TENUE}">${escapar(aviso.explicacion)}</p>` : ''}
    ${filas ? `<table style="width:100%;border-collapse:collapse;margin-top:16px">${filas}</table>` : ''}
    <a href="${url}" style="display:inline-block;margin-top:20px;padding:10px 16px;background:${TINTA};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:500">${escapar(aviso.textoBoton)} →</a>
    <p style="margin:20px 0 0;font-size:12px;color:#98a1ad">Este aviso lo manda Caja WP una vez al día. Si ya lo resolviste, ignóralo.</p>
  </div>
</body></html>`

  const texto = [
    aviso.encabezado,
    aviso.explicacion ?? '',
    ...(aviso.filas ?? []).map(
      (f) => `- ${f.concepto}${f.detalle ? ` (${f.detalle})` : ''}${f.monto ? `: ${f.monto}` : ''}`,
    ),
    '',
    `${aviso.textoBoton}: ${url}`,
  ]
    .filter((l) => l !== '')
    .join('\n')

  return { asunto: aviso.asunto, html, texto }
}
