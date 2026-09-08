'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'
import { leerRemitentes, escribirRemitentes } from '@/lib/dominio'
import {
  previsualizar,
  asignarAFilaManual,
  type VistaPreviaManual,
} from '@/lib/banco/asignar'

export interface Resultado {
  ok: boolean
  error?: string
  /** Qué pasó, para mostrarlo en la interfaz. */
  detalle?: string
}

/** Los cargos de un grupo, o uno solo si se pasa un id. */
async function cargosDelGrupo(glosa: string, soloId?: string) {
  if (soloId) {
    const uno = await prisma.movimientoBancario.findUnique({ where: { id: soloId } })
    return uno ? [uno] : []
  }
  return prisma.movimientoBancario.findMany({
    where: { descripcion: glosa, estadoConciliacion: 'sin_conciliar' },
  })
}

function revalidar(): void {
  revalidatePath('/banco')
  revalidatePath('/flujo')
  revalidatePath('/movimientos')
}

/**
 * Asignar proveedor: guarda la glosa como alias y reintenta el emparejamiento.
 *
 * NO crea movimientos. Si hay un Movimiento del mismo mes y monto parecido, enlaza;
 * si no, el cargo queda identificado pero sin conciliar, y crear es otra decisión.
 */
export async function asignarProveedor(
  glosa: string,
  proveedorId: string,
  soloId?: string,
): Promise<Resultado> {
  await requerirSesion()

  const proveedor = await prisma.proveedor.findUnique({ where: { id: proveedorId } })
  if (!proveedor) return { ok: false, error: 'El proveedor no existe.' }

  const cargos = await cargosDelGrupo(glosa, soloId)
  if (cargos.length === 0) return { ok: false, error: 'No quedan cargos de esa glosa por resolver.' }

  // El alias es la glosa completa: el emparejamiento compara por subcadena, así que
  // sirve igual para las variantes con código de transacción.
  await prisma.proveedor.update({
    where: { id: proveedorId },
    data: { aliasBancarios: escribirRemitentes([...leerRemitentes(proveedor.aliasBancarios), glosa]) },
  })

  const candidatos = await prisma.movimiento.findMany({
    where: { proveedorId, anio: { in: [...new Set(cargos.map((c) => c.anio))] } },
    select: { id: true, mes: true, montoCLP: true },
  })
  const usados = new Set(
    (
      await prisma.movimientoBancario.findMany({
        where: { movimientoId: { not: null } },
        select: { movimientoId: true },
      })
    )
      .map((x) => x.movimientoId)
      .filter((x): x is string => x !== null),
  )

  let enlazados = 0
  for (const c of cargos) {
    const objetivo = Math.abs(c.monto)
    const calce = candidatos.find((m) => {
      if (usados.has(m.id) || m.mes !== c.mes) return false
      const mayor = Math.max(m.montoCLP, objetivo)
      return mayor > 0 && Math.abs(m.montoCLP - objetivo) / mayor <= 0.01
    })
    if (calce) usados.add(calce.id)
    await prisma.movimientoBancario.update({
      where: { id: c.id },
      data: {
        proveedorSugerido: proveedor.nombre,
        viaConciliacion: 'alias',
        estadoConciliacion: calce ? 'conciliado' : 'sin_conciliar',
        movimientoId: calce?.id ?? null,
        notaConciliacion: calce
          ? `alias "${glosa}" de ${proveedor.nombre}`
          : `alias "${glosa}" de ${proveedor.nombre}, sin movimiento del flujo al que enlazar`,
      },
    })
    if (calce) enlazados += 1
  }

  revalidar()
  return {
    ok: true,
    detalle:
      `Alias guardado. ${cargos.length} cargos asignados a ${proveedor.nombre}, ` +
      `${enlazados} enlazados a un movimiento del flujo.`,
  }
}

export type { VistaPreviaManual } from '@/lib/banco/asignar'

/** Qué pasaría al asignar una glosa a una fila manual, sin escribir nada. */
export async function previsualizarCategoriaManual(
  glosa: string,
  categoriaId: string,
  soloId?: string,
): Promise<VistaPreviaManual> {
  await requerirSesion()
  return previsualizar(glosa, categoriaId, soloId)
}

