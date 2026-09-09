'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'
import { esEstado, esMoneda } from '@/lib/dominio'
import { compromisoQueDuplica } from '@/lib/duplicados'

export interface Resultado {
  ok: boolean
  error?: string
}

export interface DatosMovimiento {
  fecha: string // "2026-03-01"
  categoriaId: string
  proveedorId: string | null
  descripcion: string
  montoCLP: number
  monedaOriginal: string
  montoOriginal: number | null
  estado: string
}

/**
 * Valida y normaliza el formulario. Los movimientos solo pueden colgar de categorías
 * calculadas: las filas manuales del flujo viven en ValorManual, y aceptar un movimiento
 * ahí haría que el monto se contara dos veces.
 */
async function validar(datos: DatosMovimiento): Promise<
  { ok: true; valores: { fecha: Date; mes: number; anio: number; proveedorId: string | null } } | { ok: false; error: string }
> {
  const fecha = new Date(`${datos.fecha}T00:00:00.000Z`)
  if (Number.isNaN(fecha.getTime())) return { ok: false, error: 'La fecha no es válida.' }

  if (!Number.isFinite(datos.montoCLP)) return { ok: false, error: 'El monto no es válido.' }
  if (!esEstado(datos.estado)) return { ok: false, error: 'Estado desconocido.' }
  if (!esMoneda(datos.monedaOriginal)) return { ok: false, error: 'Moneda desconocida.' }

  const categoria = await prisma.categoria.findUnique({ where: { id: datos.categoriaId } })
  if (!categoria) return { ok: false, error: 'La categoría no existe.' }
  if (categoria.esManual) {
    return {
      ok: false,
      error: `"${categoria.nombre}" es una fila manual del flujo: edítala directamente en la grilla, no con un movimiento.`,
    }
  }

  let proveedorId: string | null = null
  if (datos.proveedorId) {
    const proveedor = await prisma.proveedor.findUnique({ where: { id: datos.proveedorId } })
    if (!proveedor) return { ok: false, error: 'El proveedor no existe.' }
    if (proveedor.categoriaId !== categoria.id) {
      return { ok: false, error: 'El proveedor no pertenece a esa categoría.' }
    }
    proveedorId = proveedor.id
  }

  return {
    ok: true,
    valores: {
      fecha,
      mes: fecha.getUTCMonth() + 1,
      anio: fecha.getUTCFullYear(),
      proveedorId,
    },
  }
}

export async function crearMovimiento(datos: DatosMovimiento): Promise<Resultado> {
  await requerirSesion()

  const validacion = await validar(datos)
  if (!validacion.ok) return { ok: false, error: validacion.error }

  await prisma.movimiento.create({
    data: {
      fecha: validacion.valores.fecha,
      mes: validacion.valores.mes,
      anio: validacion.valores.anio,
      montoCLP: Math.round(datos.montoCLP),
      monedaOriginal: datos.monedaOriginal,
      montoOriginal: datos.montoOriginal,
      proveedorId: validacion.valores.proveedorId,
      categoriaId: datos.categoriaId,
      descripcion: datos.descripcion.trim(),
      fuente: 'manual',
      estado: datos.estado,
    },
  })

  revalidatePath('/movimientos')
  revalidatePath('/flujo')
  return { ok: true }
}

export async function actualizarMovimiento(id: string, datos: DatosMovimiento): Promise<Resultado> {
  await requerirSesion()

  const validacion = await validar(datos)
  if (!validacion.ok) return { ok: false, error: validacion.error }

  const existente = await prisma.movimiento.findUnique({ where: { id } })
  if (!existente) return { ok: false, error: 'El movimiento ya no existe.' }

  await prisma.movimiento.update({
    where: { id },
    data: {
      fecha: validacion.valores.fecha,
      mes: validacion.valores.mes,
      anio: validacion.valores.anio,
      montoCLP: Math.round(datos.montoCLP),
      monedaOriginal: datos.monedaOriginal,
      montoOriginal: datos.montoOriginal,
      proveedorId: validacion.valores.proveedorId,
      categoriaId: datos.categoriaId,
      descripcion: datos.descripcion.trim(),
      estado: datos.estado,
    },
  })

  revalidatePath('/movimientos')
  revalidatePath('/flujo')
  return { ok: true }
}

export async function eliminarMovimiento(id: string): Promise<Resultado> {
  await requerirSesion()

  const existente = await prisma.movimiento.findUnique({ where: { id } })
  if (!existente) return { ok: false, error: 'El movimiento ya no existe.' }

  await prisma.movimiento.delete({ where: { id } })

  revalidatePath('/movimientos')
  revalidatePath('/flujo')
  return { ok: true }
}

/**
 * Marca un movimiento por revisar como confirmado, sin abrir el formulario.
 *
 * Se niega a confirmar algo que repita un compromiso ya declarado. Es el único
 * bloqueo duro de la pantalla, y está porque el error que evita no se ve: los dos
 * registros quedan en meses distintos, cada uno parece legítimo por separado, y el
 * flujo sigue cuadrando con la deuda contada dos veces.
 *
 * La salida, si el bloqueo se equivoca, es el formulario de edición: cambiar el
 * monto o el proveedor ahí es un acto deliberado, no un clic de más.
 */
export async function confirmarMovimiento(id: string): Promise<Resultado> {
  await requerirSesion()

  const existente = await prisma.movimiento.findUnique({ where: { id } })
  if (!existente) return { ok: false, error: 'El movimiento ya no existe.' }

  const compromiso = await compromisoQueDuplica(existente)
  if (compromiso) return { ok: false, error: compromiso.motivo }

  await prisma.movimiento.update({ where: { id }, data: { estado: 'confirmado' } })

  revalidatePath('/movimientos')
  revalidatePath('/flujo')
  return { ok: true }
}
