'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Undo2 } from 'lucide-react'
import type { EstadoObligaciones } from '@/lib/obligaciones'
import { MESES, tipoObligacion } from '@/lib/dominio'
import { Tarjeta, clp } from '@/componentes/ui'
import { marcarCotizacionPagada, marcarCuotaPagada } from './acciones-pago'

/**
 * Lo que hay que pagar ahora, con un botón para darlo por pagado.
 *
 * POR QUÉ EXISTE
 * La cartola se descarga a mano y llega cuando llega, así que entre pagar una cuota
 * y verla conciliada pasan días. En ese hueco la obligación seguía apareciendo
 * pendiente y el aviso por correo la reportaba como atrasada. Avisar por algo ya
 * resuelto es el camino más corto a que se dejen de leer todos los avisos.
 *
 * QUÉ ENTRA
 * Cuotas y cotizaciones sin pagar cuyo mes ya llegó, más las que se declararon
 * pagadas hace poco, para poder deshacerlo. Las cuotas de meses futuros no salen:
 * la lista responde "qué debo hoy", y meterle el calendario entero la volvería otra
 * tabla que hay que leer entera para encontrar algo.
 *
 * LO DECLARADO SE DISTINGUE DE LO CONCILIADO
 * "Pagada, sin cargo aún" es una declaración; "pagada" a secas es que el banco lo
 * muestra. La diferencia importa: el "ya pagado" del panel sigue saliendo de la
 * cartola y no de esta marca, porque una declaración no prueba que la plata salió.
 */

interface Item {
  clase: 'cuota' | 'cotizacion'
  id: string
  concepto: string
  detalle: string
  monto: number
  /** anio * 12 + mes, para ordenar. */
  orden: number
  pagada: boolean
  /** Pagada por declaración, sin cargo del banco todavía. */
  declarada: boolean
  atrasada: boolean
}

export function PendientesDePago({ estado, hoy }: { estado: EstadoObligaciones; hoy: { anio: number; mes: number } }) {
  const router = useRouter()
  const [pendiente, iniciar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const ahora = hoy.anio * 12 + hoy.mes

  const items: Item[] = []

  for (const o of estado.obligaciones) {
    const nombre = tipoObligacion(o.tipo).nombre(o)
    for (const c of o.cuotas) {
      const orden = c.anio * 12 + c.mes
      if (orden > ahora) continue
      if (c.estado === 'por_generar') continue
      const declarada = c.estado === 'pagada' && !c.conCargo && c.fechaPago !== null
      // Las ya conciliadas no se listan: no hay nada que decidir sobre ellas.
      if (c.estado === 'pagada' && !declarada) continue
      // Una declaración vieja tampoco: deshacerla ya no es el caso de uso.
      if (declarada && orden < ahora - 1) continue
      items.push({
        clase: 'cuota',
        id: c.id,
        concepto: `${nombre}, ${MESES[c.mes - 1]?.toLowerCase()}`,
        detalle: declarada ? `declarada pagada el ${c.fechaPago}` : `cuota de ${c.mes}/${c.anio}`,
        monto: c.monto,
        orden,
        pagada: c.estado === 'pagada',
        declarada,
        atrasada: c.estado !== 'pagada' && orden < ahora,
      })
    }
  }

  for (const c of estado.cotizaciones) {
    const orden = c.anio * 12 + c.mes
    if (orden > ahora) continue
    const declarada = c.estado === 'pagada' && c.fechaPago !== null
    if (c.estado === 'pagada' && orden < ahora - 1) continue
    items.push({
      clase: 'cotizacion',
      id: c.id,
      concepto: `Cotización previsional de ${MESES[c.mes - 1]?.toLowerCase()}`,
      detalle:
        c.estado === 'pagada'
          ? `pagada${c.fechaPago ? ` el ${c.fechaPago}` : ''}`
          : c.diasDeAtraso && c.diasDeAtraso > 0
            ? `${c.diasDeAtraso} días de atraso`
            : `vence el ${c.fechaVencimiento ?? '13'}`,
      monto: c.monto,
      orden,
      pagada: c.estado === 'pagada',
      declarada,
      atrasada: c.estado === 'atrasada',
    })
  }

  items.sort((a, b) => (a.pagada === b.pagada ? a.orden - b.orden : a.pagada ? 1 : -1))
  const porPagar = items.filter((i) => !i.pagada)
  const total = porPagar.reduce((a, i) => a + i.monto, 0)

  const alternar = (item: Item): void => {
    setError(null)
    iniciar(async () => {
      const accion = item.clase === 'cuota' ? marcarCuotaPagada : marcarCotizacionPagada
      const r = await accion(item.id, !item.pagada)
      if (!r.ok) setError(r.error ?? 'No se pudo.')
      else router.refresh()
    })
  }

  if (items.length === 0) return null

  return (
    <Tarjeta
      titulo="Pendiente de pago"
      variante={porPagar.length > 0 ? 'urgente' : 'normal'}
      bajada={
        porPagar.length > 0
          ? `${porPagar.length} ${porPagar.length === 1 ? 'obligación' : 'obligaciones'} por ${clp(total)}. Márcalas aquí apenas pagues, sin esperar a que el cargo llegue a la cartola.`
          : 'Todo lo vencido está pagado.'
      }
    >
      {error ? (
        <p className="mb-e3 rounded-[8px] bg-negativo/[0.06] px-e3 py-e2 text-[12.5px] text-negativo">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-linea">
        {items.map((item) => (
          <li key={`${item.clase}:${item.id}`} className="flex items-center gap-e3 py-e2">
            <div className="min-w-0 flex-1">
              <div className={'text-[12.5px] ' + (item.pagada ? 'text-tenue line-through' : '')}>
                {item.concepto}
              </div>
              <div className={'t-apoyo ' + (item.atrasada ? '!text-negativo' : '')}>
                {item.detalle}
                {item.declarada ? ' · sin cargo del banco todavía' : ''}
              </div>
            </div>
            <div className="monto shrink-0 text-[12.5px]">{clp(item.monto)}</div>
            <button
              type="button"
              disabled={pendiente}
              onClick={() => alternar(item)}
              className={
                'flex shrink-0 items-center gap-1.5 rounded-[8px] px-e3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ' +
                (item.pagada
                  ? 'text-tenue hover:bg-panel hover:text-tinta'
                  : 'bg-acento-superficie text-claro hover:opacity-90')
              }
            >
              {item.pagada ? (
                <>
                  <Undo2 size={13} strokeWidth={2} />
                  Desmarcar
                </>
              ) : (
                <>
                  <Check size={13} strokeWidth={2} />
                  Marcar pagada
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}
