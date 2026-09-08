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
        <Nav email={sesion?.email ?? null} salir={salir} />
        <main>{children}</main>
      </body>
    </html>
  )
}
