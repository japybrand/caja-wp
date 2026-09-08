'use client'

import { useCallback, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Flujo, FilaFlujo } from '@/lib/flujo'
import { MESES_CORTOS, NUMEROS_MES } from '@/lib/dominio'
import { formatearCLP, formatearCLPConCero, parsearCLP } from '@/lib/formato'
import { guardarValorManual } from './acciones'

interface Props {
  flujo: Flujo
  mesActual: number | null
}

export function GrillaFlujo({ flujo, mesActual }: Props) {
  const router = useRouter()
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set())
  const [editando, setEditando] = useState<{ fila: string; mes: number } | null>(null)
  const [borrador, setBorrador] = useState('')
  const [guardando, iniciarGuardado] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Enter y el blur pueden llegar los dos por la misma edicion: se confirma una sola vez.
  const yaConfirmado = useRef(false)

  const alternar = useCallback((clave: string) => {
    setExpandidas((previas) => {
      const siguiente = new Set(previas)
      if (siguiente.has(clave)) siguiente.delete(clave)
      else siguiente.add(clave)
      return siguiente
    })
  }, [])

  const empezarEdicion = useCallback((fila: FilaFlujo, mes: number) => {
    if (fila.tipo !== 'manual' && !(fila.tipo === 'saldo' && mes === 1)) return
    if (!fila.categoriaId) return
    // Un mes que viene del SII no se edita: el valor lo manda el Registro de Ventas.
    if (fila.origenPorMes?.[mes - 1] === 'sii') return
    const actual = fila.montos[mes - 1] ?? 0
    yaConfirmado.current = false
    setEditando({ fila: fila.clave, mes })
    setBorrador(actual === 0 ? '' : String(actual))
    setError(null)
  }, [])

  const cancelarEdicion = useCallback(() => {
    yaConfirmado.current = true
    setEditando(null)
  }, [])

  const confirmarEdicion = useCallback(
    (fila: FilaFlujo, mes: number) => {
      if (yaConfirmado.current) return
      yaConfirmado.current = true

      const categoriaId = fila.categoriaId
      setEditando(null)
      if (!categoriaId) return

      const monto = parsearCLP(borrador)
      if (monto === null) {
        setError(`No entendí "${borrador}". Escribe solo números, por ejemplo 1.234.567.`)
        return
      }
      if (monto === (fila.montos[mes - 1] ?? 0)) return

      iniciarGuardado(async () => {
        const resultado = await guardarValorManual(categoriaId, mes, flujo.anio, monto)
        if (!resultado.ok) setError(resultado.error ?? 'No se pudo guardar.')
        else {
          setError(null)
          router.refresh()
        }
      })
    },
    [borrador, flujo.anio, router],
  )

  const anchoTotal = useMemo(() => 260 + 12 * 96 + 104, [])
  const proyectadoPorMes = useMemo(
    () => flujo.naturalezaPorMes.map((n) => n === 'proyectado'),
    [flujo.naturalezaPorMes],
  )
  const mesesReales = proyectadoPorMes.filter((p) => !p).length

  return (
    <div className="flex h-[calc(100vh-41px)] flex-col">
      <div className="flex items-center justify-between border-b border-linea px-4 py-2">
        <div>
          <h1 className="text-[14px] font-semibold tracking-tight">Flujo de caja {flujo.anio}</h1>
          <p className="text-[11px] text-tenue">
            Las filas en gris claro se editan: haz clic en la celda y sal para guardar. Los
            subtotales con ▸ se despliegan por proveedor. Las celdas marcadas{' '}
            <span className="text-acento">SII</span> traen facturación real del
            Registro de Ventas y no se editan. Los meses{' '}
            <span className="text-amber-700">proy.</span> no tienen cartola: sus montos son
            proyección, no hechos. Las celdas con{' '}
            <span className="text-negativo">−rev</span> incluyen una reversa del banco.
          </p>
        </div>
        <div className="text-right text-[11px] text-tenue">
          <a href="/flujo?horizonte=1" className="text-acento underline underline-offset-2">
            Ver proyección hasta 2028
          </a>
          <div className="mt-1">{guardando ? 'Guardando…' : 'Montos en pesos chilenos'}</div>
          <div className="mt-0.5">
            {mesesReales} meses reales · {12 - mesesReales} proyectados
          </div>
          {flujo.hayPendientes ? (
            <div className="mt-0.5 text-amber-800">
              Hay movimientos por revisar. No entran en el flujo hasta que los confirmes.
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-[12px] text-negativo">
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="tabla-flujo" style={{ minWidth: anchoTotal }}>
          <thead>
            <tr>
              <th className="col-fija px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-tenue" style={{ minWidth: 260 }}>
                Concepto
              </th>
              {NUMEROS_MES.map((mes) => {
                const proyectado = flujo.naturalezaPorMes[mes - 1] === 'proyectado'
                return (
                  <th
                    key={mes}
                    className={
                      'px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide ' +
                      (mes === mesActual ? 'mes-actual text-acento ' : 'text-tenue ') +
                      (proyectado ? 'mes-proyectado' : '')
                    }
                    style={{ minWidth: 96 }}
                    title={
                      proyectado
                        ? 'Mes proyectado: no hay cartola bancaria, los montos vienen de la proyección anual.'
                        : 'Mes real: los montos son los que pasaron por la cuenta.'
                    }
                  >
                    {MESES_CORTOS[mes - 1]}
                    <div
                      className={
                        'text-[9px] font-normal tracking-wide ' +
                        (proyectado ? 'text-amber-700' : 'text-tenue')
                      }
                    >
                      {proyectado ? 'proy.' : 'real'}
                    </div>
                  </th>
                )
              })}
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-tenue" style={{ minWidth: 104 }}>
                Año
              </th>
            </tr>
          </thead>
          <tbody>
            {flujo.filas.map((fila) => (
              <FilaTabla
                key={fila.clave}
                fila={fila}
                mesActual={mesActual}
                expandida={expandidas.has(fila.clave)}
                alternar={alternar}
                proyectadoPorMes={proyectadoPorMes}
                editando={editando?.fila === fila.clave ? editando.mes : null}
                borrador={borrador}
                setBorrador={setBorrador}
                empezarEdicion={empezarEdicion}
                confirmarEdicion={confirmarEdicion}
                cancelarEdicion={cancelarEdicion}
              />
            ))}

            {flujo.hayPendientes ? (
              <tr className="bg-amber-50 text-amber-900">
                <td className="col-fija bg-amber-50 px-3 py-1.5 text-[12px] font-medium">
                  Pendiente de revisión
                  <span className="ml-1 font-normal text-[11px]">(no incluido arriba)</span>
                </td>
                {NUMEROS_MES.map((mes) => {
                  const monto = flujo.pendientePorMes[mes - 1] ?? 0
                  return (
                    <td
                      key={mes}
                      className={
                        (mes === mesActual ? 'mes-actual ' : '') +
                        (proyectadoPorMes[mes - 1] ? 'mes-proyectado ' : '') +
                        'cifra px-3 py-1.5 text-right'
                      }
                    >
                      {monto === 0 ? '—' : formatearCLP(monto)}
                    </td>
                  )
                })}
                <td className="cifra border-l border-linea px-3 py-1.5 text-right">
                  {formatearCLP(flujo.pendientePorMes.reduce((a, b) => a + b, 0))}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface PropsFila {
  fila: FilaFlujo
  mesActual: number | null
  /** Qué meses son proyección, para marcarlos en cada celda. */
  proyectadoPorMes: boolean[]
  expandida: boolean
  alternar: (clave: string) => void
  editando: number | null
  borrador: string
  setBorrador: (valor: string) => void
  empezarEdicion: (fila: FilaFlujo, mes: number) => void
  confirmarEdicion: (fila: FilaFlujo, mes: number) => void
  cancelarEdicion: () => void
}

const CLASES_FILA: Record<string, string> = {
  encabezado: 'fila-encabezado bg-panel',
  saldo: 'bg-white',
  manual: 'bg-white',
  derivada: 'bg-white',
  subtotal: 'fila-subtotal bg-panel font-semibold',
  resultado: 'fila-resultado bg-[#f3f4f6] font-semibold',
}

function FilaTabla({
  fila,
  mesActual,
  proyectadoPorMes,
  expandida,
  alternar,
  editando,
  borrador,
  setBorrador,
  empezarEdicion,
  confirmarEdicion,
  cancelarEdicion,
}: PropsFila) {
  const esExpandible = fila.tipo === 'derivada' && (fila.detalle?.length ?? 0) > 0
  const claseFila = CLASES_FILA[fila.tipo] ?? 'bg-white'

  if (fila.tipo === 'encabezado') {
    return (
      <tr className={claseFila}>
        <td
          className="col-fija px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-tenue"
          colSpan={1}
        >
          {fila.etiqueta}
        </td>
        {NUMEROS_MES.map((mes) => (
          <td
            key={mes}
            className={
              (mes === mesActual ? 'mes-actual ' : '') +
              (proyectadoPorMes[mes - 1] ? 'mes-proyectado' : '')
            }
          />
        ))}
        <td />
      </tr>
    )
  }

  return (
    <>
      <tr className={claseFila}>
        <td className="col-fija px-3 py-1.5">
          {esExpandible ? (
            <button
              type="button"
              onClick={() => alternar(fila.clave)}
              className="flex w-full items-center gap-1.5 text-left hover:text-acento"
              aria-expanded={expandida}
            >
              <span className="w-3 shrink-0 text-[10px] text-tenue">
                {expandida ? '▾' : '▸'}
              </span>
              <span>{fila.etiqueta}</span>
              <span className="text-[10px] text-tenue">({fila.detalle?.length})</span>
            </button>
          ) : (
            <span className={fila.tipo === 'subtotal' || fila.tipo === 'resultado' ? '' : 'pl-[18px]'}>
              {fila.etiqueta}
            </span>
          )}
        </td>

        {NUMEROS_MES.map((mes) => {
          const monto = fila.montos[mes - 1] ?? 0
          const desdeSII = fila.origenPorMes?.[mes - 1] === 'sii'
          const editable =
            (fila.tipo === 'manual' || (fila.tipo === 'saldo' && mes === 1)) &&
            Boolean(fila.categoriaId) &&
            !desdeSII
          const claseMes =
            (mes === mesActual ? 'mes-actual ' : '') +
            (proyectadoPorMes[mes - 1] ? 'mes-proyectado ' : '')

          if (editando === mes) {
            return (
              <td key={mes} className={claseMes + 'px-1 py-0.5'}>
                <input
                  className="celda-input"
                  autoFocus
                  value={borrador}
                  onChange={(evento) => setBorrador(evento.target.value)}
                  onBlur={() => confirmarEdicion(fila, mes)}
                  onKeyDown={(evento) => {
                    if (evento.key === 'Enter') {
                      evento.preventDefault()
                      confirmarEdicion(fila, mes)
                    }
                    if (evento.key === 'Escape') {
                      evento.preventDefault()
                      cancelarEdicion()
                    }
                  }}
                />
              </td>
            )
          }

          return (
            <td
              key={mes}
              className={
                claseMes +
                'cifra px-3 py-1.5 text-right ' +
                (monto < 0 ? 'negativo ' : '') +
                (editable ? 'celda-editable' : '')
              }
              tabIndex={editable ? 0 : undefined}
              onClick={editable ? () => empezarEdicion(fila, mes) : undefined}
              onKeyDown={
                editable
                  ? (evento) => {
                      if (evento.key === 'Enter') empezarEdicion(fila, mes)
                    }
                  : undefined
              }
              title={
                desdeSII
                  ? 'Facturación real del Registro de Ventas del SII. No se edita a mano.'
                  : editable
                    ? 'Clic para editar'
                    : undefined
              }
            >
              {fila.tipo === 'subtotal' || fila.tipo === 'resultado' || fila.tipo === 'saldo'
                ? formatearCLPConCero(monto)
                : formatearCLP(monto)}
              {desdeSII ? (
                <div className="text-[9px] uppercase tracking-wide text-acento">SII</div>
              ) : null}
              {(fila.reversasPorMes?.[mes - 1] ?? 0) !== 0 ? (
                <div
                  className="text-[9px] uppercase tracking-wide text-negativo"
                  title={`Incluye una reversa de ${formatearCLP(fila.reversasPorMes?.[mes - 1] ?? 0)}: un abono del banco que resta de esta fila de egreso.`}
                >
                  −rev {formatearCLP(fila.reversasPorMes?.[mes - 1] ?? 0)}
                </div>
              ) : null}
              {(fila.pendientes[mes - 1] ?? 0) !== 0 ? (
                <div
                  className="text-[10px] text-amber-700"
                  title="Por revisar: no está sumado en el flujo"
                >
                  +{formatearCLP(fila.pendientes[mes - 1] ?? 0)}
                </div>
              ) : null}
            </td>
          )
        })}

        <td
          className={
            'cifra border-l border-linea px-3 py-1.5 text-right ' +
            (fila.total < 0 ? 'negativo' : '')
          }
        >
          {fila.tipo === 'saldo' ? '' : formatearCLPConCero(fila.total)}
          {fila.totalPendiente !== 0 ? (
            <div className="text-[10px] text-amber-700">+{formatearCLP(fila.totalPendiente)}</div>
          ) : null}
        </td>
      </tr>

      {expandida
        ? fila.detalle?.map((linea) => (
            <tr key={linea.clave} className="bg-[#fcfcfd] text-tenue">
              <td className="col-fija py-1 pl-9 pr-3 text-[12px]">{linea.nombre}</td>
              {NUMEROS_MES.map((mes) => {
                const monto = linea.montos[mes - 1] ?? 0
                return (
                  <td
                    key={mes}
                    className={
                      (mes === mesActual ? 'mes-actual ' : '') +
                      'cifra px-3 py-1 text-right ' +
                      (monto < 0 ? 'negativo' : '')
                    }
                  >
                    {formatearCLP(monto)}
                  </td>
                )
              })}
              <td className="cifra border-l border-linea px-3 py-1 text-right">
                {formatearCLP(linea.total)}
              </td>
            </tr>
          ))
        : null}
    </>
  )
}
