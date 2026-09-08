'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ANIO_ACTIVO } from '@/lib/dominio'

const ENLACES = [
  { href: '/', etiqueta: 'Inicio' },
  { href: '/flujo', etiqueta: 'Flujo de caja' },
  { href: '/movimientos', etiqueta: 'Movimientos' },
  { href: '/ventas', etiqueta: 'Ventas' },
  { href: '/banco', etiqueta: 'Banco' },
  { href: '/obligaciones', etiqueta: 'Obligaciones' },
  { href: '/proveedores', etiqueta: 'Proveedores' },
  { href: '/reglas', etiqueta: 'Reglas' },
  { href: '/cargar', etiqueta: 'Cargar' },
]

interface Props {
  email: string | null
  /** Server action que cierra la sesión. */
  salir: () => Promise<void>
}

export function Nav({ email, salir }: Props) {
  const ruta = usePathname()

  return (
    <header className="flex items-center gap-6 border-b border-linea-fuerte bg-panel px-4 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold tracking-tight">Caja WP</span>
        <span className="text-[11px] text-tenue">Japybrand WP · {ANIO_ACTIVO}</span>
      </div>

      {email ? (
        <>
          <nav className="flex items-center gap-1">
            {ENLACES.map((enlace) => {
              const activo = ruta === enlace.href || ruta.startsWith(enlace.href + '/')
              return (
                <Link
                  key={enlace.href}
                  href={enlace.href}
                  className={
                    'rounded px-2.5 py-1 text-[12px] transition-colors ' +
                    (activo
                      ? 'bg-white font-medium text-tinta shadow-[0_0_0_1px_var(--color-linea-fuerte)]'
                      : 'text-tenue hover:bg-white/70 hover:text-tinta')
                  }
                >
                  {enlace.etiqueta}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-[11px] text-tenue">{email}</span>
            <form action={salir}>
              <button
                type="submit"
                className="text-[11px] text-tenue underline underline-offset-2 hover:text-tinta"
              >
                Salir
              </button>
            </form>
          </div>
        </>
      ) : null}
    </header>
  )
}
