'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'

/**
 * Guarda el desglose del F29 que manda el contador.
 *
 * El IVA no se recibe ni se guarda: se calcula desde los registros del SII. Tenerlo
 * en dos lugares crearia dos versiones del mismo numero que podrian discrepar.
 */
export interface ResultadoF29 {
  ok: boolean
  error?: string
}

export async function guardarF29(
  anioPeriodo: number,
  mesPeriodo: number,
  campos: {
    ppm?: number
    retencionesHonorarios?: number
    otros?: number
    /** null borra el total y deja mandar a la suma de las partes. */
    totalDeclarado?: number | null
  },
): Promise<ResultadoF29> {
  await requerirSesion()

  if (mesPeriodo < 1 || mesPeriodo > 12) return { ok: false, error: 'Mes fuera de rango.' }
  for (const [nombre, valor] of Object.entries(campos)) {
    if (valor != null && (!Number.isFinite(valor) || valor < 0)) {
      return { ok: false, error: `El valor de ${nombre} no es válido.` }
    }
  }

  const previo = await prisma.declaracionF29.findUnique({
    where: { anioPeriodo_mesPeriodo: { anioPeriodo, mesPeriodo } },
  })

  const datos = {
    ppm: campos.ppm ?? previo?.ppm ?? 0,
    retencionesHonorarios: campos.retencionesHonorarios ?? previo?.retencionesHonorarios ?? 0,
    otros: campos.otros ?? previo?.otros ?? 0,
    totalDeclarado:
      campos.totalDeclarado === undefined ? (previo?.totalDeclarado ?? null) : campos.totalDeclarado,
  }

  await prisma.declaracionF29.upsert({
    where: { anioPeriodo_mesPeriodo: { anioPeriodo, mesPeriodo } },
    create: { anioPeriodo, mesPeriodo, ...datos, estado: 'declarado' },
    update: { ...datos, estado: previo?.estado === 'pagado' ? 'pagado' : 'declarado' },
  })

  revalidatePath('/obligaciones')
  revalidatePath('/')
  revalidatePath('/flujo')
  return { ok: true }
}
