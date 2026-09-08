import { prisma } from '@/lib/prisma'
import { ANIO_ACTIVO, esEstado, esFuente } from '@/lib/dominio'
import { TablaMovimientos } from './TablaMovimientos'
import type { Prisma } from '@prisma/client'
import { contiene } from '@/lib/consulta'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const primerValor = (valor: string | string[] | undefined): string =>
  Array.isArray(valor) ? (valor[0] ?? '') : (valor ?? '')

export default async function PaginaMovimientos({ searchParams }: Props) {
  const parametros = await searchParams

  const filtros = {
    mes: primerValor(parametros['mes']),
    categoriaId: primerValor(parametros['categoria']),
    proveedorId: primerValor(parametros['proveedor']),
    fuente: primerValor(parametros['fuente']),
    estado: primerValor(parametros['estado']),
    texto: primerValor(parametros['q']),
  }

  const donde: Prisma.MovimientoWhereInput = { anio: ANIO_ACTIVO }
  const mes = Number(filtros.mes)
  if (Number.isInteger(mes) && mes >= 1 && mes <= 12) donde.mes = mes
  if (filtros.categoriaId) donde.categoriaId = filtros.categoriaId
  if (filtros.proveedorId) donde.proveedorId = filtros.proveedorId
  if (esFuente(filtros.fuente)) donde.fuente = filtros.fuente
  if (esEstado(filtros.estado)) donde.estado = filtros.estado
  if (filtros.texto.trim() !== '') donde.descripcion = contiene(filtros.texto.trim())

  const [movimientos, categorias, proveedores, totalPorRevisar, ultimaSync] = await Promise.all([
    prisma.movimiento.findMany({
      where: donde,
      orderBy: [{ estado: 'desc' }, { fecha: 'desc' }, { createdAt: 'desc' }],
      include: {
        categoria: { select: { id: true, nombre: true, grupo: true } },
        proveedor: { select: { id: true, nombre: true } },
        // Para la bandeja de revisión: de qué correo salió cada movimiento.
        correo: {
          select: {
            gmailId: true,
            remitente: true,
            asunto: true,
            respuestaModelo: true,
            detalleError: true,
          },
        },
      },
      take: 1000,
    }),
    prisma.categoria.findMany({ orderBy: [{ grupo: 'asc' }, { orden: 'asc' }] }),
    prisma.proveedor.findMany({
      orderBy: [{ nombre: 'asc' }],
      select: { id: true, nombre: true, categoriaId: true },
    }),
    prisma.movimiento.count({ where: { anio: ANIO_ACTIVO, estado: 'por_revisar' } }),
    prisma.sincronizacion.findFirst({ orderBy: { iniciadaEn: 'desc' } }),
  ])

  // El orden por estado descendente deja "por_revisar" arriba, que es lo que queremos.
  const filas = movimientos.map((movimiento) => ({
    id: movimiento.id,
    fecha: movimiento.fecha.toISOString().slice(0, 10),
    mes: movimiento.mes,
    montoCLP: movimiento.montoCLP,
    monedaOriginal: movimiento.monedaOriginal,
    montoOriginal: movimiento.montoOriginal,
    descripcion: movimiento.descripcion,
    fuente: movimiento.fuente,
    estado: movimiento.estado,
    categoriaId: movimiento.categoriaId,
    categoriaNombre: movimiento.categoria.nombre,
    proveedorId: movimiento.proveedorId,
    proveedorNombre: movimiento.proveedor?.nombre ?? null,
    correo: movimiento.correo
      ? {
          gmailId: movimiento.correo.gmailId,
          remitente: movimiento.correo.remitente,
          asunto: movimiento.correo.asunto,
          respuestaModelo: movimiento.correo.respuestaModelo,
          nota: movimiento.correo.detalleError,
          url: `https://mail.google.com/mail/u/0/#all/${movimiento.correo.gmailId}`,
        }
      : null,
  }))

  return (
    <TablaMovimientos
      movimientos={filas}
      categorias={categorias.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        grupo: c.grupo,
        esManual: c.esManual,
      }))}
      proveedores={proveedores}
      filtros={filtros}
      totalPorRevisar={totalPorRevisar}
      anio={ANIO_ACTIVO}
      ultimaSync={
        ultimaSync
          ? {
              origen: ultimaSync.origen,
              iniciadaEn: ultimaSync.iniciadaEn.toISOString(),
              terminada: ultimaSync.terminadaEn !== null,
              correosVistos: ultimaSync.correosVistos,
              creados: ultimaSync.creados,
              porRevisar: ultimaSync.porRevisar,
              sinMonto: ultimaSync.sinMonto,
              errores: ultimaSync.errores,
            }
          : null
      }
    />
  )
}