/** Asigna una glosa a una fila manual del flujo. La lógica vive en lib/banco/asignar. */
export async function asignarCategoriaManual(
  glosa: string,
  categoriaId: string,
  modo: 'reemplazar' | 'sumar' = 'reemplazar',
  soloId?: string,
): Promise<Resultado> {
  await requerirSesion()
  const r = await asignarAFilaManual(glosa, categoriaId, modo, soloId)
  if (r.ok) revalidar()
  return r
}

/** Crea un Movimiento del flujo desde uno o varios cargos bancarios. */
export async function crearMovimientoDesdeCargo(
  glosa: string,
  categoriaId: string,
  proveedorId: string | null,
  descripcion: string,
  soloId?: string,
): Promise<Resultado> {
  await requerirSesion()

  const categoria = await prisma.categoria.findUnique({ where: { id: categoriaId } })
  if (!categoria) return { ok: false, error: 'La categoría no existe.' }
  if (categoria.esManual) {
    return {
      ok: false,
      error: `"${categoria.nombre}" es una fila manual del flujo: usa "asignar a categoría manual", no crear movimiento.`,
    }
  }
  if (proveedorId) {
    const p = await prisma.proveedor.findUnique({ where: { id: proveedorId } })
    if (!p) return { ok: false, error: 'El proveedor no existe.' }
    if (p.categoriaId !== categoria.id) {
      return { ok: false, error: 'El proveedor no pertenece a esa categoría.' }
    }
  }

  const cargos = await cargosDelGrupo(glosa, soloId)
  if (cargos.length === 0) return { ok: false, error: 'No quedan cargos de esa glosa por resolver.' }

  let creados = 0
  for (const c of cargos) {
    const idExterno = `cartola:${c.hash}`
    const movimiento = await prisma.movimiento.upsert({
      where: { idExterno },
      create: {
        fecha: c.fecha,
        mes: c.mes,
        anio: c.anio,
        montoCLP: Math.abs(c.monto),
        monedaOriginal: 'CLP',
        proveedorId,
        categoriaId,
        descripcion: descripcion.trim() || c.descripcion,
        fuente: 'cartola',
        idExterno,
        estado: 'confirmado',
      },
      update: { montoCLP: Math.abs(c.monto) },
    })
    await prisma.movimientoBancario.update({
      where: { id: c.id },
      data: {
        estadoConciliacion: 'conciliado',
        movimientoId: movimiento.id,
        viaConciliacion: 'manual',
        notaConciliacion: 'movimiento creado desde la cartola',
      },
    })
    creados += 1
  }

  revalidar()
  return { ok: true, detalle: `${creados} movimientos creados en "${categoria.nombre}".` }
}

/** Marca como ignorado lo que no debe entrar al flujo. Se registra, no se borra. */
export async function ignorarCargo(
  glosa: string,
  motivo: string,
  soloId?: string,
): Promise<Resultado> {
  await requerirSesion()

  const cargos = await cargosDelGrupo(glosa, soloId)
  if (cargos.length === 0) return { ok: false, error: 'No quedan cargos de esa glosa por resolver.' }

  await prisma.movimientoBancario.updateMany({
    where: { id: { in: cargos.map((c) => c.id) } },
    data: {
      estadoConciliacion: 'ignorado',
      movimientoId: null,
      notaConciliacion: motivo.trim() || 'no entra al flujo',
    },
  })

  revalidar()
  return { ok: true, detalle: `${cargos.length} cargos marcados como ignorados.` }
}

/** Deshace cualquier resolución y devuelve el cargo a la bandeja. */
export async function devolverABandeja(id: string): Promise<Resultado> {
  await requerirSesion()

  const cargo = await prisma.movimientoBancario.findUnique({ where: { id } })
  if (!cargo) return { ok: false, error: 'El cargo ya no existe.' }

  await prisma.movimientoBancario.update({
    where: { id },
    data: {
      estadoConciliacion: 'sin_conciliar',
      movimientoId: null,
      categoriaManualId: null,
      esReversa: false,
      viaConciliacion: '',
      notaConciliacion: '',
    },
  })

  revalidar()
  return { ok: true, detalle: 'Devuelto a la bandeja.' }
}
