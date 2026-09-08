import { NextResponse } from 'next/server'
import { ejecutarIngesta } from '@/lib/ingesta'

/**
 * Ingesta programada. Vercel Cron la llama cada hora (ver vercel.json) mandando
 * Authorization: Bearer <CRON_SECRET>.
 *
 * Esta ruta queda fuera del matcher del middleware a propósito: no se autentica
 * con sesión sino con el secreto. El botón "Sincronizar ahora" de /movimientos no
 * pasa por aquí, llama a la server action, que sí exige sesión.
 */

export const dynamic = 'force-dynamic'
/*
 * 60 segundos: el tope del plan Hobby de Vercel. Estaba en 300, que es el limite
 * del plan Pro; en Hobby la funcion se corta igual, pero declarar 300 hace creer
 * que hay margen que no existe. Si la ingesta no alcanza a terminar, la salida es
 * bajar la ventana de dias, no subir este numero.
 */
export const maxDuration = 60

export async function GET(peticion: Request): Promise<NextResponse> {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    return NextResponse.json({ error: 'CRON_SECRET no está configurado.' }, { status: 500 })
  }

  const autorizacion = peticion.headers.get('authorization')
  if (autorizacion !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }

  try {
    const resultado = await ejecutarIngesta({ origen: 'cron', dias: 7 })
    return NextResponse.json({
      ok: true,
      sincronizacionId: resultado.sincronizacionId,
      correosVistos: resultado.correosVistos,
      yaProcesados: resultado.yaProcesados,
      creados: resultado.creados,
      confirmados: resultado.confirmados,
      porRevisar: resultado.porRevisar,
      sinMonto: resultado.sinMonto,
      errores: resultado.errores,
    })
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    )
  }
}
