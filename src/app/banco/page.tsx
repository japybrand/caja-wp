import { prisma } from '@/lib/prisma'
import { ANIO_ACTIVO, leerRemitentes } from '@/lib/dominio'
import { buscarProveedor } from '@/lib/banco/glosa'
import { PanelBanco } from './PanelBanco'
import type { Prisma } from '@prisma/client'
import { contiene } from '@/lib/consulta'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const primerValor = (v: string | string[] | undefined): string =>
  Array.isArray(v) ? (v[0] ?? '') : (v ?? '')

export default async function PaginaBanco({ searchParams }: Props) {
  const p = await searchParams
  const filtros = {
    mes: primerValor(p['mes']),
    tipo: primerValor(p['tipo']),
    estado: primerValor(p['estado']),
    texto: primerValor(p['q']),
  }

  const donde: Prisma.MovimientoBancarioWhereInput = { anio: ANIO_ACTIVO }
  const mes = Number(filtros.mes)
  if (Number.isInteger(mes) && mes >= 1 && mes <= 12) donde.mes = mes
  if (filtros.tipo === 'C' || filtros.tipo === 'A') donde.tipo = filtros.tipo
  if (['sin_conciliar', 'conciliado', 'ignorado'].includes(filtros.estado)) {
    donde.estadoConciliacion = filtros.estado
  }
  if (filtros.texto.trim() !== '') donde.descripcion = contiene(filtros.texto.trim())

  const [sinConciliar, lista, categorias, proveedores, conteos] = await Promise.all([
    prisma.movimientoBancario.findMany({
      where: { anio: ANIO_ACTIVO, estadoConciliacion: 'sin_conciliar' },
      orderBy: { fecha: 'asc' },
    }),
    prisma.movimientoBancario.findMany({
      where: donde,
      orderBy: [{ fecha: 'desc' }],
      include: { movimiento: { select: { descripcion: true, montoCLP: true } } },
      take: 400,
    }),
    prisma.categoria.findMany({ orderBy: [{ grupo: 'asc' }, { orden: 'asc' }] }),
    prisma.proveedor.findMany({
      orderBy: { nombre: 'asc' },
      include: { categoria: { select: { nombre: true } } },
    }),
    prisma.movimientoBancario.groupBy({
      by: ['estadoConciliacion'],
      where: { anio: ANIO_ACTIVO },
      _count: { _all: true },
      _sum: { monto: true },
    }),
  ])

  const conAlias = proveedores.map((x) => ({ ...x, alias: leerRemitentes(x.aliasBancarios) }))

  // La bandeja se agrupa por glosa: resolver "Compra VERPEX.COM* VPX-4" una vez
  // tiene que resolver los 40 cargos, no uno.
  const grupos = new Map<
    string,
    {
      glosa: string
      cargos: number
      total: number
      meses: number[]
      esAbono: boolean
      sugerido: string | null
      sugeridoId: string | null
      categoriaSugerida: string | null
      ids: string[]
    }
  >()
  for (const b of sinConciliar) {
    let g = grupos.get(b.descripcion)
    if (!g) {
      const calce = buscarProveedor(b.descripcion, conAlias)
      g = {
        glosa: b.descripcion,
        cargos: 0,
        total: 0,
        meses: [],
        esAbono: b.monto > 0,
        sugerido: calce?.proveedor.nombre ?? b.proveedorSugerido ?? null,
        sugeridoId: calce?.proveedor.id ?? null,
        categoriaSugerida: calce?.proveedor.categoria.nombre ?? null,
        ids: [],
      }
      grupos.set(b.descripcion, g)
    }
    g.cargos += 1
    g.total += b.monto
    if (!g.meses.includes(b.mes)) g.meses.push(b.mes)
    g.ids.push(b.id)
  }

  return (
    <PanelBanco
      anio={ANIO_ACTIVO}
      grupos={[...grupos.values()].sort((a, b) => a.total - b.total)}
      lista={lista.map((b) => ({
        id: b.id,
        fecha: b.fecha.toISOString().slice(0, 10),
        mes: b.mes,
        monto: b.monto,
        descripcion: b.descripcion,
        tipo: b.tipo,
        estado: b.estadoConciliacion,
        via: b.viaConciliacion,
        nota: b.notaConciliacion,
        proveedorSugerido: b.proveedorSugerido,
        movimiento: b.movimiento
          ? { descripcion: b.movimiento.descripcion, monto: b.movimiento.montoCLP }
          : null,
      }))}
      categorias={categorias.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        grupo: c.grupo,
        esManual: c.esManual,
      }))}
      proveedores={proveedores.map((x) => ({
        id: x.id,
        nombre: x.nombre,
        categoriaId: x.categoriaId,
        categoriaNombre: x.categoria.nombre,
      }))}
      filtros={filtros}
      conteos={conteos.map((c) => ({
        estado: c.estadoConciliacion,
        cantidad: c._count._all,
        monto: c._sum.monto ?? 0,
      }))}
    />
  )
}
