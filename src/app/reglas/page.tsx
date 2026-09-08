import { prisma } from '@/lib/prisma'
import { TablaReglas } from './TablaReglas'

export const dynamic = 'force-dynamic'

export default async function PaginaReglas() {
  const [reglas, categorias, proveedores] = await Promise.all([
    prisma.reglaClasificacion.findMany({
      orderBy: [{ patron: 'asc' }, { montoExacto: 'asc' }],
      include: {
        categoria: { select: { nombre: true } },
        proveedor: { select: { nombre: true } },
      },
    }),
    prisma.categoria.findMany({ orderBy: [{ grupo: 'asc' }, { orden: 'asc' }] }),
    prisma.proveedor.findMany({
      orderBy: { nombre: 'asc' },
      select: { id: true, nombre: true, categoriaId: true },
    }),
  ])

  return (
    <TablaReglas
      reglas={reglas.map((r) => ({
        id: r.id,
        patron: r.patron,
        montoExacto: r.montoExacto,
        categoriaId: r.categoriaId,
        categoriaNombre: r.categoria.nombre,
        proveedorId: r.proveedorId,
        proveedorNombre: r.proveedor?.nombre ?? null,
        nota: r.nota,
        activa: r.activa,
      }))}
      categorias={categorias.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        grupo: c.grupo,
        esManual: c.esManual,
      }))}
      proveedores={proveedores}
    />
  )
}
