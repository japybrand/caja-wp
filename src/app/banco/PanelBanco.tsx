'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { MESES, MESES_CORTOS } from '@/lib/dominio'
import { formatearCLPConCero } from '@/lib/formato'
import {
  asignarProveedor,
  asignarCategoriaManual,
  previsualizarCategoriaManual,
  crearMovimientoDesdeCargo,
  ignorarCargo,
  devolverABandeja,
  type VistaPreviaManual,
} from './acciones'

export interface GrupoGlosa {
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

export interface FilaBanco {
  id: string
  fecha: string
  mes: number
  monto: number
  descripcion: string
  tipo: string
  estado: string
  via: string
  nota: string
  proveedorSugerido: string | null
  movimiento: { descripcion: string; monto: number } | null
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
  categoriaNombre: string
}

interface Props {
  anio: number
  grupos: GrupoGlosa[]
  lista: FilaBanco[]
  categorias: OpcionCategoria[]
  proveedores: OpcionProveedor[]
  filtros: { mes: string; tipo: string; estado: string; texto: string }
  conteos: { estado: string; cantidad: number; monto: number }[]
}

type Accion = 'proveedor' | 'manual' | 'crear' | 'ignorar'

export function PanelBanco({
  anio,
  grupos,
  lista,
  categorias,
  proveedores,
  filtros,
  conteos,
}: Props) {
  const router = useRouter()
  const parametros = useSearchParams()
  const [pendiente, iniciar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [accion, setAccion] = useState<Accion>('proveedor')
  const [proveedorId, setProveedorId] = useState('')
  const [categoriaId, setCategoriaId] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [motivo, setMotivo] = useState('')
  const [modo, setModo] = useState<'reemplazar' | 'sumar'>('reemplazar')
  const [vista, setVista] = useState<VistaPreviaManual | null>(null)

  const manuales = useMemo(() => categorias.filter((c) => c.esManual), [categorias])
  const calculadas = useMemo(() => categorias.filter((c) => !c.esManual), [categorias])
  const proveedoresDeCategoria = useMemo(
    () => proveedores.filter((p) => p.categoriaId === categoriaId),
    [proveedores, categoriaId],
  )

  const totalSinConciliar = grupos.reduce((a, g) => a + g.total, 0)
  const cargosSinConciliar = grupos.reduce((a, g) => a + g.cargos, 0)
  const porEstado = new Map(conteos.map((c) => [c.estado, c]))

  const cambiarFiltro = (clave: string, valor: string): void => {
    const s = new URLSearchParams(parametros.toString())
    if (valor === '') s.delete(clave)
    else s.set(clave, valor)
    router.push(`/banco?${s.toString()}`)
  }

  const abrir = (g: GrupoGlosa): void => {
    setAbierto(abierto === g.glosa ? null : g.glosa)
    setAccion(g.sugeridoId ? 'proveedor' : g.esAbono ? 'ignorar' : 'proveedor')
    setProveedorId(g.sugeridoId ?? '')
    setCategoriaId('')
    setDescripcion('')
    setMotivo('')
    setModo('reemplazar')
    setVista(null)
    setError(null)
  }

  const correr = (accionFn: () => Promise<{ ok: boolean; error?: string; detalle?: string }>): void => {
    iniciar(async () => {
      const r = await accionFn()
      if (!r.ok) {
        setError(r.error ?? 'No se pudo completar.')
        return
      }
      setError(null)
      setAviso(r.detalle ?? 'Listo.')
      setAbierto(null)
      router.refresh()
    })
  }

  const pedirVista = (glosa: string, catId: string): void => {
    setVista(null)
    if (!catId) return
    iniciar(async () => {
      setVista(await previsualizarCategoriaManual(glosa, catId))
    })
  }

  const ejecutar = (glosa: string): void => {
    if (accion === 'proveedor') {
      if (!proveedorId) return setError('Elige un proveedor.')
      return correr(() => asignarProveedor(glosa, proveedorId))
    }
    if (accion === 'manual') {
      if (!categoriaId) return setError('Elige una fila manual del flujo.')
      return correr(() => asignarCategoriaManual(glosa, categoriaId, modo))
    }
    if (accion === 'crear') {
      if (!categoriaId) return setError('Elige una categoría.')
      return correr(() =>
        crearMovimientoDesdeCargo(glosa, categoriaId, proveedorId || null, descripcion),
      )
    }
    return correr(() => ignorarCargo(glosa, motivo))
  }

  const control =
    'rounded border border-linea-fuerte px-2 py-1 text-[12.5px] outline-none focus:border-acento'

  return (
    <div className="mx-auto max-w-[1120px] px-e5 py-e5">
      <div className="mb-e5">
        <h1 className="t-pagina">Banco {anio}</h1>
        <p className="t-apoyo">
          Cuenta corriente Santander ·{' '}
          {(porEstado.get('sin_conciliar')?.cantidad ?? 0) +
            (porEstado.get('conciliado')?.cantidad ?? 0) +
            (porEstado.get('ignorado')?.cantidad ?? 0)}{' '}
          movimientos · <span className="text-alerta">{cargosSinConciliar} sin conciliar</span> ·{' '}
          {porEstado.get('conciliado')?.cantidad ?? 0} conciliados ·{' '}
          {porEstado.get('ignorado')?.cantidad ?? 0} ignorados
        </p>
      </div>

      {aviso ? (
        <div className="flex items-center justify-between border-b border-blue-200 bg-blue-50 px-4 py-1.5 text-[12.5px] text-acento">
          <span>{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} className="underline">
            cerrar
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="flex items-center justify-between border-b border-negativo/25 bg-negativo/[0.04] px-4 py-1.5 text-[12.5px] text-negativo">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="underline">
            cerrar
          </button>
        </div>
      ) : null}

      <div>
        {/* ---------------------------------------------------------- bandeja */}
        <div className="mb-2 flex items-baseline gap-3">
          <h2 className="t-zona">
            Bandeja de sin conciliar
          </h2>
          <span className="t-apoyo">
            {grupos.length} glosas · {cargosSinConciliar} cargos ·{' '}
            {formatearCLPConCero(totalSinConciliar)}. Resolver una glosa resuelve todos sus cargos.
          </span>
        </div>

        <table className="tabla tabla-interactiva">
          <thead>
            <tr>
              <Th>Glosa del banco</Th>
              <Th alineacion="right">Cargos</Th>
              <Th>Meses</Th>
              <Th alineacion="right">Total</Th>
              <Th>Sugerencia</Th>
              <Th alineacion="right">Resolver</Th>
            </tr>
          </thead>
          <tbody>
            {grupos.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[12.5px] text-tenue">
                  No queda nada sin conciliar.
                </td>
              </tr>
            ) : null}
            {grupos.map((g) => (
              <FilaGrupo
                key={g.glosa}
                g={g}
                abierto={abierto === g.glosa}
                abrir={() => abrir(g)}
                pendiente={pendiente}
                accion={accion}
                setAccion={setAccion}
                proveedorId={proveedorId}
                setProveedorId={setProveedorId}
                categoriaId={categoriaId}
                setCategoriaId={setCategoriaId}
                descripcion={descripcion}
                setDescripcion={setDescripcion}
                motivo={motivo}
                setMotivo={setMotivo}
                modo={modo}
                setModo={setModo}
                vista={vista}
                pedirVista={(catId) => pedirVista(g.glosa, catId)}
                manuales={manuales}
                calculadas={calculadas}
                proveedores={proveedores}
                proveedoresDeCategoria={proveedoresDeCategoria}
                ejecutar={() => ejecutar(g.glosa)}
                control={control}
              />
            ))}
          </tbody>
        </table>

        {/* ------------------------------------------------------------ lista */}
        <h2 className="mb-2 mt-8 text-[11.5px] font-semibold uppercase tracking-wider text-tenue">
          Todos los movimientos
        </h2>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            className={control + ' w-56'}
            placeholder="Buscar en la glosa…"
            defaultValue={filtros.texto}
            onKeyDown={(e) => {
              if (e.key === 'Enter') cambiarFiltro('q', e.currentTarget.value)
            }}
            onBlur={(e) => {
              if (e.currentTarget.value !== filtros.texto) cambiarFiltro('q', e.currentTarget.value)
            }}
          />
          <select
            className={control}
            value={filtros.mes}
            onChange={(e) => cambiarFiltro('mes', e.target.value)}
          >
            <option value="">Todos los meses</option>
            {MESES.map((n, i) => (
              <option key={n} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
          <select
            className={control}
            value={filtros.tipo}
            onChange={(e) => cambiarFiltro('tipo', e.target.value)}
          >
            <option value="">Cargos y abonos</option>
            <option value="C">Solo cargos</option>
            <option value="A">Solo abonos</option>
          </select>
          <select
            className={control}
            value={filtros.estado}
            onChange={(e) => cambiarFiltro('estado', e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="sin_conciliar">Sin conciliar</option>
            <option value="conciliado">Conciliado</option>
            <option value="ignorado">Ignorado</option>
          </select>
          {Object.values(filtros).some((v) => v !== '') ? (
            <button
              type="button"
              onClick={() => router.push('/banco')}
              className="text-[12.5px] text-acento underline underline-offset-2"
            >
              Limpiar
            </button>
          ) : null}
          <span className="t-apoyo">{lista.length} filas</span>
        </div>

        <table className="tabla tabla-interactiva">
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Glosa</Th>
              <Th alineacion="right">Monto</Th>
              <Th>Estado</Th>
              <Th>Conciliado con</Th>
              <Th alineacion="right"> </Th>
            </tr>
          </thead>
          <tbody>
            {lista.map((b) => (
              <tr
                key={b.id}
                className={
                  b.estado === 'sin_conciliar'
                    ? 'bg-alerta/[0.06]'
                    : b.estado === 'ignorado'
                      ? 'bg-panel text-tenue'
                      : ''
                }
              >
                <td className="cifra">{b.fecha}</td>
                <td>{b.descripcion}</td>
                <td
                  className={'cifra px-3 py-1.5 text-right ' + (b.monto < 0 ? 'negativo' : 'text-acento')}
                >
                  {formatearCLPConCero(b.monto)}
                </td>
                <td className="text-[11.5px]">
                  {b.estado === 'sin_conciliar' ? (
                    <span className="rounded-[4px] bg-alerta/15 px-1.5 py-0.5 text-alerta">
                      sin conciliar
                    </span>
                  ) : b.estado === 'ignorado' ? (
                    'ignorado'
                  ) : (
                    <span className="text-acento">conciliado</span>
                  )}
                </td>
                <td className="t-apoyo">
                  {b.movimiento
                    ? `${formatearCLPConCero(b.movimiento.monto)} · ${b.movimiento.descripcion.slice(0, 40)}`
                    : b.nota || '—'}
                </td>
                <td className="whitespace-nowrap text-right">
                  {b.estado !== 'sin_conciliar' ? (
                    <button
                      type="button"
                      disabled={pendiente}
                      onClick={() => correr(() => devolverABandeja(b.id))}
                      className="text-[11.5px] text-tenue underline underline-offset-2 hover:text-tinta"
                    >
                      Devolver a la bandeja
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="h-8" />
      </div>
    </div>
  )
}

interface PropsGrupo {
  g: GrupoGlosa
  abierto: boolean
  abrir: () => void
  pendiente: boolean
  accion: Accion
  setAccion: (a: Accion) => void
  proveedorId: string
  setProveedorId: (v: string) => void
  categoriaId: string
  setCategoriaId: (v: string) => void
  descripcion: string
  setDescripcion: (v: string) => void
  motivo: string
  setMotivo: (v: string) => void
  modo: 'reemplazar' | 'sumar'
  setModo: (v: 'reemplazar' | 'sumar') => void
  vista: VistaPreviaManual | null
  pedirVista: (categoriaId: string) => void
  manuales: OpcionCategoria[]
  calculadas: OpcionCategoria[]
  proveedores: OpcionProveedor[]
  proveedoresDeCategoria: OpcionProveedor[]
  ejecutar: () => void
  control: string
}

function FilaGrupo(p: PropsGrupo) {
  const { g } = p
  return (
    <>
      <tr className={g.esAbono ? 'bg-realce' : ''}>
        <td>
          {g.glosa}
          {g.esAbono ? (
            <span className="ml-2 rounded bg-realce px-1.5 py-0.5 text-[10.5px] text-acento">
              abono
            </span>
          ) : null}
        </td>
        <td className="monto text-tenue">{g.cargos}</td>
        <td className="t-apoyo">
          {g.meses
            .sort((a, b) => a - b)
            .map((m) => MESES_CORTOS[m - 1])
            .join(' ')}
        </td>
        <td className={'cifra px-3 py-1.5 text-right ' + (g.total < 0 ? 'negativo' : 'text-acento')}>
          {formatearCLPConCero(g.total)}
        </td>
        <td className="text-[11.5px]">
          {g.sugerido ? (
            <span className="text-acento">
              {g.sugerido}
              {g.categoriaSugerida ? <span className="text-tenue"> · {g.categoriaSugerida}</span> : null}
            </span>
          ) : (
            <span className="text-tenue">—</span>
          )}
        </td>
        <td className="text-right">
          <button
            type="button"
            onClick={p.abrir}
            className="text-[11.5px] text-acento underline underline-offset-2"
          >
            {p.abierto ? 'cerrar' : 'resolver'}
          </button>
        </td>
      </tr>

      {p.abierto ? (
        <tr className="bg-realce">
          <td colSpan={6} className="px-3 py-3">
            <div className="mb-2 flex flex-wrap gap-1">
              {(
                [
                  ['proveedor', 'Asignar proveedor'],
                  ['manual', 'Asignar a fila manual'],
                  ['crear', 'Crear movimiento'],
                  ['ignorar', 'Ignorar'],
                ] as [Accion, string][]
              ).map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => p.setAccion(valor)}
                  className={
                    'rounded px-2.5 py-1 text-[11.5px] ' +
                    (p.accion === valor
                      ? 'bg-acento font-medium text-white'
                      : 'border border-linea-fuerte text-tenue hover:text-tinta')
                  }
                >
                  {etiqueta}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              {p.accion === 'proveedor' ? (
                <>
                  <Campo etiqueta="Proveedor">
                    <select
                      className={p.control + ' w-72'}
                      value={p.proveedorId}
                      onChange={(e) => p.setProveedorId(e.target.value)}
                    >
                      <option value="">Elegir…</option>
                      {p.proveedores.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.nombre} · {x.categoriaNombre}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <span className="pb-1.5 text-[11.5px] text-tenue">
                    La glosa se guarda como alias. No crea movimientos: si hay uno del mes con monto
                    parecido, enlaza.
                  </span>
                </>
              ) : null}

              {p.accion === 'manual' ? (
                <>
                  <Campo etiqueta="Fila manual del flujo">
                    <select
                      className={p.control + ' w-72'}
                      value={p.categoriaId}
                      onChange={(e) => {
                        p.setCategoriaId(e.target.value)
                        p.pedirVista(e.target.value)
                      }}
                    >
                      <option value="">Elegir…</option>
                      {p.manuales.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo etiqueta="Qué hacer con lo que ya hay">
                    <select
                      className={p.control + ' w-52'}
                      value={p.modo}
                      onChange={(e) => p.setModo(e.target.value as 'reemplazar' | 'sumar')}
                    >
                      <option value="reemplazar">Reemplazar (el banco manda)</option>
                      <option value="sumar">Sumar a lo que ya está</option>
                    </select>
                  </Campo>
                </>
              ) : null}

              {p.accion === 'crear' ? (
                <>
                  <Campo etiqueta="Categoría">
                    <select
                      className={p.control + ' w-52'}
                      value={p.categoriaId}
                      onChange={(e) => {
                        p.setCategoriaId(e.target.value)
                        p.setProveedorId('')
                      }}
                    >
                      <option value="">Elegir…</option>
                      {p.calculadas.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo etiqueta="Proveedor">
                    <select
                      className={p.control + ' w-52'}
                      value={p.proveedorId}
                      disabled={p.proveedoresDeCategoria.length === 0}
                      onChange={(e) => p.setProveedorId(e.target.value)}
                    >
                      <option value="">Sin proveedor</option>
                      {p.proveedoresDeCategoria.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.nombre}
                        </option>
                      ))}
                    </select>
                  </Campo>
                  <Campo etiqueta="Descripción">
                    <input
                      className={p.control + ' w-64'}
                      placeholder={g.glosa}
                      value={p.descripcion}
                      onChange={(e) => p.setDescripcion(e.target.value)}
                    />
                  </Campo>
                </>
              ) : null}

              {p.accion === 'ignorar' ? (
                <Campo etiqueta="Motivo">
                  <input
                    className={p.control + ' w-96'}
                    placeholder="gasto personal, traspaso interno…"
                    value={p.motivo}
                    onChange={(e) => p.setMotivo(e.target.value)}
                  />
                </Campo>
              ) : null}

              <button
                type="button"
                onClick={p.ejecutar}
                disabled={p.pendiente}
                className="rounded bg-acento px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {p.pendiente ? 'Aplicando…' : `Aplicar a los ${g.cargos} cargos`}
              </button>
            </div>

            {p.accion === 'manual' && p.vista?.ok && p.vista.filas ? (
              <div className="mt-3 rounded border border-linea p-2">
                <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-tenue">
                  Cómo queda la fila "{p.vista.categoria}"
                </div>
                {p.vista.hayValoresPrevios ? (
                  <div className="mb-1.5 text-[11.5px] text-alerta">
                    Esta fila ya trae valores del Excel. Con <strong>sumar</strong> el pago se
                    contaría dos veces; <strong>reemplazar</strong> deja lo que dice el banco.
                  </div>
                ) : null}
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="text-tenue">
                      <th className="px-2 py-0.5 text-left">Mes</th>
                      <th className="px-2 py-0.5 text-right">Hoy</th>
                      <th className="px-2 py-0.5 text-right">Aporte del banco</th>
                      <th className="px-2 py-0.5 text-right">Queda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.vista.filas.map((f) => (
                      <tr key={f.mes}>
                        <td className="px-2 py-0.5">{MESES_CORTOS[f.mes - 1]}</td>
                        <td className="cifra px-2 py-0.5 text-right text-tenue">
                          {formatearCLPConCero(f.actual)}
                        </td>
                        <td className="cifra px-2 py-0.5 text-right">
                          {formatearCLPConCero(f.aporte)}
                        </td>
                        <td className="cifra px-2 py-0.5 text-right font-medium">
                          {formatearCLPConCero(p.modo === 'reemplazar' ? f.reemplazar : f.sumar)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  )
}

function Th({ children, alineacion }: { children: React.ReactNode; alineacion?: 'right' }) {
  return (
    <th
      className={
        'px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-tenue ' +
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
      <span className="text-[10.5px] uppercase tracking-wide text-tenue">{etiqueta}</span>
      {children}
    </label>
  )
}
