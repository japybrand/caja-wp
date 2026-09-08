import NextAuth from 'next-auth'
import { prisma } from '@/lib/prisma'
import { cifrar } from '@/lib/cifrado'
import { authConfig, estaPermitido } from './auth.config'

/**
 * Configuración completa, para el runtime de Node. Extiende auth.config.ts (que es
 * la parte que el middleware puede correr en Edge) con el callback que guarda el
 * refresh token de Google cifrado en CuentaGoogle.
 *
 * Un solo flujo de OAuth para las dos cosas: entrar a la app y leer Gmail.
 *
 * No se usa el adaptador de Prisma a propósito: guardaría el refresh token en
 * texto plano en su tabla Account.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (!estaPermitido(user.email)) return false

      // Google solo manda refresh_token cuando hay consentimiento nuevo; por eso
      // el provider pide prompt=consent. Si aun así no viene, se conserva el que
      // ya estaba guardado en vez de pisarlo con nada.
      if (account?.provider === 'google' && account.refresh_token && user.email) {
        await prisma.cuentaGoogle.upsert({
          where: { email: user.email.toLowerCase() },
          create: {
            email: user.email.toLowerCase(),
            refreshTokenCifrado: cifrar(account.refresh_token),
            scope: account.scope ?? '',
          },
          update: {
            refreshTokenCifrado: cifrar(account.refresh_token),
            scope: account.scope ?? '',
          },
        })
      }
      return true
    },
  },
})

export { estaPermitido, correosPermitidos, SCOPE_GMAIL } from './auth.config'
