import { prisma } from '@/lib/prisma'

/**
 * Asignación de movimientos bancarios a filas manuales del flujo.
 *
 * Vive aquí y no en la server action para que se pueda ejercitar desde un script
 * sin arrastrar el runtime de Next: la acción solo agrega el guardia de sesión y
 * la revalidación de las páginas.
 */

/**
 * Cuánto aporta un movimiento del banco a una fila manual, según qué tipo de fila sea.
 *
 * Siempre el signo neto, nunca el valor absoluto:
 *
 *  - Financiamiento e ingresos: la plata que ENTRA suma y la que sale resta. Un
 *    anticipo de factoring es financiamiento recibido y su devolución lo reduce.
 *  - Impuestos, deudas y retiros: son egresos, así que el CARGO suma y el ABONO
 *    resta, porque un abono en una fila de egreso es una reversa.
 *
 * El caso que obligó a esto: seis cheques a Inmotion por 1.166.378, dos de ellos
 * protestados por firma disconforme y reemplazados por transferencia. Con valor
 * absoluto los dos protestos habrían sumado en vez de restar, y la deuda del año
 * quedaba inflada en 2.332.756.
 */
export function aporteALaFila(grupo: string, monto: number): number {
  if (grupo === 'financiamiento' || grupo === 'ingresos') return monto
  return -monto
}

/**
 * Un abono asignado a una fila de egreso es una reversa. No se esconde: se marca
 * en la descripción y la celda del flujo la muestra, porque un monto que baja sin
 * explicación visible es peor que uno alto.
 */
export function esReversa(grupo: string, monto: number): boolean {
  const esEgreso = grupo !== 'financiamiento' && grupo !== 'ingresos'
  return esEgreso && monto > 0
}

export interface FilaVistaPrevia {
  mes: number
  actual: number
  aporte: number
  reemplazar: number
  sumar: number
}

export interface VistaPreviaManual {
  ok: boolean
  error?: string
  categoria?: string
  grupo?: string
  filas?: FilaVistaPrevia[]
  /** true si algún mes ya trae un valor: ahí sumar duplica. */
  hayValoresPrevios?: boolean
  /** Cuántos de los movimientos son abonos a una fila de egreso. */
  reversas?: number
}

async function cargosDelGrupo(glosa: string, soloId?: string) {
  if (soloId) {
    const uno = await prisma.movimientoBancario.findUnique({ where: { id: soloId } })
    return uno ? [uno] : []
  }
  return prisma.movimientoBancario.findMany({
    where: { descripcion: glosa, estadoConciliacion: 'sin_conciliar' },
  })
}

/** Qué pasaría al asignar una glosa a una fila manual, sin escribir nada. */
export async function previsualizar(
  glosa: string,
  categoriaId: string,
  soloId?: string,
): Promise<VistaPreviaManual> {
  const categoria = await prisma.categoria.findUnique({ where: { id: categoriaId } })
  if (!categoria) return { ok: false, error: 'La categoría no existe.' }
  if (!categoria.esManual) {
    return {
      ok: false,
      error: `"${categoria.nombre}" no es una fila manual. Para esas, asigna un proveedor o crea un movimiento.`,
    }
  }

  const cargos = await cargosDelGrupo(glosa, soloId)
  if (cargos.length === 0) return { ok: false, error: 'No quedan cargos de esa glosa por resolver.' }

  const porMes = new Map<number, { anio: number; aporte: number }>()
  for (const c of cargos) {
    const e = porMes.get(c.mes) ?? { anio: c.anio, aporte: 0 }
    e.aporte += aporteALaFila(categoria.grupo, c.monto)
    porMes.set(c.mes, e)
  }

  const filas: FilaVistaPrevia[] = []
  for (const [mes, e] of [...porMes.entries()].sort((a, b) => a[0] - b[0])) {
    const actual = await prisma.valorManual.findUnique({
      where: { categoriaId_anio_mes: { categoriaId, anio: e.anio, mes } },
    })
    const hoy = actual?.montoCLP ?? 0
    filas.push({ mes, actual: hoy, aporte: e.aporte, reemplazar: e.aporte, sumar: hoy + e.aporte })
  }

  return {
    ok: true,
    categoria: categoria.nombre,
    grupo: categoria.grupo,
    filas,
    hayValoresPrevios: filas.some((f) => f.actual !== 0),
    reversas: cargos.filter((c) => esReversa(categoria.grupo, c.monto)).length,
  }
}

