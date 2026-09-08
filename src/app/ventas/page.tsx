import { prisma } from '@/lib/prisma'
import { ANIO_ACTIVO } from '@/lib/dominio'
import { totalesPorMes, rankingClientes, notasCredito } from '@/lib/sii/totales'
import { TablaVentas } from './TablaVentas'

export const dynamic = 'force-dynamic'

export default async function PaginaVentas() {
  const [documentos, ventasManual] = await Promise.all([
    prisma.documentoVenta.findMany({
      where: { anio: ANIO_ACTIVO },
      orderBy: [{ mes: 'asc' }, { fechaDocto: 'asc' }],
    }),
    prisma.valorManual.findMany({
      where: { anio: ANIO_ACTIVO, categoria: { nombre: 'Ventas del mes' } },
    }),
  ])

  const meses = totalesPorMes(documentos)
  const ranking = rankingClientes(documentos)
  const notas = notasCredito(documentos)

  const totalAnio = meses.reduce((a, m) => a + m.total, 0)
  const planilla = new Map(ventasManual.map((v) => [v.mes, v.montoCLP]))

  return (
    <TablaVentas
      anio={ANIO_ACTIVO}
      meses={meses.map((m) => ({
        ...m,
        planilla: planilla.get(m.mes) ?? 0,
        /** Un mes sin documentos sigue tomando el valor proyectado de la planilla. */
        desdeSII: m.documentos > 0,
      }))}
      ranking={ranking.map((c) => ({
        ...c,
        // La concentración por cliente es el dato que interesa mirar.
        porcentaje: totalAnio === 0 ? 0 : (c.total / totalAnio) * 100,
      }))}
      notas={notas.map((n) => ({
        mes: n.mes,
        folio: n.folio,
        fecha: n.fechaDocto.toISOString().slice(0, 10),
        razonSocial: n.razonSocial,
        montoTotal: n.montoTotal,
        tipoReferencia: n.tipoReferencia,
        folioReferencia: n.folioReferencia,
        referenciaMes: n.referencia?.mes ?? null,
        referenciaMonto: n.referencia?.montoTotal ?? null,
        mismoMonto: n.referencia?.mismoMonto ?? false,
      }))}
      totalAnio={totalAnio}
      totalDocumentos={documentos.length}
    />
  )
}
