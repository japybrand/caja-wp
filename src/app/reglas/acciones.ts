'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'
import { evaluarReglas, explicarResultado, type ReglaEvaluable } from '@/lib/reglas'

export interface Resultado {
  ok: boolean
  error?: string
}

export interface DatosRegla {
  patron: string
  /** Vacío o null = la regla vale para cualquier monto. */
  montoExacto: number | null
  categoriaId: string
  proveedorId: string | null
  nota: string
  activa: boolean
}

async function validar(datos: DatosRegla): Promise<Resultado> {
  if (datos.patron.trim().length < 3) {
    return { ok: false, error: 'El patrón necesita al menos 3 caracteres.' }
  }
  if (datos.montoExacto !== null && !Number.isFinite(datos.montoExacto)) {
    return { ok: false, error: 'El monto no es válido.' }
  }

  const categoria = await prisma.categoria.findUnique({ where: { id: datos.categoriaId } })
  if (!categoria) return { ok: false, error: 'La categoría no existe.' }

  if (datos.proveedorId) {
    const proveedor = await prisma.proveedor.findUnique({ where: { id: datos.proveedorId } })
    if (!proveedor) return { ok: false, error: 'El proveedor no existe.' }
    if (proveedor.categoriaId !== categoria.id) {
      return { ok: false, error: 'El proveedor no pertenece a esa categoría.' }
    }
  }
  return { ok: true }
}

export async function crearRegla(datos: DatosRegla): Promise<Resultado> {
  await requerirSesion()

  const v = await validar(datos)
  if (!v.ok) return v

  const patron = datos.patron.trim()
  const monto = datos.montoExacto === null ? null : Math.abs(Math.round(datos.montoExacto))

  // Prisma no acepta null en el where de un índice compuesto: findFirst, no findUnique.
  const existente = await prisma.reglaClasificacion.findFirst({
    where: { patron, montoExacto: monto },
  })
  if (existente) {
    return {
      ok: false,
      error: `Ya hay una regla con ese patrón y ${monto === null ? 'sin monto' : 'ese monto'}.`,
    }
  }

  await prisma.reglaClasificacion.create({
    data: {
      patron,
      montoExacto: monto,
      categoriaId: datos.categoriaId,
      proveedorId: datos.proveedorId,
      nota: datos.nota.trim(),
      activa: datos.activa,
    },
  })

  revalidatePath('/reglas')
  return { ok: true }
}

export async function actualizarRegla(id: string, datos: DatosRegla): Promise<Resultado> {
  await requerirSesion()

  const v = await validar(datos)
  if (!v.ok) return v

  const existente = await prisma.reglaClasificacion.findUnique({ where: { id } })
  if (!existente) return { ok: false, error: 'La regla ya no existe.' }

  await prisma.reglaClasificacion.update({
    where: { id },
    data: {
      patron: datos.patron.trim(),
      montoExacto: datos.montoExacto === null ? null : Math.abs(Math.round(datos.montoExacto)),
      categoriaId: datos.categoriaId,
      proveedorId: datos.proveedorId,
      nota: datos.nota.trim(),
      activa: datos.activa,
    },
  })

  revalidatePath('/reglas')
  return { ok: true }
}

export async function eliminarRegla(id: string): Promise<Resultado> {
  await requerirSesion()

  const existente = await prisma.reglaClasificacion.findUnique({ where: { id } })
  if (!existente) return { ok: false, error: 'La regla ya no existe.' }

  await prisma.reglaClasificacion.delete({ where: { id } })

  revalidatePath('/reglas')
  return { ok: true }
}

export async function cambiarActivaRegla(id: string, activa: boolean): Promise<Resultado> {
  await requerirSesion()

  const existente = await prisma.reglaClasificacion.findUnique({ where: { id } })
  if (!existente) return { ok: false, error: 'La regla ya no existe.' }

  await prisma.reglaClasificacion.update({ where: { id }, data: { activa } })

  revalidatePath('/reglas')
  return { ok: true }
}

export interface ResultadoPrueba {
  ok: boolean
  error?: string
  /** Qué pasó, en palabras. */
  explicacion?: string
  categoria?: string
  proveedor?: string | null
  /** true cuando el cargo quedaría sin conciliar. */
  quedaSinConciliar?: boolean
}

/**
 * Probar una glosa contra las reglas cargadas, sin escribir nada. Sirve para ver
 * la precedencia funcionando antes de que llegue una cartola.
 */
export async function probarRegla(descripcion: string, monto: number): Promise<ResultadoPrueba> {
  await requerirSesion()

  if (descripcion.trim() === '') return { ok: false, error: 'Escribe una glosa para probar.' }

  const reglas = await prisma.reglaClasificacion.findMany({
    include: { categoria: { select: { nombre: true } }, proveedor: { select: { nombre: true } } },
  })

  const evaluables: ReglaEvaluable[] = reglas.map((r) => ({
    id: r.id,
    patron: r.patron,
    montoExacto: r.montoExacto,
    categoriaId: r.categoriaId,
    proveedorId: r.proveedorId,
    nota: r.nota,
    activa: r.activa,
  }))

  const resultado = evaluarReglas(descripcion, monto, evaluables)
  const explicacion = explicarResultado(resultado)

  if (resultado.tipo !== 'calce') {
    return { ok: true, explicacion, quedaSinConciliar: true }
  }

  const original = reglas.find((r) => r.id === resultado.regla.id)
  return {
    ok: true,
    explicacion,
    categoria: original?.categoria.nombre,
    proveedor: original?.proveedor?.nombre ?? null,
    quedaSinConciliar: false,
  }
}
