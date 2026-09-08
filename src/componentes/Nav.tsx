'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Banknote,
  Building2,
  FileSpreadsheet,
  Home,
  Landmark,
  ListFilter,
  Receipt,
  ScrollText,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { ANIO_ACTIVO } from '@/lib/dominio'

const ENLACES: { href: string; etiqueta: string; icono: LucideIcon }[] = [
  { href: '/', etiqueta: 'Inicio', icono: Home },
  { href: '/flujo', etiqueta: 'Flujo', icono: FileSpreadsheet },
  { href: '/movimientos', etiqueta: 'Movimientos', icono: ListFilter },
  { href: '/ventas', etiqueta: 'Ventas', icono: Receipt },
  { href: '/banco', etiqueta: 'Banco', icono: Banknote },
  { href: '/obligaciones', etiqueta: 'Obligaciones', icono: Landmark },
  { href: '/proveedores', etiqueta: 'Proveedores', icono: Building2 },
  { href: '/reglas', etiqueta: 'Reglas', icono: ScrollText },
  { href: '/cargar', etiqueta: 'Cargar', icono: Upload },
]

interface Props {
  email: string | null
  /** Server action que cierra la sesión. */
  salir: () => Promise<void>
}

export function Nav({ email, salir }: Props) {
  // Fuera del router de Next devuelve null: la barra igual tiene que renderizar.
  const ruta = usePathname() ?? ''

  return (
    <header className="sticky top-0 z-10 border-b border-linea bg-superficie/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-2">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold tracking-[-0.01em]">Caja WP</span>
          <span className="text-[11px] text-suave">{ANIO_ACTIVO}</span>
        </Link>

        {email ? (
          <>
            <nav className="flex items-center gap-0.5 overflow-x-auto">
              {ENLACES.map(({ href, etiqueta, icono: Icono }) => {
                const activo = href === '/' ? ruta === '/' : ruta.startsWith(href)
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={activo ? 'page' : undefined}
                    className={
                      'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] whitespace-nowrap transition-colors ' +
                      (activo
                        ? 'bg-panel font-medium text-tinta'
                        : 'text-tenue hover:bg-panel hover:text-tinta')
                    }
                  >
                    <Icono size={14} strokeWidth={2} className={activo ? '' : 'text-suave'} />
                    {etiqueta}
                  </Link>
                )
              })}
            </nav>

            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-[11px] text-suave lg:inline">{email}</span>
              <form action={salir}>
                <button
                  type="submit"
                  className="rounded-md px-2 py-1 text-[11px] text-tenue transition-colors hover:bg-panel hover:text-tinta"
                >
                  Salir
                </button>
              </form>
            </div>
          </>
        ) : null}
      </div>
    </header>
  )
}
