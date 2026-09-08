import { prisma } from '@/lib/prisma'

/**
 * Envío de correos con Resend.
 *
 * MODO SECO SIN API KEY
 * Sin `RESEND_API_KEY` no falla: escribe el correo en el log y sigue. Así el cron
 * se puede probar de punta a punta —incluida la lógica de qué avisar y cuándo— sin
 * mandarle nada a nadie, que es justo lo que hace falta al desarrollar reglas que
 * se disparan el día 11 o los lunes.
 *
 * EL REGISTRO ES PARTE DEL ENVÍO
 * Cada aviso se anota en `AvisoEnviado` antes de decidir si se manda otra vez. Sin
 * eso, el aviso de una cuota que vence en cinco días llegaría cinco veces y el de
 * la bandeja estancada llegaría todos los días. Un aviso que se repite se deja de
 * leer, y entonces deja de servir el día que trae algo nuevo.
 */

const RESEND = 'https://api.resend.com/emails'

export const destino = (): string => process.env.ALERTAS_DESTINO ?? 'finanzas@japybrand.cl'
export const remitente = (): string => process.env.ALERTAS_REMITENTE ?? 'caja@japybrand.com'

/**
 * La base de los enlaces de los correos.
 *
 * Reutiliza AUTH_URL en vez de una variable propia: es la misma URL y tener dos
 * habría abierto la puerta a que se desincronizaran, con correos apuntando a un
 * dominio viejo sin que nada avisara.
 */
export const baseUrl = (): string => (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '')

export interface Correo {
  asunto: string
  html: string
  texto: string
}

/** Manda el correo. Devuelve el error como texto en vez de lanzarlo. */
export async function enviarCorreo(correo: Correo): Promise<{ ok: boolean; error: string }> {
  const clave = process.env.RESEND_API_KEY
  if (!clave) {
    console.log(`[correo, modo seco] para ${destino()}: ${correo.asunto}\n${correo.texto}\n`)
    return { ok: true, error: '' }
  }

  try {
    const respuesta = await fetch(RESEND, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Caja WP <${remitente()}>`,
        to: [destino()],
        subject: correo.asunto,
        html: correo.html,
        text: correo.texto,
      }),
    })
    if (!respuesta.ok) {
      return { ok: false, error: `${respuesta.status} ${(await respuesta.text()).slice(0, 300)}` }
    }
    return { ok: true, error: '' }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Si un aviso ya salió y todavía no toca repetirlo.
 *
 * `repetirCadaDias` en 0 significa "una sola vez": el aviso del día 11 o el de una
 * cuota concreta no se repiten nunca, porque el hecho que describen no cambia. Los
 * que describen una situación que persiste —la cartola atrasada, la bandeja
 * estancada— se repiten cada siete días mientras dure.
 */
export async function yaSeAviso(
  tipo: string,
  clave: string,
  repetirCadaDias: number,
): Promise<boolean> {
  const previo = await prisma.avisoEnviado.findUnique({ where: { tipo_clave: { tipo, clave } } })
  if (!previo) return false
  // Un envío que falló no cuenta como avisado: hay que reintentarlo.
  if (previo.error !== '') return false
  if (repetirCadaDias <= 0) return true
  const dias = (Date.now() - previo.enviadoEn.getTime()) / 86_400_000
  return dias < repetirCadaDias
}

/** Deja constancia del envío. Se sobrescribe si el aviso se repite. */
export async function registrarAviso(
  tipo: string,
  clave: string,
  asunto: string,
  error: string,
): Promise<void> {
  const datos = { tipo, clave, asunto, destino: destino(), error, enviadoEn: new Date() }
  await prisma.avisoEnviado.upsert({
    where: { tipo_clave: { tipo, clave } },
    create: datos,
    update: datos,
  })
}
