'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'
import { escribirRemitentes, esMoneda } from '@/lib/dominio'

export interface Resultado {
  ok: boolean
  error?: string
  /** Lista ya normalizada, para que la pantalla muestre lo que quedó guardado. */
  remitentes?: string[]
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Guarda los remitentes de un proveedor. Acepta el texto crudo del campo, separado por
 * comas, punto y coma o saltos de línea. La fase 2 usará esta lista para clasificar correos.
 */
export async function guardarRemitentes(proveedorId: string, texto: string): Promise<Resultado> {
  await requerirSesion()

  const proveedor = await prisma.proveedor.findUnique({ where: { id: proveedorId } })
  if (!proveedor) return { ok: false, error: 'El proveedor no existe.' }

  const candidatos = texto
    .split(/[,;\n]/)
    .map((valor) => valor.trim().toLowerCase())
    .filter((valor) => valor !== '')

  const invalidos = candidatos.filter((valor) => !CORREO.test(valor))
  if (invalidos.length > 0) {
    return { ok: false, error: `No parecen correos: ${invalidos.join(', ')}` }
  }

  const json = escribirRemitentes(candidatos)
  await prisma.proveedor.update({ where: { id: proveedorId }, data: { remitentesEmail: json } })

  revalidatePath('/proveedores')
  return { ok: true, remitentes: JSON.parse(json) as string[] }
}

export async function guardarMoneda(proveedorId: string, moneda: string): Promise<Resultado> {
  await requerirSesion()

  if (!esMoneda(moneda)) return { ok: false, error: 'Moneda desconocida.' }

  const proveedor = await prisma.proveedor.findUnique({ where: { id: proveedorId } })
  if (!proveedor) return { ok: false, error: 'El proveedor no existe.' }

  await prisma.proveedor.update({ where: { id: proveedorId }, data: { monedaDefecto: moneda } })

  revalidatePath('/proveedores')
  return { ok: true }
}

export async function cambiarActivo(proveedorId: string, activo: boolean): Promise<Resultado> {
  await requerirSesion()

  const proveedor = await prisma.proveedor.findUnique({ where: { id: proveedorId } })
  if (!proveedor) return { ok: false, error: 'El proveedor no existe.' }

  await prisma.proveedor.update({ where: { id: proveedorId }, data: { activo } })

  revalidatePath('/proveedores')
  return { ok: true }
}
