'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Banknote,
  Building2,
  FileSpreadsheet,
  LayoutDashboard,
  Landmark,
  ListFilter,
  LogOut,
  Receipt,
  ScrollText,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { ANIO_ACTIVO } from '@/lib/dominio'

/**
 * Barra lateral.
 *
 * Nueve secciones en una fila horizontal no se pueden escanear: hay que leerlas
 * todas para encontrar una. Agrupadas en tres bloques con encabezado, la lectura
 * baja a elegir un grupo y después un ítem.
 *
 * Los grupos responden a la frecuencia de uso, no a la arquitectura interna:
 * el día a día arriba, los registros que se consultan en medio, y lo que se toca
 * una vez al mes abajo.
 */

interface Enlace {
  href: string
  etiqueta: string
  icono: LucideIcon
}

const GRUPOS: { titulo: string | null; enlaces: Enlace[] }[] = [
  {
    titulo: null,
    enlaces: [{ href: '/', etiqueta: 'Resumen', icono: LayoutDashboard }],
  },
  {
    titulo: 'Día a día',
    enlaces: [
      { href: '/flujo', etiqueta: 'Flujo de caja', icono: FileSpreadsheet },
      { href: '/movimientos', etiqueta: 'Movimientos', icono: ListFilter },
      { href: '/banco', etiqueta: 'Banco', icono: Banknote },
    ],
  },
  {
    titulo: 'Registros',
    enlaces: [
      { href: '/ventas', etiqueta: 'Ventas', icono: Receipt },
      { href: '/obligaciones', etiqueta: 'Obligaciones', icono: Landmark },
      { href: '/proveedores', etiqueta: 'Proveedores', icono: Building2 },
    ],
  },
  {
    titulo: 'Mantención',
    enlaces: [
      { href: '/reglas', etiqueta: 'Reglas', icono: ScrollText },
      { href: '/cargar', etiqueta: 'Cargar archivos', icono: Upload },
    ],
  },
]

interface Props {
  email: string | null
  /** Server action que cierra la sesión. */
  salir: () => Promise<void>
}

export function Nav({ email, salir }: Props) {
  // Fuera del router de Next devuelve null: la barra igual tiene que renderizar.
  const ruta = usePathname() ?? ''

  if (!email) return null

  return (
    <aside className="barra-lateral flex flex-col lg:sticky lg:top-0 lg:h-screen">
      <div className="px-e4 pt-e5 pb-e4">
        <Link href="/" className="block">
          <div className="t-tarjeta">Caja WP</div>
          <div className="t-apoyo mt-0.5">Japybrand WP · {ANIO_ACTIVO}</div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-e2 pb-e4">
        {GRUPOS.map((grupo, i) => (
          <div key={i} className={grupo.titulo ? 'mt-e4' : ''}>
            {grupo.titulo ? <div className="t-zona px-e2 pb-e2">{grupo.titulo}</div> : null}
            <ul className="space-y-px">
              {grupo.enlaces.map(({ href, etiqueta, icono: Icono }) => {
                const activo = href === '/' ? ruta === '/' : ruta.startsWith(href)
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={activo ? 'page' : undefined}
                      className={
                        'flex items-center gap-e2 rounded-[8px] px-e2 py-1.5 text-[12.5px] transition-colors ' +
                        (activo
                          ? 'bg-panel font-medium text-tinta'
                          : 'text-tenue hover:bg-panel/60 hover:text-tinta')
                      }
                    >
                      <Icono
                        size={15}
                        strokeWidth={1.75}
                        className={activo ? 'text-tinta' : 'text-suave'}
                      />
                      {etiqueta}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-linea px-e4 py-e3">
        <div className="t-apoyo truncate">{email}</div>
        <form action={salir}>
          <button
            type="submit"
            className="mt-1 flex items-center gap-1.5 text-[11.5px] text-tenue transition-colors hover:text-tinta"
          >
            <LogOut size={13} strokeWidth={1.75} />
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  )
}
