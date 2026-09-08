import 'server-only'
import { google, type gmail_v1 } from 'googleapis'
import { prisma } from '@/lib/prisma'
import { descifrar } from '@/lib/cifrado'

export class SinCuentaGmail extends Error {
  constructor() {
    super('No hay una cuenta de Google conectada. Entra con Google para autorizar el acceso a Gmail.')
    this.name = 'SinCuentaGmail'
  }
}

/**
 * Cliente de Gmail autenticado con el refresh token guardado en CuentaGoogle.
 * googleapis pide el access token solo cuando lo necesita y lo renueva sin ayuda.
 */
export async function clienteGmail(): Promise<{ gmail: gmail_v1.Gmail; email: string }> {
  const cuenta = await prisma.cuentaGoogle.findFirst({ orderBy: { actualizadoEn: 'desc' } })
  if (!cuenta) throw new SinCuentaGmail()

  const oauth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  )
  oauth.setCredentials({ refresh_token: descifrar(cuenta.refreshTokenCifrado) })

  return { gmail: google.gmail({ version: 'v1', auth: oauth }), email: cuenta.email }
}

/** Enlace directo al correo en la interfaz de Gmail. */
export function urlDelCorreo(gmailId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${gmailId}`
}

/** Lee una cabecera del mensaje sin importar mayúsculas. */
export function cabecera(
  mensaje: gmail_v1.Schema$Message | undefined,
  nombre: string,
): string {
  const cabeceras = mensaje?.payload?.headers ?? []
  const objetivo = nombre.toLowerCase()
  for (const h of cabeceras) {
    if ((h.name ?? '').toLowerCase() === objetivo) return h.value ?? ''
  }
  return ''
}

/**
 * Separa un From de la forma `Nombre Visible <correo@dominio>`.
 * Devuelve el correo en minúsculas, o cadena vacía si no se reconoce.
 */
export function partirRemitente(from: string): { email: string; nombre: string } {
  const conAngulos = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from)
  if (conAngulos) {
    const nombre = (conAngulos[1] ?? '').replace(/^"|"$/g, '').trim()
    return { email: (conAngulos[2] ?? '').trim().toLowerCase(), nombre }
  }
  const suelto = from.trim().toLowerCase()
  return { email: /^[^\s@]+@[^\s@]+$/.test(suelto) ? suelto : '', nombre: '' }
}

export const esperar = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms))

/**
 * Ejecuta las tareas de a `tamano` en paralelo, con una pausa entre tandas.
 *
 * Gmail cobra por "unidades de cuota": messages.list y messages.get valen 5 cada
 * uno y el techo es 250 por segundo por usuario. Sin la pausa, recorrer 51
 * proveedores dispara ráfagas muy por encima de ese techo y la API responde 429.
 */
export async function enTandas<T, R>(
  elementos: T[],
  tamano: number,
  tarea: (elemento: T) => Promise<R>,
  pausaMs = 0,
): Promise<R[]> {
  const resultados: R[] = []
  for (let i = 0; i < elementos.length; i += tamano) {
    const tanda = elementos.slice(i, i + tamano)
    resultados.push(...(await Promise.all(tanda.map(tarea))))
    if (pausaMs > 0 && i + tamano < elementos.length) await esperar(pausaMs)
  }
  return resultados
}

/** Códigos con los que Gmail dice "vas muy rápido" o "el servidor falló". */
function esReintentable(error: unknown): boolean {
  const codigo = (error as { code?: number; status?: number } | null)?.code
  const estado = (error as { status?: number } | null)?.status
  const numero = typeof codigo === 'number' ? codigo : estado
  if (numero === 429 || numero === 403 || (typeof numero === 'number' && numero >= 500)) {
    // 403 es ambiguo: puede ser cuota o puede ser permiso. Solo se reintenta el de cuota.
    if (numero === 403) {
      const mensaje = error instanceof Error ? error.message : String(error)
      return /quota|rate limit|userRateLimitExceeded/i.test(mensaje)
    }
    return true
  }
  return false
}

/**
 * Reintenta una llamada a Gmail con espera exponencial cuando choca con la cuota.
 * Cuatro intentos: 1s, 2s, 4s. Si sigue fallando, propaga el error.
 */
export async function conReintento<T>(tarea: () => Promise<T>, intentos = 4): Promise<T> {
  let ultimoError: unknown
  for (let intento = 0; intento < intentos; intento += 1) {
    try {
      return await tarea()
    } catch (error: unknown) {
      ultimoError = error
      if (!esReintentable(error) || intento === intentos - 1) throw error
      await esperar(1000 * 2 ** intento)
    }
  }
  throw ultimoError
}
