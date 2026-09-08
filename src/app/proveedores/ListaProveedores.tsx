'use client'

import { Fragment, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MONEDAS } from '@/lib/dominio'
import { formatearCLPConCero } from '@/lib/formato'
import { cambiarActivo, guardarMoneda, guardarRemitentes } from './acciones'
import {
  aprobarCandidato,
  aprobarTodosDe,
  buscarRemitentes,
  descartarCandidato,
  quitarRemitente,
} from './acciones-gmail'
import type { ResumenDescubrimiento } from '@/lib/gmail/descubrir'

export interface Candidato {
  id: string
  email: string
  nombreDe: string | null
  cantidad: number
  asuntoEjemplo: string
  ultimoCorreo: string
  /** En cuántos proveedores distintos aparece este mismo remitente. */
  enCuantosProveedores: number
}

/** A partir de aquí el remitente es casi con seguridad ruido, no del proveedor. */
const UMBRAL_GENERICO = 3

export interface FilaProveedor {
  id: string
  nombre: string
  categoriaNombre: string
  grupo: string
  monedaDefecto: string
  activo: boolean
  remitentes: string[]
  totalAnio: number
  movimientos: number
  candidatos: Candidato[]
}

interface Props {
  proveedores: FilaProveedor[]
  anio: number
  hayCuentaGoogle: boolean
}

