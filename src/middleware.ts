import NextAuth from 'next-auth'
import { authConfig } from '../auth.config'

/**
 * Protege toda la aplicación. Usa auth.config.ts y no auth.ts porque el
 * middleware corre en el runtime Edge, donde Prisma y node:crypto no existen.
 *
 * Quedan fuera del matcher:
 *  - /login y las rutas de Auth.js, para poder entrar.
 *  - /api/ingesta/* y /api/cron/*, que se autentican con CRON_SECRET y no con
 *    sesión. Las dos rutas quedan fuera porque el cron de Vercel llega sin cookie:
 *    si el middleware las tomara, recibiría un redirect al login y la corrida
 *    diaria fallaría en silencio, con un 200 y una página HTML.
 *  - /robots.txt, que tiene que poder leerse SIN sesión: si el middleware lo toma,
 *    el buscador recibe un 307 al login en vez del archivo, y el bloqueo no existe.
 *    Se comprobó en producción: el primer despliegue lo redirigía.
 *  - los archivos estáticos de Next.
 *
 * TODO LO QUE ENTRE POR ESAS DOS RUTAS TIENE QUE VALIDAR CRON_SECRET POR SU CUENTA.
 * Están fuera de la sesión a propósito, así que son públicas hasta que el handler
 * compare el header. Ver /api/ingesta/gmail como referencia.
 */
export default NextAuth(authConfig).auth

export const config = {
  matcher: [
    '/((?!api/auth|api/ingesta|api/cron|login|robots.txt|sitemap.xml|_next/static|_next/image|favicon.ico).*)',
  ],
}