export interface ResultadoAsignacion {
  ok: boolean
  error?: string
  detalle?: string
}

/**
 * Asigna una glosa a una fila manual del flujo.
 *
 * Suma al ValorManual del mes en vez de crear un Movimiento: esas filas se
 * alimentan de ValorManual, y crearles movimientos las contaría dos veces.
 *
 * `modo` decide qué hacer con lo que ya hay:
 *  - "reemplazar": el banco manda. Correcto cuando la fila traía la proyección del
 *    Excel y ahora hay cartola de ese mes.
 *  - "sumar": cuando el movimiento es adicional a lo ya registrado.
 */
export async function asignarAFilaManual(
  glosa: string,
  categoriaId: string,
  modo: 'reemplazar' | 'sumar' = 'reemplazar',
  soloId?: string,
): Promise<ResultadoAsignacion> {
  const categoria = await prisma.categoria.findUnique({ where: { id: categoriaId } })
  if (!categoria) return { ok: false, error: 'La categoría no existe.' }
  if (!categoria.esManual) {
    return {
      ok: false,
      error: `"${categoria.nombre}" no es una fila manual. Para esas, asigna un proveedor o crea un movimiento.`,
    }
  }

  const cargos = await cargosDelGrupo(glosa, soloId)
  if (cargos.length === 0) return { ok: false, error: 'No quedan cargos de esa glosa por resolver.' }

  const porMes = new Map<string, number>()
  for (const c of cargos) {
    const clave = `${c.anio}|${c.mes}`
    porMes.set(clave, (porMes.get(clave) ?? 0) + aporteALaFila(categoria.grupo, c.monto))
  }

  for (const [clave, aporte] of porMes) {
    const [anio, mes] = clave.split('|').map(Number) as [number, number]
    const actual = await prisma.valorManual.findUnique({
      where: { categoriaId_anio_mes: { categoriaId, anio, mes } },
    })
    const nuevo = modo === 'reemplazar' ? aporte : (actual?.montoCLP ?? 0) + aporte
    await prisma.valorManual.upsert({
      where: { categoriaId_anio_mes: { categoriaId, anio, mes } },
      create: { categoriaId, anio, mes, montoCLP: nuevo, origen: 'banco' },
      // Queda marcado como venido del banco para que reimportar el Excel no lo pise.
      update: { montoCLP: nuevo, origen: 'banco' },
    })
  }

  let reversas = 0
  for (const c of cargos) {
    const reversa = esReversa(categoria.grupo, c.monto)
    if (reversa) reversas += 1
    await prisma.movimientoBancario.update({
      where: { id: c.id },
      data: {
        estadoConciliacion: 'conciliado',
        viaConciliacion: 'manual',
        movimientoId: null,
        categoriaManualId: categoriaId,
        esReversa: reversa,
        notaConciliacion: reversa
          ? `REVERSA de "${categoria.nombre}": es un abono en una fila de egreso, así que resta`
          : modo === 'reemplazar'
            ? `reemplazó el valor manual de "${categoria.nombre}"`
            : `sumado al valor manual de "${categoria.nombre}"`,
      },
    })
  }

  return {
    ok: true,
    detalle:
      `${cargos.length} movimientos aplicados a "${categoria.nombre}" en ${porMes.size} ` +
      `${porMes.size === 1 ? 'mes' : 'meses'} (${modo})` +
      (reversas > 0 ? `, ${reversas} marcados como reversa porque restan.` : '.'),
  }
}
