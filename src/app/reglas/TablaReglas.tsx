'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatearCLPConCero, parsearCLP } from '@/lib/formato'
import {
  actualizarRegla,
  cambiarActivaRegla,
  crearRegla,
  eliminarRegla,
  probarRegla,
  type DatosRegla,
  type ResultadoPrueba,
} from './acciones'

export interface FilaRegla {
  id: string
  patron: string
  montoExacto: number | null
  categoriaId: string
  categoriaNombre: string
  proveedorId: string | null
  proveedorNombre: string | null
  nota: string
  activa: boolean
}

interface OpcionCategoria {
  id: string
  nombre: string
  grupo: string
  esManual: boolean
}

interface OpcionProveedor {
  id: string
  nombre: string
  categoriaId: string
}

interface Props {
  reglas: FilaRegla[]
  categorias: OpcionCategoria[]
  proveedores: OpcionProveedor[]
}

const VACIA: DatosRegla = {
  patron: '',
  montoExacto: null,
  categoriaId: '',
  proveedorId: null,
  nota: '',
  activa: true,
}

export function TablaReglas({ reglas, categorias, proveedores }: Props) {
  const router = useRouter()
  const [pendiente, iniciar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<DatosRegla | null>(null)
  const [montoTexto, setMontoTexto] = useState('')
  const [borrando, setBorrando] = useState<string | null>(null)

  // Probador
  const [glosa, setGlosa] = useState('')
  const [montoPrueba, setMontoPrueba] = useState('')
  const [prueba, setPrueba] = useState<ResultadoPrueba | null>(null)

  const proveedoresDeCategoria = useMemo(() => {
    if (!formulario?.categoriaId) return []
    return proveedores.filter((p) => p.categoriaId === formulario.categoriaId)
  }, [proveedores, formulario?.categoriaId])

  /** Los patrones con más de una regla son los que ejercitan la precedencia. */
  const patronesConVarias = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const r of reglas) cuenta.set(r.patron, (cuenta.get(r.patron) ?? 0) + 1)
    return new Set([...cuenta.entries()].filter(([, n]) => n > 1).map(([p]) => p))
  }, [reglas])

  const abrirNueva = (): void => {
    setEditandoId(null)
    setFormulario(VACIA)
    setMontoTexto('')
    setError(null)
  }

  const abrirEdicion = (r: FilaRegla): void => {
    setEditandoId(r.id)
    setFormulario({
      patron: r.patron,
      montoExacto: r.montoExacto,
      categoriaId: r.categoriaId,
      proveedorId: r.proveedorId,
      nota: r.nota,
      activa: r.activa,
    })
    setMontoTexto(r.montoExacto === null ? '' : String(r.montoExacto))
    setError(null)
  }

  const guardar = (): void => {
    if (!formulario) return
    if (!formulario.categoriaId) {
      setError('Elige una categoría.')
      return
    }
    let monto: number | null = null
    if (montoTexto.trim() !== '') {
      const parseado = parsearCLP(montoTexto)
      if (parseado === null) {
        setError(`No entendí el monto "${montoTexto}".`)
        return
      }
      monto = parseado
    }
    const datos: DatosRegla = { ...formulario, montoExacto: monto }

    iniciar(async () => {
      const r = editandoId ? await actualizarRegla(editandoId, datos) : await crearRegla(datos)
      if (!r.ok) {
        setError(r.error ?? 'No se pudo guardar.')
        return
      }
      setFormulario(null)
      setEditandoId(null)
      setError(null)
      router.refresh()
    })
  }

  const correr = (accion: () => Promise<{ ok: boolean; error?: string }>): void => {
    iniciar(async () => {
      const r = await accion()
      if (!r.ok) setError(r.error ?? 'No se pudo completar.')
      setBorrando(null)
      router.refresh()
    })
  }

  const probar = (): void => {
    const monto = parsearCLP(montoPrueba) ?? 0
    iniciar(async () => {
      setPrueba(await probarRegla(glosa, monto))
    })
  }

  const control =
    'rounded border border-linea-fuerte bg-white px-2 py-1 text-[12px] outline-none focus:border-acento'

  return (
    <div className="flex h-[calc(100vh-41px)] flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-linea px-4 py-2">
        <div>
          <h1 className="text-[14px] font-semibold tracking-tight">Reglas de clasificación</h1>
          <p className="text-[11px] text-tenue">
            {reglas.length} reglas · Un mismo texto del banco puede ser cosas distintas: el monto
            desempata. Gana la regla con monto exacto; si no hay, la del mismo patrón sin monto.
          </p>
        </div>
        <button
          type="button"
          onClick={abrirNueva}
          className="rounded bg-acento px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-700"
        >
          Nueva regla
        </button>
      </div>

      {error ? (
        <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-1.5 text-[12px] text-negativo">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="underline">
            cerrar
          </button>
        </div>
      ) : null}

      {/* Formulario */}
      {formulario ? (
        <div className="border-b border-linea-fuerte bg-[#f5f8ff] px-4 py-3">
          <div className="mb-2 text-[12px] font-semibold">
            {editandoId ? 'Editar regla' : 'Nueva regla'}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Campo etiqueta="Patrón de la glosa">
              <input
                className={control + ' w-64'}
                placeholder="Transf a MOLINA OVALLE"
                value={formulario.patron}
                onChange={(e) => setFormulario({ ...formulario, patron: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Monto exacto (vacío = cualquiera)">
              <input
                className={control + ' w-36 text-right'}
                placeholder="cualquier monto"
                value={montoTexto}
                onChange={(e) => setMontoTexto(e.target.value)}
              />
            </Campo>
            <Campo etiqueta="Categoría destino">
              <select
                className={control + ' w-52'}
                value={formulario.categoriaId}
                onChange={(e) =>
                  setFormulario({ ...formulario, categoriaId: e.target.value, proveedorId: null })
                }
              >
                <option value="">Elegir…</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                    {c.esManual ? ' (fila manual)' : ''}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Proveedor destino">
              <select
                className={control + ' w-48'}
                value={formulario.proveedorId ?? ''}
                disabled={proveedoresDeCategoria.length === 0}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    proveedorId: e.target.value === '' ? null : e.target.value,
                  })
                }
              >
                <option value="">Sin proveedor</option>
                {proveedoresDeCategoria.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Nota">
              <input
                className={control + ' w-72'}
                value={formulario.nota}
                onChange={(e) => setFormulario({ ...formulario, nota: e.target.value })}
              />
            </Campo>
            <label className="flex items-center gap-1.5 pb-1 text-[12px]">
              <input
                type="checkbox"
                checked={formulario.activa}
                onChange={(e) => setFormulario({ ...formulario, activa: e.target.checked })}
              />
              Activa
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={guardar}
                disabled={pendiente}
                className="rounded bg-acento px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {pendiente ? 'Guardando…' : 'Guardar'}
              </button>
              <button
                type="button"
                onClick={() => setFormulario(null)}
                className="rounded border border-linea-fuerte bg-white px-3 py-1.5 text-[12px]"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Probador */}
      <div className="border-b border-linea bg-panel px-4 py-2">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Probar una glosa">
            <input
              className={control + ' w-72'}
              placeholder="0153152497 Transf a MOLINA OVALLE"
              value={glosa}
              onChange={(e) => setGlosa(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Monto">
            <input
              className={control + ' w-32 text-right'}
              placeholder="1.500.000"
              value={montoPrueba}
              onChange={(e) => setMontoPrueba(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') probar()
              }}
            />
          </Campo>
          <button
            type="button"
            onClick={probar}
            disabled={pendiente}
            className="mb-0.5 rounded border border-linea-fuerte bg-white px-3 py-1.5 text-[12px] font-medium hover:bg-white/70 disabled:opacity-50"
          >
            Probar
          </button>
          {prueba ? (
            <div className="mb-1 text-[12px]">
              {prueba.error ? (
                <span className="text-negativo">{prueba.error}</span>
              ) : prueba.quedaSinConciliar ? (
                <span className="text-amber-800">
                  Quedaría sin conciliar — {prueba.explicacion}
                </span>
              ) : (
                <span>
                  <span className="font-medium text-acento">{prueba.categoria}</span>
                  {prueba.proveedor ? ` · ${prueba.proveedor}` : ' · sin proveedor'}
                  <span className="ml-2 text-tenue">({prueba.explicacion})</span>
                </span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Tabla */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="tabla-flujo w-full">
          <thead>
            <tr>
              <Th>Patrón de la glosa</Th>
              <Th alineacion="right">Monto exacto</Th>
              <Th>Categoría destino</Th>
              <Th>Proveedor</Th>
              <Th>Nota</Th>
              <Th>Activa</Th>
              <Th alineacion="right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {reglas.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[12px] text-tenue">
                  No hay reglas todavía.
                </td>
              </tr>
            ) : null}
            {reglas.map((r) => (
              <tr key={r.id} className={r.activa ? 'bg-white' : 'bg-[#fafafa]'}>
                <td className="px-3 py-1.5">
                  <span className={r.activa ? '' : 'text-tenue line-through'}>{r.patron}</span>
                  {patronesConVarias.has(r.patron) ? (
                    <span
                      className="ml-2 rounded bg-realce px-1.5 py-0.5 text-[10px] text-acento"
                      title="Este patrón tiene más de una regla: el monto decide cuál gana."
                    >
                      precedencia
                    </span>
                  ) : null}
                </td>
                <td className="cifra px-3 py-1.5 text-right">
                  {r.montoExacto === null ? (
                    <span className="text-tenue">cualquiera</span>
                  ) : (
                    formatearCLPConCero(r.montoExacto)
                  )}
                </td>
                <td className="px-3 py-1.5">{r.categoriaNombre}</td>
                <td className="px-3 py-1.5 text-tenue">{r.proveedorNombre ?? '—'}</td>
                <td className="px-3 py-1.5 text-[11px] text-tenue">{r.nota || '—'}</td>
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked={r.activa}
                    disabled={pendiente}
                    onChange={(e) => {
                      const activa = e.target.checked
                      correr(() => cambiarActivaRegla(r.id, activa))
                    }}
                  />
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => abrirEdicion(r)}
                    className="mr-2 text-[11px] text-acento underline underline-offset-2"
                  >
                    Editar
                  </button>
                  {borrando === r.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => correr(() => eliminarRegla(r.id))}
                        className="mr-1 text-[11px] font-medium text-negativo underline underline-offset-2"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setBorrando(null)}
                        className="text-[11px] text-tenue underline underline-offset-2"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setBorrando(r.id)}
                      className="text-[11px] text-tenue underline underline-offset-2 hover:text-negativo"
                    >
                      Eliminar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, alineacion }: { children: React.ReactNode; alineacion?: 'right' }) {
  return (
    <th
      className={
        'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-tenue ' +
        (alineacion === 'right' ? 'text-right' : 'text-left')
      }
    >
      {children}
    </th>
  )
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-tenue">{etiqueta}</span>
      {children}
    </label>
  )
}
