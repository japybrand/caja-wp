'use client'

import { Fragment, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { ETIQUETA_ESTADO, ETIQUETA_FUENTE, FUENTES, ESTADOS, MESES, MONEDAS } from '@/lib/dominio'
import { formatearCLPConCero, parsearCLP } from '@/lib/formato'
import { sincronizarAhora, descartarCorreo } from './acciones-sync'
import { RegistroRapido } from './RegistroRapido'
import {
  actualizarMovimiento,
  confirmarMovimiento,
  crearMovimiento,
  eliminarMovimiento,
  type DatosMovimiento,
} from './acciones'

export interface FilaMovimiento {
  id: string
  fecha: string
  mes: number
  montoCLP: number
  monedaOriginal: string
  montoOriginal: number | null
  descripcion: string
  fuente: string
  estado: string
  /** Frase de aviso si el movimiento repite un compromiso ya declarado. */
  duplicaCompromiso: string | null
  categoriaId: string
  categoriaNombre: string
  proveedorId: string | null
  proveedorNombre: string | null
  correo: DatosCorreo | null
}

export interface DatosCorreo {
  gmailId: string
  remitente: string
  asunto: string
  respuestaModelo: string | null
  nota: string | null
  url: string
}

export interface ResumenSync {
  origen: string
  iniciadaEn: string
  terminada: boolean
  correosVistos: number
  creados: number
  porRevisar: number
  sinMonto: number
  errores: number
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
  movimientos: FilaMovimiento[]
  categorias: OpcionCategoria[]
  proveedores: OpcionProveedor[]
  filtros: {
    mes: string
    categoriaId: string
    proveedorId: string
    fuente: string
    estado: string
    texto: string
  }
  totalPorRevisar: number
  anio: number
  ultimaSync: ResumenSync | null
}

const FORMULARIO_VACIO = (anio: number): DatosMovimiento => ({
  fecha: `${anio}-01-01`,
  categoriaId: '',
  proveedorId: null,
  descripcion: '',
  montoCLP: 0,
  monedaOriginal: 'CLP',
  montoOriginal: null,
  estado: 'confirmado',
})

export function TablaMovimientos({
  movimientos,
  categorias,
  proveedores,
  filtros,
  totalPorRevisar,
  anio,
  ultimaSync,
}: Props) {
  const router = useRouter()
  const parametros = useSearchParams()
  const [pendiente, iniciar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<DatosMovimiento | null>(null)
  const [montoTexto, setMontoTexto] = useState('')
  const [confirmandoBorrado, setConfirmandoBorrado] = useState<string | null>(null)
  const [correoAbierto, setCorreoAbierto] = useState<string | null>(null)
  const [avisoSync, setAvisoSync] = useState<string | null>(null)

  // Las filas manuales del flujo no admiten movimientos: se editan en la grilla.
  const categoriasAsignables = useMemo(
    () => categorias.filter((categoria) => !categoria.esManual),
    [categorias],
  )

  const proveedoresDeCategoria = useMemo(() => {
    if (!formulario?.categoriaId) return []
    return proveedores.filter((p) => p.categoriaId === formulario.categoriaId)
  }, [proveedores, formulario?.categoriaId])

  const totalFiltrado = useMemo(
    () => movimientos.reduce((suma, movimiento) => suma + movimiento.montoCLP, 0),
    [movimientos],
  )

  const cambiarFiltro = (clave: string, valor: string): void => {
    const siguientes = new URLSearchParams(parametros.toString())
    if (valor === '') siguientes.delete(clave)
    else siguientes.set(clave, valor)
    router.push(`/movimientos?${siguientes.toString()}`)
  }

  const abrirNuevo = (): void => {
    setEditandoId(null)
    setFormulario(FORMULARIO_VACIO(anio))
    setMontoTexto('')
    setError(null)
  }

  const abrirEdicion = (movimiento: FilaMovimiento): void => {
    setEditandoId(movimiento.id)
    setFormulario({
      fecha: movimiento.fecha,
      categoriaId: movimiento.categoriaId,
      proveedorId: movimiento.proveedorId,
      descripcion: movimiento.descripcion,
      montoCLP: movimiento.montoCLP,
      monedaOriginal: movimiento.monedaOriginal,
      montoOriginal: movimiento.montoOriginal,
      estado: movimiento.estado,
    })
    setMontoTexto(String(movimiento.montoCLP))
    setError(null)
  }

  const cerrar = (): void => {
    setFormulario(null)
    setEditandoId(null)
    setError(null)
  }

  const guardar = (): void => {
    if (!formulario) return
    if (!formulario.categoriaId) {
      setError('Elige una categoría.')
      return
    }
    const monto = parsearCLP(montoTexto)
    if (monto === null) {
      setError(`No entendí el monto "${montoTexto}". Escribe solo números.`)
      return
    }

    const datos: DatosMovimiento = { ...formulario, montoCLP: monto }

    iniciar(async () => {
      const resultado = editandoId
        ? await actualizarMovimiento(editandoId, datos)
        : await crearMovimiento(datos)
      if (!resultado.ok) {
        setError(resultado.error ?? 'No se pudo guardar.')
        return
      }
      cerrar()
      router.refresh()
    })
  }

  const borrar = (id: string): void => {
    iniciar(async () => {
      const resultado = await eliminarMovimiento(id)
      if (!resultado.ok) setError(resultado.error ?? 'No se pudo eliminar.')
      setConfirmandoBorrado(null)
      router.refresh()
    })
  }

  const confirmar = (id: string): void => {
    iniciar(async () => {
      const resultado = await confirmarMovimiento(id)
      if (!resultado.ok) setError(resultado.error ?? 'No se pudo confirmar.')
      router.refresh()
    })
  }

  const sincronizar = (forzarRevision: boolean): void => {
    setError(null)
    setAvisoSync(null)
    iniciar(async () => {
      const resultado = await sincronizarAhora({ dias: 7, forzarRevision })
      if (!resultado.ok) {
        setError(resultado.error ?? 'No se pudo sincronizar.')
        return
      }
      const r = resultado.resumen
      setAvisoSync(
        r
          ? `${r.correosVistos} correos mirados · ${r.yaProcesados} ya vistos antes · ` +
            `${r.creados} movimientos creados (${r.confirmados} confirmados, ${r.porRevisar} por revisar) · ` +
            `${r.sinMonto} sin monto · ${r.errores} con error`
          : 'Sincronización terminada.',
      )
      router.refresh()
    })
  }

  const descartar = (movimientoId: string): void => {
    iniciar(async () => {
      const resultado = await descartarCorreo(movimientoId)
      if (!resultado.ok) setError(resultado.error ?? 'No se pudo descartar.')
      router.refresh()
    })
  }

  const claseSelect =
    'rounded border border-linea-fuerte px-2 py-1 text-[12.5px] outline-none focus:border-acento'

  return (
    <div className="mx-auto max-w-[1120px] px-e5 py-e5">
      <div className="flex items-start justify-between gap-4 border-b border-linea px-4 py-2">
        <div>
          <h1 className="t-pagina">Movimientos {anio}</h1>
          <p className="t-apoyo">
            {movimientos.length.toLocaleString('es-CL')} movimientos ·{' '}
            {formatearCLPConCero(totalFiltrado)} en total
            {totalPorRevisar > 0 ? ` · ${totalPorRevisar} por revisar` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ultimaSync ? (
            <span className="t-apoyo">
              última sincronización{' '}
              {new Date(ultimaSync.iniciadaEn).toLocaleString('es-CL', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
              {' · '}
              {ultimaSync.creados} creados
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => sincronizar(false)}
            disabled={pendiente}
            title="Lee los correos de los últimos 7 días de los remitentes aprobados"
            className="rounded border border-linea-fuerte px-3 py-1.5 text-[12.5px] font-medium hover:bg-panel disabled:opacity-50"
          >
            {pendiente ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          {/* Registro rápido primero: es lo que se usa a diario. "Nuevo movimiento"
              abre el formulario completo y queda para los casos raros. */}
          <RegistroRapido categorias={categorias} proveedores={proveedores} />
          <button
            type="button"
            onClick={abrirNuevo}
            className="rounded border border-linea-fuerte px-3 py-1.5 text-[12.5px] font-medium hover:bg-panel"
          >
            Nuevo movimiento
          </button>
        </div>
      </div>

      {avisoSync ? (
        <div className="flex items-center justify-between border-b border-blue-200 bg-blue-50 px-4 py-1.5 text-[12.5px] text-acento">
          <span>{avisoSync}</span>
          <button type="button" onClick={() => setAvisoSync(null)} className="underline">
            cerrar
          </button>
        </div>
      ) : null}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 border-b border-linea bg-panel px-4 py-2">
        <input
          className={claseSelect + ' w-52'}
          placeholder="Buscar en la descripción…"
          defaultValue={filtros.texto}
          onKeyDown={(evento) => {
            if (evento.key === 'Enter') cambiarFiltro('q', evento.currentTarget.value)
          }}
          onBlur={(evento) => {
            if (evento.currentTarget.value !== filtros.texto) cambiarFiltro('q', evento.currentTarget.value)
          }}
        />
        <select className={claseSelect} value={filtros.mes} onChange={(e) => cambiarFiltro('mes', e.target.value)}>
          <option value="">Todos los meses</option>
          {MESES.map((nombre, indice) => (
            <option key={nombre} value={indice + 1}>
              {nombre}
            </option>
          ))}
        </select>
        <select
          className={claseSelect}
          value={filtros.categoriaId}
          onChange={(e) => cambiarFiltro('categoria', e.target.value)}
        >
          <option value="">Todas las categorías</option>
          {categorias.map((categoria) => (
            <option key={categoria.id} value={categoria.id}>
              {categoria.nombre}
            </option>
          ))}
        </select>
        <select
          className={claseSelect}
          value={filtros.proveedorId}
          onChange={(e) => cambiarFiltro('proveedor', e.target.value)}
        >
          <option value="">Todos los proveedores</option>
          {proveedores.map((proveedor) => (
            <option key={proveedor.id} value={proveedor.id}>
              {proveedor.nombre}
            </option>
          ))}
        </select>
        <select className={claseSelect} value={filtros.fuente} onChange={(e) => cambiarFiltro('fuente', e.target.value)}>
          <option value="">Todas las fuentes</option>
          {FUENTES.map((fuente) => (
            <option key={fuente} value={fuente}>
              {ETIQUETA_FUENTE[fuente]}
            </option>
          ))}
        </select>
        <select className={claseSelect} value={filtros.estado} onChange={(e) => cambiarFiltro('estado', e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS.map((estado) => (
            <option key={estado} value={estado}>
              {ETIQUETA_ESTADO[estado]}
            </option>
          ))}
        </select>
        {Object.values(filtros).some((valor) => valor !== '') ? (
          <button
            type="button"
            onClick={() => router.push('/movimientos')}
            className="text-[12.5px] text-acento underline underline-offset-2"
          >
            Limpiar filtros
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-center justify-between border-b border-negativo/25 bg-negativo/[0.04] px-4 py-1.5 text-[12.5px] text-negativo">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="underline">
            cerrar
          </button>
        </div>
      ) : null}

      {/* Formulario */}
      {formulario ? (
        <div className="border-b border-linea-fuerte bg-realce px-4 py-3">
          <div className="t-tarjeta mb-e3">
            {editandoId ? 'Editar movimiento' : 'Nuevo movimiento'}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Campo etiqueta="Fecha">
              <input
                type="date"
                className={claseSelect}
                value={formulario.fecha}
                onChange={(e) => setFormulario({ ...formulario, fecha: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Categoría">
              <select
                className={claseSelect + ' w-52'}
                value={formulario.categoriaId}
                onChange={(e) =>
                  setFormulario({ ...formulario, categoriaId: e.target.value, proveedorId: null })
                }
              >
                <option value="">Elegir…</option>
                {categoriasAsignables.map((categoria) => (
                  <option key={categoria.id} value={categoria.id}>
                    {categoria.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Proveedor">
              <select
                className={claseSelect + ' w-52'}
                value={formulario.proveedorId ?? ''}
                disabled={proveedoresDeCategoria.length === 0}
                onChange={(e) =>
                  setFormulario({ ...formulario, proveedorId: e.target.value === '' ? null : e.target.value })
                }
              >
                <option value="">Sin proveedor</option>
                {proveedoresDeCategoria.map((proveedor) => (
                  <option key={proveedor.id} value={proveedor.id}>
                    {proveedor.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Descripción">
              <input
                className={claseSelect + ' w-64'}
                value={formulario.descripcion}
                onChange={(e) => setFormulario({ ...formulario, descripcion: e.target.value })}
              />
            </Campo>
            <Campo etiqueta="Monto CLP">
              <input
                className={claseSelect + ' w-32 text-right'}
                value={montoTexto}
                onChange={(e) => setMontoTexto(e.target.value)}
                placeholder="0"
              />
            </Campo>
            <Campo etiqueta="Moneda">
              <select
                className={claseSelect}
                value={formulario.monedaOriginal}
                onChange={(e) =>
                  setFormulario({
                    ...formulario,
                    monedaOriginal: e.target.value,
                    montoOriginal: e.target.value === 'CLP' ? null : formulario.montoOriginal,
                  })
                }
              >
                {MONEDAS.map((moneda) => (
                  <option key={moneda} value={moneda}>
                    {moneda}
                  </option>
                ))}
              </select>
            </Campo>
            {formulario.monedaOriginal !== 'CLP' ? (
              <Campo etiqueta={`Monto ${formulario.monedaOriginal}`}>
                <input
                  type="number"
                  step="0.01"
                  className={claseSelect + ' w-28 text-right'}
                  value={formulario.montoOriginal ?? ''}
                  onChange={(e) =>
                    setFormulario({
                      ...formulario,
                      montoOriginal: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </Campo>
            ) : null}
            <Campo etiqueta="Estado">
              <select
                className={claseSelect}
                value={formulario.estado}
                onChange={(e) => setFormulario({ ...formulario, estado: e.target.value })}
              >
                {ESTADOS.map((estado) => (
                  <option key={estado} value={estado}>
                    {ETIQUETA_ESTADO[estado]}
                  </option>
                ))}
              </select>
            </Campo>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={guardar}
                disabled={pendiente}
                className="rounded bg-acento px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {pendiente ? 'Guardando…' : 'Guardar'}
              </button>
              <button
                type="button"
                onClick={cerrar}
                className="rounded border border-linea-fuerte px-3 py-1.5 text-[12.5px]"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Tabla */}
      <div>
        <table className="tabla tabla-interactiva">
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Categoría</Th>
              <Th>Proveedor</Th>
              <Th>Descripción</Th>
              <Th alineacion="right">Monto</Th>
              <Th>Fuente</Th>
              <Th>Estado</Th>
              <Th alineacion="right">Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {movimientos.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-[12.5px] text-tenue">
                  No hay movimientos con esos filtros.
                </td>
              </tr>
            ) : null}
            {movimientos.map((movimiento) => {
              const porRevisar = movimiento.estado === 'por_revisar'
              const abierto = correoAbierto === movimiento.id
              return (
                <Fragment key={movimiento.id}>
                <tr className={porRevisar ? 'bg-alerta/[0.06]' : 'hover:bg-panel'}>
                  <td className="cifra">{movimiento.fecha}</td>
                  <td>{movimiento.categoriaNombre}</td>
                  <td className="text-tenue">
                    {movimiento.proveedorNombre ?? '—'}
                  </td>
                  <td>
                    {movimiento.descripcion || '—'}
                    {/*
                      El aviso va en la fila y no escondido tras el botón del correo:
                      es la única señal de que confirmar contaría la misma deuda dos
                      veces, y el error que evita no se ve en ningún total.
                    */}
                    {movimiento.fuente === 'declarado' ? (
                      <div className="t-apoyo mt-0.5 !text-alerta">
                        Declarado: el banco todavía no lo muestra
                      </div>
                    ) : null}
                    {movimiento.duplicaCompromiso ? (
                      <div className="mt-1 flex items-start gap-1.5 text-[11.5px] text-negativo">
                        <AlertTriangle size={13} strokeWidth={2} className="mt-px shrink-0" />
                        <span>{movimiento.duplicaCompromiso}</span>
                      </div>
                    ) : null}
                  </td>
                  <td
                    className={
                      'cifra px-3 py-1.5 text-right ' + (movimiento.montoCLP < 0 ? 'negativo' : '')
                    }
                  >
                    {formatearCLPConCero(movimiento.montoCLP)}
                    {movimiento.monedaOriginal !== 'CLP' && movimiento.montoOriginal !== null ? (
                      <span className="ml-1 text-[10.5px] text-tenue">
                        ({movimiento.montoOriginal} {movimiento.monedaOriginal})
                      </span>
                    ) : null}
                  </td>
                  <td className="t-apoyo">
                    {ETIQUETA_FUENTE[movimiento.fuente as keyof typeof ETIQUETA_FUENTE] ??
                      movimiento.fuente}
                  </td>
                  <td>
                    {porRevisar ? (
                      <span className="rounded-[4px] bg-alerta/15 px-1.5 py-0.5 text-[10.5px] font-medium text-alerta">
                        Por revisar
                      </span>
                    ) : (
                      <span className="t-apoyo">Confirmado</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {movimiento.correo ? (
                      <button
                        type="button"
                        onClick={() => setCorreoAbierto(abierto ? null : movimiento.id)}
                        className="mr-2 text-[11.5px] text-tenue underline underline-offset-2 hover:text-tinta"
                      >
                        {abierto ? 'ocultar correo' : 'ver correo'}
                      </button>
                    ) : null}
                    {porRevisar ? (
                      <button
                        type="button"
                        onClick={() => confirmar(movimiento.id)}
                        className="mr-2 text-[11.5px] text-acento underline underline-offset-2"
                      >
                        Confirmar
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => abrirEdicion(movimiento)}
                      className="mr-2 text-[11.5px] text-acento underline underline-offset-2"
                    >
                      Editar
                    </button>
                    {confirmandoBorrado === movimiento.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => borrar(movimiento.id)}
                          className="mr-1 text-[11.5px] font-medium text-negativo underline underline-offset-2"
                        >
                          Confirmar borrado
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmandoBorrado(null)}
                          className="text-[11.5px] text-tenue underline underline-offset-2"
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmandoBorrado(movimiento.id)}
                        className="text-[11.5px] text-tenue underline underline-offset-2 hover:text-negativo"
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>

                {abierto && movimiento.correo ? (
                  <tr className="bg-panel">
                    <td colSpan={8} className="px-3 py-2">
                      <div className="grid gap-2 text-[11.5px] md:grid-cols-[minmax(0,1fr)_360px]">
                        <div>
                          <Dato etiqueta="Asunto">{movimiento.correo.asunto || '(sin asunto)'}</Dato>
                          <Dato etiqueta="Remitente">{movimiento.correo.remitente}</Dato>
                          {movimiento.correo.nota ? (
                            <Dato etiqueta="Notas">
                              <span className="text-alerta">{movimiento.correo.nota}</span>
                            </Dato>
                          ) : null}
                          <div className="mt-1.5 flex gap-3">
                            <a
                              href={movimiento.correo.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-acento underline underline-offset-2"
                            >
                              Abrir en Gmail ↗
                            </a>
                            <button
                              type="button"
                              onClick={() => abrirEdicion(movimiento)}
                              className="text-acento underline underline-offset-2"
                            >
                              Editar y confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => descartar(movimiento.id)}
                              disabled={pendiente}
                              title="Borra el movimiento y marca el correo como ignorado"
                              className="text-tenue underline underline-offset-2 hover:text-negativo disabled:opacity-50"
                            >
                              Descartar
                            </button>
                          </div>
                        </div>
                        <div>
                          <div className="mb-1 text-[10.5px] uppercase tracking-wide text-tenue">
                            Respuesta del modelo
                          </div>
                          <pre className="cifra max-h-48 overflow-auto whitespace-pre-wrap rounded border border-linea p-2 text-[10.5px] leading-relaxed">
                            {formatearJson(movimiento.correo.respuestaModelo)}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              )
            })}
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
        'px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-tenue ' +
        (alineacion === 'right' ? 'text-right' : 'text-left')
      }
    >
      {children}
    </th>
  )
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-[10.5px] uppercase tracking-wide text-tenue">
        {etiqueta}
      </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

/** El JSON del modelo se guarda compacto; aquí se indenta para poder leerlo. */
function formatearJson(crudo: string | null): string {
  if (!crudo) return '(sin respuesta guardada)'
  try {
    return JSON.stringify(JSON.parse(crudo), null, 2)
  } catch {
    return crudo
  }
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-wide text-tenue">{etiqueta}</span>
      {children}
    </label>
  )
}
