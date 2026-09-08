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
    <div className="flex min-h-screen items-center justify-center px-e5">
      <div className="tarjeta w-full max-w-[380px] px-e5 py-e5">
        <h1 className="t-pagina">Caja WP</h1>
        <p className="t-apoyo mt-e2">
          Flujo de caja de Japybrand WP. El acceso está restringido a las cuentas autorizadas.
        </p>

        {error ? (
          <p className="mt-e4 rounded-[8px] border border-negativo/25 bg-negativo/[0.04] px-e3 py-e2 text-[12.5px] text-negativo">
            {error === 'AccessDenied'
              ? 'Esa cuenta de Google no está autorizada para entrar.'
              : 'No se pudo completar el inicio de sesión. Inténtalo de nuevo.'}
          </p>
        ) : null}

        <form
          className="mt-e5"
          action={async () => {
            'use server'
            await signIn('google', { redirectTo: '/' })
          }}
        >
          <button
            type="submit"
            className="w-full rounded-[8px] bg-acento-superficie px-e3 py-e2 text-[13px] font-medium text-claro transition-opacity hover:opacity-90"
          >
            Entrar con Google
          </button>
        </form>

        <p className="t-apoyo mt-e4">
          El mismo permiso da acceso de solo lectura a Gmail, que es lo que usa la ingesta
          automática para leer los recibos de tus proveedores. No se envía ni se modifica ningún
          correo.
        </p>
      </div>
    </div>
  )
}
