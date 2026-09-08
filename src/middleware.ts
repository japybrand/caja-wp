import NextAuth from 'next-auth'
import { authConfig } from '../auth.config'

/**
 * Protege toda la aplicación. Usa auth.config.ts y no auth.ts porque el
 * middleware corre en el runtime Edge, donde Prisma y node:crypto no existen.
 *
 * Quedan fuera del matcher:
 *  - /login y las rutas de Auth.js, para poder entrar.
 *  - /api/ingesta/*, que se autentica con CRON_SECRET y no con sesión.
 *  - los archivos estáticos de Next.
 */
export default NextAuth(authConfig).auth

export const config = {
  matcher: ['/((?!api/auth|api/ingesta|login|_next/static|_next/image|favicon.ico).*)'],
}