export function ListaProveedores({ proveedores, anio, hayCuentaGoogle }: Props) {
  const router = useRouter()
  const [pendiente, iniciar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [editandoRemitentes, setEditandoRemitentes] = useState<string | null>(null)
  const [borrador, setBorrador] = useState('')
  const [soloConCandidatos, setSoloConCandidatos] = useState(false)

  const visibles = useMemo(() => {
    let lista = proveedores
    if (soloConCandidatos) lista = lista.filter((p) => p.candidatos.length > 0)
    const texto = busqueda.trim().toLowerCase()
    if (texto === '') return lista
    return lista.filter(
      (proveedor) =>
        proveedor.nombre.toLowerCase().includes(texto) ||
        proveedor.categoriaNombre.toLowerCase().includes(texto) ||
        proveedor.remitentes.some((remitente) => remitente.includes(texto)) ||
        proveedor.candidatos.some((candidato) => candidato.email.includes(texto)),
    )
  }, [proveedores, busqueda, soloConCandidatos])

  const grupos = useMemo(() => {
    const mapa = new Map<string, FilaProveedor[]>()
    for (const proveedor of visibles) {
      const lista = mapa.get(proveedor.categoriaNombre)
      if (lista) lista.push(proveedor)
      else mapa.set(proveedor.categoriaNombre, [proveedor])
    }
    return [...mapa.entries()]
  }, [visibles])

  const conRemitentes = proveedores.filter((p) => p.remitentes.length > 0).length
  const totalCandidatos = proveedores.reduce((suma, p) => suma + p.candidatos.length, 0)
  const sinRemitentes = proveedores.filter((p) => p.activo && p.remitentes.length === 0).length

  const correr = (accion: () => Promise<{ ok: boolean; error?: string }>): void => {
    iniciar(async () => {
      const resultado = await accion()
      if (!resultado.ok) setError(resultado.error ?? 'No se pudo completar la acción.')
      else setError(null)
      router.refresh()
    })
  }

  const buscar = (soloProveedorId?: string): void => {
    setError(null)
    setAviso(null)
    iniciar(async () => {
      const resultado = await buscarRemitentes(soloProveedorId)
      if (!resultado.ok) {
        setError(resultado.error ?? 'No se pudo buscar en Gmail.')
        return
      }
      setAviso(resumenEnPalabras(resultado.resumen))
      router.refresh()
    })
  }

  const guardar = (proveedorId: string): void => {
    iniciar(async () => {
      const resultado = await guardarRemitentes(proveedorId, borrador)
      if (!resultado.ok) {
        setError(resultado.error ?? 'No se pudo guardar.')
        return
      }
      setEditandoRemitentes(null)
      setError(null)
      router.refresh()
    })
  }

  const claseControl =
    'rounded border border-linea-fuerte bg-white px-2 py-1 text-[12px] outline-none focus:border-acento'

  return (
    <div className="flex h-[calc(100vh-41px)] flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-linea px-4 py-2">
        <div>
          <h1 className="text-[14px] font-semibold tracking-tight">Proveedores y colaboradores</h1>
          <p className="text-[11px] text-tenue">
            {proveedores.length} en total · {conRemitentes} con remitentes cargados
            {sinRemitentes > 0 ? ` · ${sinRemitentes} activos sin remitentes` : ''}
            {totalCandidatos > 0 ? ` · ${totalCandidatos} candidatos por revisar` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className={claseControl + ' w-56'}
            placeholder="Buscar por nombre, categoría o correo…"
            value={busqueda}
            onChange={(evento) => setBusqueda(evento.target.value)}
          />
          <button
            type="button"
            onClick={() => buscar()}
            disabled={pendiente || !hayCuentaGoogle}
            title={
              hayCuentaGoogle
                ? 'Busca en Gmail los remitentes de los proveedores activos que aún no tienen ninguno'
                : 'Primero entra con Google para autorizar el acceso a Gmail'
            }
            className="whitespace-nowrap rounded bg-acento px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pendiente ? 'Buscando…' : 'Buscar remitentes en Gmail'}
          </button>
        </div>
      </div>

      {!hayCuentaGoogle ? (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[12px] text-amber-900">
          Todavía no hay una cuenta de Google conectada. Sal y vuelve a entrar con Google para
          autorizar el acceso de solo lectura a Gmail.
        </div>
      ) : null}

      {aviso ? (
        <div className="flex items-center justify-between border-b border-blue-200 bg-blue-50 px-4 py-1.5 text-[12px] text-acento">
          <span>{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} className="underline">
            cerrar
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-1.5 text-[12px] text-negativo">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="underline">
            cerrar
          </button>
        </div>
      ) : null}

      {totalCandidatos > 0 ? (
        <div className="flex items-center gap-2 border-b border-linea bg-panel px-4 py-1.5">
          <label className="flex items-center gap-1.5 text-[12px]">
            <input
              type="checkbox"
              checked={soloConCandidatos}
              onChange={(evento) => setSoloConCandidatos(evento.target.checked)}
            />
            Mostrar solo los proveedores con candidatos por revisar
          </label>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="tabla-flujo w-full">
          <thead>
            <tr>
              <Th>Proveedor</Th>
              <Th>Moneda</Th>
              <Th>Activo</Th>
              <Th>Remitentes de email</Th>
              <Th alineacion="right">Mov.</Th>
              <Th alineacion="right">Total {anio}</Th>
            </tr>
          </thead>
          <tbody>
            {grupos.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[12px] text-tenue">
                  Ningún proveedor coincide con el filtro.
                </td>
              </tr>
            ) : null}

            {grupos.map(([categoria, lista]) => (
              <Fragment key={categoria}>
                <tr className="bg-panel">
                  <td
                    colSpan={6}
                    className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-tenue"
                  >
                    {categoria}
                    <span className="ml-2 font-normal normal-case">
                      {lista.length} {lista.length === 1 ? 'proveedor' : 'proveedores'}
                    </span>
                  </td>
                </tr>

                {lista.map((proveedor) => (
                  <Fragment key={proveedor.id}>
                    <tr className={proveedor.activo ? 'bg-white' : 'bg-[#fafafa]'}>
                      <td className="px-3 py-1.5">
                        <span className={proveedor.activo ? '' : 'text-tenue line-through'}>
                          {proveedor.nombre}
                        </span>
                      </td>

                      <td className="px-3 py-1.5">
                        <select
                          className={claseControl}
                          value={proveedor.monedaDefecto}
                          disabled={pendiente}
                          onChange={(evento) => {
                            const moneda = evento.target.value
                            correr(() => guardarMoneda(proveedor.id, moneda))
                          }}
                        >
                          {MONEDAS.map((moneda) => (
                            <option key={moneda} value={moneda}>
                              {moneda}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={proveedor.activo}
                          disabled={pendiente}
                          onChange={(evento) => {
                            const activo = evento.target.checked
                            correr(() => cambiarActivo(proveedor.id, activo))
                          }}
                        />
                      </td>

                      <td className="px-3 py-1.5">
                        {editandoRemitentes === proveedor.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              autoFocus
                              className={claseControl + ' w-96'}
                              value={borrador}
                              placeholder="facturas@proveedor.com, pagos@proveedor.com"
                              onChange={(evento) => setBorrador(evento.target.value)}
                              onKeyDown={(evento) => {
                                if (evento.key === 'Enter') {
                                  evento.preventDefault()
                                  guardar(proveedor.id)
                                }
                                if (evento.key === 'Escape') {
                                  evento.preventDefault()
                                  setEditandoRemitentes(null)
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => guardar(proveedor.id)}
                              disabled={pendiente}
                              className="rounded bg-acento px-2 py-1 text-[11px] font-medium text-white disabled:opacity-50"
                            >
                              Guardar
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditandoRemitentes(null)}
                              className="text-[11px] text-tenue underline underline-offset-2"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {proveedor.remitentes.map((remitente) => (
                              <span
                                key={remitente}
                                className="group inline-flex items-center gap-1 rounded bg-realce px-1.5 py-0.5 text-[11px] text-acento"
                              >
                                {remitente}
                                <button
                                  type="button"
                                  title="Quitar este remitente"
                                  onClick={() => correr(() => quitarRemitente(proveedor.id, remitente))}
                                  className="text-tenue hover:text-negativo"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                            <button
                              type="button"
                              onClick={() => {
                                setEditandoRemitentes(proveedor.id)
                                setBorrador(proveedor.remitentes.join(', '))
                                setError(null)
                              }}
                              className="text-[11px] text-tenue underline decoration-dotted underline-offset-2"
                            >
                              {proveedor.remitentes.length === 0 ? 'agregar correos…' : 'editar'}
                            </button>
                            {hayCuentaGoogle && proveedor.candidatos.length === 0 ? (
                              <button
                                type="button"
                                onClick={() => buscar(proveedor.id)}
                                disabled={pendiente}
                                className="text-[11px] text-acento underline underline-offset-2 disabled:opacity-50"
                              >
                                buscar en Gmail
                              </button>
                            ) : null}
                          </div>
                        )}
                      </td>

                      <td className="cifra px-3 py-1.5 text-right text-tenue">
                        {proveedor.movimientos}
                      </td>
                      <td
                        className={
                          'cifra px-3 py-1.5 text-right ' +
                          (proveedor.totalAnio < 0 ? 'negativo' : '')
                        }
                      >
                        {formatearCLPConCero(proveedor.totalAnio)}
                      </td>
                    </tr>

                    {proveedor.candidatos.length > 0 ? (
                      <tr className="bg-[#fffdf5]">
                        <td colSpan={6} className="px-3 py-2">
                          <div className="mb-1.5 flex items-center gap-3">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
                              Candidatos encontrados en Gmail ({proveedor.candidatos.length})
                            </span>
                            <button
                              type="button"
                              onClick={() => correr(() => aprobarTodosDe(proveedor.id))}
                              disabled={pendiente}
                              className="text-[11px] text-acento underline underline-offset-2 disabled:opacity-50"
                            >
                              aprobar todos
                            </button>
                          </div>
                          <table className="w-full">
                            <tbody>
                              {[...proveedor.candidatos]
                                .sort(
                                  (a, b) =>
                                    a.enCuantosProveedores - b.enCuantosProveedores ||
                                    b.cantidad - a.cantidad,
                                )
                                .map((candidato) => (
                                <tr key={candidato.id} className="align-top">
                                  <td className="w-72 py-1 pr-3">
                                    <div className="text-[12px] font-medium">{candidato.email}</div>
                                    {candidato.nombreDe ? (
                                      <div className="text-[11px] text-tenue">
                                        {candidato.nombreDe}
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="w-24 py-1 pr-3 text-[11px] text-tenue">
                                    {candidato.cantidad}{' '}
                                    {candidato.cantidad === 1 ? 'correo' : 'correos'}
                                  </td>
                                  <td className="w-36 py-1 pr-3 text-[11px]">
                                    {candidato.enCuantosProveedores >= UMBRAL_GENERICO ? (
                                      <span
                                        className="rounded bg-amber-200 px-1.5 py-0.5 text-amber-900"
                                        title="Este mismo remitente aparece bajo varios proveedores, así que probablemente no sea de ninguno en particular."
                                      >
                                        genérico · {candidato.enCuantosProveedores} prov.
                                      </span>
                                    ) : (
                                      <span className="text-tenue">solo aquí</span>
                                    )}
                                  </td>
                                  <td className="w-28 py-1 pr-3 text-[11px] text-tenue">
                                    último {candidato.ultimoCorreo}
                                  </td>
                                  <td className="py-1 pr-3 text-[11px] text-tenue">
                                    <span className="italic">
                                      {candidato.asuntoEjemplo || 'sin asunto'}
                                    </span>
                                  </td>
                                  <td className="w-40 whitespace-nowrap py-1 text-right">
                                    <button
                                      type="button"
                                      onClick={() => correr(() => aprobarCandidato(candidato.id))}
                                      disabled={pendiente}
                                      className="mr-2 rounded bg-acento px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
                                    >
                                      Aprobar
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => correr(() => descartarCandidato(candidato.id))}
                                      disabled={pendiente}
                                      className="text-[11px] text-tenue underline underline-offset-2 hover:text-negativo disabled:opacity-50"
                                    >
                                      Descartar
                                    </button>
                                  </td>
                                </tr>
                                ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function resumenEnPalabras(resumen: ResumenDescubrimiento | undefined): string {
  if (!resumen) return 'Búsqueda terminada.'
  const partes = [
    `${resumen.proveedoresBuscados} proveedores buscados`,
    `${resumen.proveedoresConCandidatos} con resultados`,
    `${resumen.candidatosNuevos} candidatos nuevos`,
  ]
  if (resumen.errores.length > 0) {
    partes.push(
      `${resumen.errores.length} con error (${resumen.errores
        .slice(0, 3)
        .map((e) => e.proveedor)
        .join(', ')}${resumen.errores.length > 3 ? '…' : ''})`,
    )
  }
  return partes.join(' · ')
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
