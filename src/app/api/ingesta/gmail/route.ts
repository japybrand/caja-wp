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
export const maxDuration = 300

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
