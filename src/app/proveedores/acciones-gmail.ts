'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'
import { escribirRemitentes, leerRemitentes } from '@/lib/dominio'
import { descubrirRemitentes, type ResumenDescubrimiento } from '@/lib/gmail/descubrir'

export interface ResultadoBusqueda {
  ok: boolean
  error?: string
  resumen?: ResumenDescubrimiento
}

/** "Buscar remitentes en Gmail". No guarda nada en el proveedor: solo propone. */
export async function buscarRemitentes(soloProveedorId?: string): Promise<ResultadoBusqueda> {
  await requerirSesion()

  try {
    const resumen = await descubrirRemitentes(
      soloProveedorId ? { soloProveedorId } : {},
    )
    revalidatePath('/proveedores')
    return { ok: true, resumen }
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'No se pudo buscar en Gmail.',
    }
  }
}

export interface Resultado {
  ok: boolean
  error?: string
}

/** Aprueba un candidato: recién aquí el correo entra a Proveedor.remitentesEmail. */
export async function aprobarCandidato(candidatoId: string): Promise<Resultado> {
  await requerirSesion()

  const candidato = await prisma.remitenteCandidato.findUnique({
    where: { id: candidatoId },
    include: { proveedor: true },
  })
  if (!candidato) return { ok: false, error: 'El candidato ya no existe.' }

  const actuales = leerRemitentes(candidato.proveedor.remitentesEmail)
  const nuevos = escribirRemitentes([...actuales, candidato.email])

  await prisma.$transaction([
    prisma.proveedor.update({
      where: { id: candidato.proveedorId },
      data: { remitentesEmail: nuevos },
    }),
    prisma.remitenteCandidato.update({
      where: { id: candidatoId },
      data: { estado: 'aprobado' },
    }),
  ])

  revalidatePath('/proveedores')
  return { ok: true }
}

/** Descarta un candidato. Queda registrado para no volver a proponerlo. */
export async function descartarCandidato(candidatoId: string): Promise<Resultado> {
  await requerirSesion()

  const candidato = await prisma.remitenteCandidato.findUnique({ where: { id: candidatoId } })
  if (!candidato) return { ok: false, error: 'El candidato ya no existe.' }

  await prisma.remitenteCandidato.update({
    where: { id: candidatoId },
    data: { estado: 'descartado' },
  })

  revalidatePath('/proveedores')
  return { ok: true }
}

/** Aprueba de una vez todos los candidatos propuestos de un proveedor. */
export async function aprobarTodosDe(proveedorId: string): Promise<Resultado> {
  await requerirSesion()

  const proveedor = await prisma.proveedor.findUnique({
    where: { id: proveedorId },
    include: { candidatos: { where: { estado: 'propuesto' } } },
  })
  if (!proveedor) return { ok: false, error: 'El proveedor no existe.' }
  if (proveedor.candidatos.length === 0) return { ok: false, error: 'No hay candidatos por aprobar.' }

  const actuales = leerRemitentes(proveedor.remitentesEmail)
  const nuevos = escribirRemitentes([...actuales, ...proveedor.candidatos.map((c) => c.email)])

  await prisma.$transaction([
    prisma.proveedor.update({ where: { id: proveedorId }, data: { remitentesEmail: nuevos } }),
    prisma.remitenteCandidato.updateMany({
      where: { proveedorId, estado: 'propuesto' },
      data: { estado: 'aprobado' },
    }),
  ])

  revalidatePath('/proveedores')
  return { ok: true }
}

/** Quita un remitente ya guardado (y deja su candidato como descartado). */
export async function quitarRemitente(proveedorId: string, email: string): Promise<Resultado> {
  await requerirSesion()

  const proveedor = await prisma.proveedor.findUnique({ where: { id: proveedorId } })
  if (!proveedor) return { ok: false, error: 'El proveedor no existe.' }

  const restantes = leerRemitentes(proveedor.remitentesEmail).filter(
    (correo) => correo !== email.toLowerCase(),
  )

  await prisma.proveedor.update({
    where: { id: proveedorId },
    data: { remitentesEmail: escribirRemitentes(restantes) },
  })
  await prisma.remitenteCandidato.updateMany({
    where: { proveedorId, email: email.toLowerCase() },
    data: { estado: 'descartado' },
  })

  revalidatePath('/proveedores')
  return { ok: true }
}
