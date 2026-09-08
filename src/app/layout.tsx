import type { Metadata } from 'next'
import { signOut } from '@/../auth'
import { sesionActual } from '@/lib/sesion'
import { Nav } from '@/componentes/Nav'
import './globals.css'

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
    <html lang="es-CL">
      <body>
        <Nav email={sesion?.email ?? null} salir={salir} />
        <main>{children}</main>
      </body>
    </html>
  )
}
