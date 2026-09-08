import { calcularFlujo, calcularHorizonte, type Horizonte } from '@/lib/flujo'
import { ANIO_ACTIVO } from '@/lib/dominio'
import { GrillaFlujo } from './GrillaFlujo'
import { Proyeccion } from './Proyeccion'

export const dynamic = 'force-dynamic'

/** Hasta dónde llega la proyección: el último año con cuotas comprometidas. */
const ANIO_FINAL = 2028

/**
 * Recorta los meses del final que no aportan nada.
 *
 * El horizonte se pide por años completos, así que 2028 llega hasta diciembre
 * aunque la última cuota sea de febrero. Sin recortar, la tabla arrastra diez
 * columnas planas que solo repiten el mismo saldo.
 */
function recortarCola(horizonte: Horizonte): Horizonte {
  const encadenadas = new Set([
    'saldo_inicial',
    'resultado_antes_impuestos',
    'flujo_economico',
    'flujo_financiero',
  ])
  const conMovimiento = horizonte.filas.filter((f) => !encadenadas.has(f.clave))
  let ultimo = -1
  for (let i = horizonte.columnas.length - 1; i >= 0; i -= 1) {
    if (conMovimiento.some((f) => (f.montos[i] ?? 0) !== 0)) {
      ultimo = i
      break
    }
  }
  if (ultimo < 0 || ultimo === horizonte.columnas.length - 1) return horizonte
  const hasta = ultimo + 1
  return {
    ...horizonte,
    columnas: horizonte.columnas.slice(0, hasta),
    naturalezaPorMes: horizonte.naturalezaPorMes.slice(0, hasta),
    pendientePorMes: horizonte.pendientePorMes.slice(0, hasta),
    filas: horizonte.filas.map((f) => ({
      ...f,
      montos: f.montos.slice(0, hasta),
      pendientes: f.pendientes.slice(0, hasta),
      ...(f.origenPorMes ? { origenPorMes: f.origenPorMes.slice(0, hasta) } : {}),
      ...(f.reversasPorMes ? { reversasPorMes: f.reversasPorMes.slice(0, hasta) } : {}),
      ...(f.detalle ? { detalle: f.detalle.map((l) => ({ ...l, montos: l.montos.slice(0, hasta) })) } : {}),
    })),
  }
}

export default async function PaginaFlujo({
  searchParams,
}: {
  searchParams: Promise<{ horizonte?: string }>
}) {
  const { horizonte } = await searchParams

  if (horizonte) {
    return (
      <Proyeccion
        horizonte={recortarCola(await calcularHorizonte(ANIO_ACTIVO, ANIO_FINAL))}
        anioEditable={ANIO_ACTIVO}
      />
    )
  }

  const flujo = await calcularFlujo(ANIO_ACTIVO)
  const hoy = new Date()
  const mesActual = hoy.getFullYear() === ANIO_ACTIVO ? hoy.getMonth() + 1 : null

  return <GrillaFlujo flujo={flujo} mesActual={mesActual} />
}
