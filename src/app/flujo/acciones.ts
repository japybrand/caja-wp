'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'

export interface ResultadoGuardado {
  ok: boolean
  error?: string
}

/**
 * Guarda una celda de una fila manual del flujo. Se llama al salir de la celda.
 * El monto llega ya parseado a pesos enteros desde el cliente.
 */
export async function guardarValorManual(
  categoriaId: string,
  mes: number,
  anio: number,
  montoCLP: number,
): Promise<ResultadoGuardado> {
  await requerirSesion()

  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    return { ok: false, error: 'Mes inválido.' }
  }
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    return { ok: false, error: 'Año inválido.' }
  }
  if (!Number.isFinite(montoCLP)) {
    return { ok: false, error: 'Monto inválido.' }
  }

  const categoria = await prisma.categoria.findUnique({ where: { id: categoriaId } })
  if (!categoria) return { ok: false, error: 'La categoría no existe.' }
  if (!categoria.esManual) return { ok: false, error: 'Esa fila se calcula desde los movimientos.' }

  // Un mes de ventas con documentos del SII cargados no se edita a mano: el valor
  // lo manda el Registro de Ventas. La grilla ya lo bloquea; esto cierra la puerta
  // por si la acción se invoca directo.
  if (categoria.nombre === 'Ventas del mes') {
    const documentos = await prisma.documentoVenta.count({ where: { anio, mes } })
    if (documentos > 0) {
      return {
        ok: false,
        error: `Ese mes tiene ${documentos} documentos del SII cargados: la venta sale del Registro de Ventas, no se edita a mano.`,
      }
    }
  }

  const monto = Math.round(montoCLP)

  await prisma.valorManual.upsert({
    where: { categoriaId_anio_mes: { categoriaId, anio, mes } },
    create: { categoriaId, anio, mes, montoCLP: monto },
    update: { montoCLP: monto },
  })

  revalidatePath('/flujo')
  return { ok: true }
}
