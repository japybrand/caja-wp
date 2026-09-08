'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'
import { ejecutarIngesta, type ResultadoIngesta } from '@/lib/ingesta'

export interface ResultadoSync {
  ok: boolean
  error?: string
  resumen?: ResultadoIngesta
}

/** Botón "Sincronizar ahora". Mira los últimos `dias` días. */
export async function sincronizarAhora(
  opciones: { dias?: number; forzarRevision?: boolean } = {},
): Promise<ResultadoSync> {
  await requerirSesion()

  try {
    const resumen = await ejecutarIngesta({
      origen: 'manual',
      dias: opciones.dias ?? 7,
      forzarRevision: opciones.forzarRevision ?? false,
    })
    revalidatePath('/movimientos')
    revalidatePath('/flujo')
    return { ok: true, resumen }
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo sincronizar.',
    }
  }
}

export interface Resultado {
  ok: boolean
  error?: string
}

/**
 * Descartar: borra el movimiento y deja el correo marcado como ignorado, para que
 * la siguiente corrida no lo vuelva a traer.
 */
export async function descartarCorreo(movimientoId: string): Promise<Resultado> {
  await requerirSesion()

  const correo = await prisma.correoProcesado.findUnique({ where: { movimientoId } })
  const movimiento = await prisma.movimiento.findUnique({ where: { id: movimientoId } })
  if (!movimiento) return { ok: false, error: 'El movimiento ya no existe.' }

  await prisma.$transaction([
    ...(correo
      ? [
          prisma.correoProcesado.update({
            where: { id: correo.id },
            data: { estado: 'ignorado', movimientoId: null },
          }),
        ]
      : []),
    prisma.movimiento.delete({ where: { id: movimientoId } }),
  ])

  revalidatePath('/movimientos')
  revalidatePath('/flujo')
  return { ok: true }
}
