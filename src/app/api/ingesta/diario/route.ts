import { NextResponse } from 'next/server'
import { ejecutarIngesta } from '@/lib/ingesta'
import { ejecutarAlertas } from '@/lib/alertas'

/**
 * La corrida diaria: ingesta de Gmail y avisos por correo.
 *
 * Vercel Cron la llama una vez al día mandando Authorization: Bearer <CRON_SECRET>.
 *
 * POR QUÉ LAS DOS COSAS EN UNA RUTA
 * El plan Hobby de Vercel permite una sola corrida de cron al día, así que no hay
 * dos horarios que repartir. Juntarlas además ordena la dependencia: la ingesta va
 * primero para que el aviso de bandeja estancada vea lo que la ingesta acaba de
 * crear, y no lo reporte recién al día siguiente.
 *
 * LOS AVISOS CORREN AUNQUE LA INGESTA FALLE
 * Son independientes: un token de Gmail vencido no puede dejar sin avisar que el
 * F29 vence en tres días. Por eso la ingesta va en su propio try y su error viaja
 * en la respuesta en vez de cortar la corrida.
 *
 * Esta ruta queda fuera del matcher del middleware a propósito: se autentica con el
 * secreto y no con sesión, porque el cron llega sin cookie.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(peticion: Request): Promise<NextResponse> {
  const secreto = process.env.CRON_SECRET
  if (!secreto) {
    return NextResponse.json({ error: 'CRON_SECRET no está configurado.' }, { status: 500 })
  }
  if (peticion.headers.get('authorization') !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
  }

  let ingesta: unknown = null
  let errorIngesta = ''
  try {
    const r = await ejecutarIngesta({ origen: 'cron', dias: 7 })
    ingesta = {
      sincronizacionId: r.sincronizacionId,
      correosVistos: r.correosVistos,
      creados: r.creados,
      confirmados: r.confirmados,
      porRevisar: r.porRevisar,
      errores: r.errores,
    }
  } catch (e: unknown) {
    errorIngesta = e instanceof Error ? e.message : String(e)
  }

  const alertas = await ejecutarAlertas()

  // 200 aunque la ingesta falle: el reintento del cron es al día siguiente igual, y
  // un 500 escondería que los avisos sí salieron.
  return NextResponse.json({ ok: errorIngesta === '', ingesta, errorIngesta, alertas })
}
