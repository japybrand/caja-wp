import type { NextAuthConfig } from 'next-auth'
import Google from 'next-auth/providers/google'

/**
 * Configuración compatible con el runtime Edge, que es donde corre el middleware.
 *
 * Aquí no puede entrar nada de Prisma ni de node:crypto. La parte que escribe en
 * la base (guardar el refresh token cifrado) vive en auth.ts, que solo se carga
 * en el runtime de Node.
 */

export const SCOPE_GMAIL = 'https://www.googleapis.com/auth/gmail.readonly'

/** Correos autorizados, desde ALLOWED_EMAILS separados por coma. */
export function correosPermitidos(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((correo) => correo.trim().toLowerCase())
    .filter((correo) => correo !== '')
}

export function estaPermitido(email: string | null | undefined): boolean {
  if (!email) return false
  const permitidos = correosPermitidos()
  // Sin lista configurada no entra nadie: más seguro que dejar pasar a todos.
  if (permitidos.length === 0) return false
  return permitidos.includes(email.toLowerCase())
}

export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          // El mismo consentimiento sirve para entrar a la app y para leer Gmail.
          scope: `openid email profile ${SCOPE_GMAIL}`,
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email
      return token
    },
    session({ session, token }) {
      if (token.email) session.user.email = token.email
      return session
    },
    authorized({ auth: sesion }) {
      return estaPermitido(sesion?.user?.email)
    },
  },
} satisfies NextAuthConfig
