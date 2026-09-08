'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, Check, Pencil, X } from 'lucide-react'
import type { F29DelMes } from '@/lib/sii/f29'
import { Marca, clp } from '@/componentes/ui'
import { guardarF29 } from './acciones'

/**
 * El F29 mes a mes, con el desglose editable.
 *
 * El IVA no se edita: sale de los registros del SII. Lo que se llena a mano es lo
 * que ningún registro puede dar —PPM, retenciones, otros— y el total que informa el
 * contador, que suele llegar antes que el desglose.
 */

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const aNumero = (texto: string): number | null => {
  const limpio = texto.replace(/[^\d-]/g, '')
  if (limpio === '') return 0
  const n = Number(limpio)
  return Number.isFinite(n) && n >= 0 ? n : null
}

function Campo({
  valor,
  onChange,
  autoFocus,
}: {
  valor: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <input
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      inputMode="numeric"
      className="w-28 rounded border border-linea-fuerte bg-superficie px-1.5 py-0.5 text-right text-[12.5px] tabular-nums outline-none focus:border-acento"
    />
  )
}

export function TablaF29({ filas, anio }: { filas: F29DelMes[]; anio: number }) {
  const [editando, setEditando] = useState<number | null>(null)
  const [borrador, setBorrador] = useState({ ppm: '', retenciones: '', otros: '', total: '' })
  const [error, setError] = useState<string | null>(null)
  const [guardando, iniciar] = useTransition()

  const abrir = (f: F29DelMes): void => {
    setError(null)
    setEditando(f.mesPeriodo)
    setBorrador({
      ppm: String(f.ppm || ''),
      retenciones: String(f.retencionesHonorarios || ''),
      otros: String(f.otros || ''),
      total: String(f.totalDeclarado ?? ''),
    })
  }

  const guardar = (mes: number): void => {
    const ppm = aNumero(borrador.ppm)
    const retenciones = aNumero(borrador.retenciones)
    const otros = aNumero(borrador.otros)
    const total = borrador.total.trim() === '' ? null : aNumero(borrador.total)
    if (ppm === null || retenciones === null || otros === null || total === null) {
      setError('Los montos tienen que ser números positivos.')
      return
    }
    iniciar(async () => {
      const r = await guardarF29(anio, mes, {
        ppm,
        retencionesHonorarios: retenciones,
        otros,
        totalDeclarado: borrador.total.trim() === '' ? null : total,
      })
      if (r.ok) setEditando(null)
      else setError(r.error ?? 'No se pudo guardar.')
    })
  }

  return (
    <>
      {error ? (
        <p className="mb-2 flex items-center gap-1.5 text-[12.5px] text-negativo">
          <AlertTriangle size={13} strokeWidth={2} />
          {error}
        </p>
      ) : null}
      <div className="-mx-4 overflow-x-auto">
        <table className="tabla min-w-[820px]">
          <thead>
            <tr>
              <th>Período</th>
              <th className="!text-right">IVA</th>
              <th className="!text-right">PPM</th>
              <th className="!text-right">Retenciones</th>
              <th className="!text-right">Otros</th>
              <th className="!text-right">Total</th>
              <th>Estado</th>
              <th>Vence</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const enEdicion = editando === f.mesPeriodo
              return (
                <tr key={f.mesPeriodo}>
                  <td className="whitespace-nowrap">{MESES[f.mesPeriodo - 1]}</td>
                  <td className="monto">{clp(f.iva?.aPagar ?? 0)}</td>

                  {enEdicion ? (
                    <>
                      <td className="!py-1 text-right">
                        <Campo
                          valor={borrador.ppm}
                          onChange={(v) => setBorrador({ ...borrador, ppm: v })}
                          autoFocus
                        />
                      </td>
                      <td className="!py-1 text-right">
                        <Campo
                          valor={borrador.retenciones}
                          onChange={(v) => setBorrador({ ...borrador, retenciones: v })}
                        />
                      </td>
                      <td className="!py-1 text-right">
                        <Campo
                          valor={borrador.otros}
                          onChange={(v) => setBorrador({ ...borrador, otros: v })}
                        />
                      </td>
                      <td className="!py-1 text-right">
                        <Campo
                          valor={borrador.total}
                          onChange={(v) => setBorrador({ ...borrador, total: v })}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="monto">{f.ppm > 0 ? clp(f.ppm) : <span className="text-linea-fuerte">·</span>}</td>
                      <td className="monto">
                        {f.retencionesHonorarios > 0 ? (
                          clp(f.retencionesHonorarios)
                        ) : (
                          <span className="text-linea-fuerte">·</span>
                        )}
                      </td>
                      <td className="monto">
                        {f.otros > 0 ? clp(f.otros) : <span className="text-linea-fuerte">·</span>}
                      </td>
                      <td className="monto font-medium">{clp(f.total)}</td>
                    </>
                  )}

                  <td>
                    {f.completo ? (
                      f.sinDesglosar > 0 ? (
                        <Marca tono="alerta">Falta {clp(f.sinDesglosar)}</Marca>
                      ) : (
                        <Marca tono="positivo">Completo</Marca>
                      )
                    ) : (
                      <Marca tono="alerta">Solo IVA</Marca>
                    )}
                  </td>
                  <td className="cifra text-tenue">{f.venceEl}</td>
                  <td className="!pr-4 text-right">
                    {enEdicion ? (
                      <span className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => guardar(f.mesPeriodo)}
                          disabled={guardando}
                          aria-label="Guardar"
                          className="rounded p-1 text-positivo hover:bg-panel disabled:opacity-40"
                        >
                          <Check size={14} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditando(null)
                            setError(null)
                          }}
                          aria-label="Cancelar"
                          className="rounded p-1 text-tenue hover:bg-panel"
                        >
                          <X size={14} strokeWidth={2} />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => abrir(f)}
                        aria-label={`Editar ${MESES[f.mesPeriodo - 1]}`}
                        className="rounded p-1 text-suave hover:bg-panel hover:text-tinta"
                      >
                        <Pencil size={13} strokeWidth={2} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12.5px] text-tenue">
        El IVA no se edita: sale del registro de compras y ventas del SII. Deja el total en blanco
        para que se calcule como la suma de las partes.
      </p>
    </>
  )
}
