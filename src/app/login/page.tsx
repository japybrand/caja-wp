import { redirect } from 'next/navigation'
import { signIn } from '@/../auth'
import { sesionActual } from '@/lib/sesion'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PaginaLogin({ searchParams }: Props) {
  if (await sesionActual()) redirect('/flujo')

  const parametros = await searchParams
  const error = typeof parametros['error'] === 'string' ? parametros['error'] : null

  return (
    <div className="flex min-h-[calc(100vh-41px)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-[15px] font-semibold tracking-tight">Caja WP</h1>
        <p className="mt-1 text-[12px] text-tenue">
          Flujo de caja de Japybrand WP. El acceso está restringido a las cuentas autorizadas.
        </p>

        {error ? (
          <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-negativo">
            {error === 'AccessDenied'
              ? 'Esa cuenta de Google no está autorizada para entrar.'
              : 'No se pudo completar el inicio de sesión. Inténtalo de nuevo.'}
          </p>
        ) : null}

        <form
          className="mt-5"
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/flujo' })
          }}
        >
          <button
            type="submit"
            className="w-full rounded border border-linea-fuerte bg-white px-3 py-2 text-[13px] font-medium hover:bg-panel"
          >
            Entrar con Google
          </button>
        </form>

        <p className="mt-4 text-[11px] leading-relaxed text-tenue">
          El mismo permiso da acceso de solo lectura a Gmail, que es lo que usa la ingesta
          automática para leer los recibos de tus proveedores. No se envía ni se modifica ningún
          correo.
        </p>
      </div>
    </div>
  )
}
