import { auth, estaPermitido } from '@/../auth'

export class SinAutorizacion extends Error {
  constructor(mensaje = 'Necesitas iniciar sesión.') {
    super(mensaje)
    this.name = 'SinAutorizacion'
  }
}

/**
 * Guardia para server actions y route handlers.
 *
 * El middleware ya bloquea la navegacion, pero las server actions se invocan por
 * POST y merecen su propia verificacion: si alguna vez el matcher del middleware
 * cambia, esto sigue cerrado.
 */
export async function requerirSesion(): Promise<{ email: string }> {
  const sesion = await auth()
  const email = sesion?.user?.email
  if (!estaPermitido(email)) throw new SinAutorizacion()
  return { email: email as string }
}

/** Igual que requerirSesion pero devuelve null en vez de lanzar. */
export async function sesionActual(): Promise<{ email: string } | null> {
  const sesion = await auth()
  const email = sesion?.user?.email
  return estaPermitido(email) ? { email: email as string } : null
}
