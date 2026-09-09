import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { signOut } from '@/../auth'
import { sesionActual } from '@/lib/sesion'
import { Nav } from '@/componentes/Nav'
import './globals.css'

/**
 * Inter, con las variantes que efectivamente se usan.
 *
 * `variable` en vez de `className` porque la fuente se referencia desde el @theme
 * de Tailwind, así queda disponible para toda la app sin repetir la clase.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--fuente-inter',
  weight: ['400', '500', '600'],
})

export const metadata: Metadata = {
  title: 'Caja WP · Japybrand WP',
  description: 'Flujo de caja de Japybrand WP',
  /**
   * Fuera de los buscadores, en todas las páginas.
   *
   * El `robots.txt` pide no rastrear; esta cabecera pide no indexar, que no es lo
   * mismo: una URL enlazada desde otro sitio se puede indexar sin rastrearla, y ahí
   * el robots.txt no alcanza. Las dos cosas juntas cubren los dos caminos.
   *
   * `nocache` y `noimageindex` van dentro de googleBot porque son directivas
   * propias de Google y no forman parte del estándar.
   */
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const sesion = await sesionActual()

  async function salir(): Promise<void> {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  return (
    <html lang="es-CL" className={inter.variable}>
      <body>
        {/* La barra lateral es hermana del contenido, no un encabezado: asi puede
            quedar fija a pantalla completa mientras el contenido hace scroll. */}
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Nav email={sesion?.email ?? null} salir={salir} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  )
}
