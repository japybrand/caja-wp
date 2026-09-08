import { prisma } from '@/lib/prisma'
import { ANIO_ACTIVO, leerRemitentes } from '@/lib/dominio'
import { ListaProveedores } from './ListaProveedores'

export const dynamic = 'force-dynamic'

export default async function PaginaProveedores() {
  const [proveedores, totales, hayCuentaGoogle, repetidos] = await Promise.all([
    prisma.proveedor.findMany({
      orderBy: [{ categoria: { grupo: 'asc' } }, { categoria: { orden: 'asc' } }, { orden: 'asc' }],
      include: {
        categoria: { select: { nombre: true, grupo: true } },
        candidatos: {
          where: { estado: 'propuesto' },
          orderBy: [{ cantidad: 'desc' }, { ultimoCorreo: 'desc' }],
        },
      },
    }),
    prisma.movimiento.groupBy({
      by: ['proveedorId'],
      where: { anio: ANIO_ACTIVO },
      _sum: { montoCLP: true },
      _count: { _all: true },
    }),
    prisma.cuentaGoogle.count(),
    // Un remitente que aparece bajo muchos proveedores casi nunca es especifico de
    // ninguno: es un hilo suelto que menciona varios nombres. Se muestra la senal
    // para que la persona pueda descartarlo de un vistazo.
    prisma.remitenteCandidato.groupBy({ by: ['email'], _count: { _all: true } }),
  ])

  const proveedoresPorEmail = new Map(
    repetidos.map((fila) => [fila.email, fila._count._all]),
  )

  const porProveedor = new Map(
    totales
      .filter((t): t is typeof t & { proveedorId: string } => t.proveedorId !== null)
      .map((t) => [t.proveedorId, { total: t._sum.montoCLP ?? 0, cantidad: t._count._all }]),
  )

  const filas = proveedores.map((proveedor) => ({
    id: proveedor.id,
    nombre: proveedor.nombre,
    categoriaNombre: proveedor.categoria.nombre,
    grupo: proveedor.categoria.grupo,
    monedaDefecto: proveedor.monedaDefecto,
    activo: proveedor.activo,
    remitentes: leerRemitentes(proveedor.remitentesEmail),
    totalAnio: porProveedor.get(proveedor.id)?.total ?? 0,
    movimientos: porProveedor.get(proveedor.id)?.cantidad ?? 0,
    candidatos: proveedor.candidatos.map((candidato) => ({
      id: candidato.id,
      email: candidato.email,
      nombreDe: candidato.nombreDe,
      cantidad: candidato.cantidad,
      asuntoEjemplo: candidato.asuntoEjemplo,
      ultimoCorreo: candidato.ultimoCorreo.toISOString().slice(0, 10),
      enCuantosProveedores: proveedoresPorEmail.get(candidato.email) ?? 1,
    })),
  }))

  return (
    <ListaProveedores
      proveedores={filas}
      anio={ANIO_ACTIVO}
      hayCuentaGoogle={hayCuentaGoogle > 0}
    />
  )
}
