'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MESES, MESES_CORTOS } from '@/lib/dominio'
import { cargarArchivo, type ResultadoCarga, type TipoFuente, type EstadoMes } from './acciones'

interface Props {
  anio: number
  estado: EstadoMes[]
  hoy: { dia: number; mes: number; anio: number }
}

const ZONAS: { tipo: TipoFuente; titulo: string; pista: string; acepta: string }[] = [
  {
    tipo: 'cartola',
    titulo: 'Cartola de Santander',
    pista: 'CartolaHistCtaCte….xlsx o CartolaProvisoria….xlsx',
    acepta: '.xlsx,.xls',
  },
  {
    tipo: 'ventas',
    titulo: 'Ventas del SII',
    pista: 'RCV_VENTA_76513765-9_AAAAMM.csv',
    acepta: '.csv',
  },
  {
    tipo: 'compras',
    titulo: 'Compras del SII',
    pista: 'RCV_COMPRA_REGISTRO_…_AAAAMM.csv · es el crédito fiscal del IVA',
    acepta: '.csv',
  },
  {
    tipo: 'global66',
    titulo: 'Movimientos de Global66',
    pista: 'movements-MM-AAAA_MM-AAAA.xls · se reconoce por su contenido',
    acepta: '.xls,.xlsx',
  },
]

/** El mes anterior al de hoy, que es el que debería estar cargado. */
function mesAnterior(mes: number): number {
  return mes === 1 ? 12 : mes - 1
}

export function PanelCargar({ anio, estado, hoy }: Props) {
  const router = useRouter()
  const [pendiente, iniciar] = useTransition()
  const [encima, setEncima] = useState<TipoFuente | null>(null)
  const [resultados, setResultados] = useState<ResultadoCarga[]>([])

  /**
   * Aviso después del día 10: si ya pasó ese día y falta la cartola o las ventas
   * del mes anterior, hay que ir a buscarlas. Antes del 10 todavía es normal que
   * no estén.
   */
  const faltantes = useMemo(() => {
    if (hoy.dia <= 10 || hoy.anio !== anio) return []
    const objetivo = mesAnterior(hoy.mes)
    // En enero el mes anterior es de otro año: no se avisa.
    if (hoy.mes === 1) return []
    const e = estado.find((x) => x.mes === objetivo)
    if (!e) return []
    const falta: string[] = []
    if (!e.cartola) falta.push('la cartola de Santander')
    if (!e.ventas) falta.push('el registro de ventas del SII')
    if (!e.global66) falta.push('los movimientos de Global66')
    return falta.length > 0 ? [{ mes: objetivo, falta }] : []
  }, [estado, hoy, anio])

  const procesar = useCallback(
    (tipo: TipoFuente, archivos: FileList | File[]): void => {
      const lista = Array.from(archivos)
      if (lista.length === 0) return
      iniciar(async () => {
        const nuevos: ResultadoCarga[] = []
        for (const archivo of lista) {
          const buffer = await archivo.arrayBuffer()
          let binario = ''
          const bytes = new Uint8Array(buffer)
          for (let i = 0; i < bytes.length; i += 8192) {
            binario += String.fromCharCode(...bytes.subarray(i, i + 8192))
          }
          nuevos.push(await cargarArchivo(archivo.name, btoa(binario), tipo))
        }
        setResultados((previos) => [...nuevos, ...previos])
        router.refresh()
      })
    },
    [router],
  )

  return (
    <div className="flex h-[calc(100vh-41px)] flex-col">
      <div className="border-b border-linea px-4 py-2">
        <h1 className="text-[14px] font-semibold tracking-tight">Cargar archivos {anio}</h1>
        <p className="text-[11px] text-tenue">
          Arrastra los archivos a su zona. El mes se detecta solo: la cartola por las fechas de sus
          movimientos, los del SII por el nombre del archivo.
        </p>
      </div>

      {faltantes.length > 0 ? (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-[12px] text-amber-900">
          <span className="font-medium">Falta cargar {MESES[faltantes[0]!.mes - 1]}.</span> Ya es{' '}
          {hoy.dia} y todavía no está {faltantes[0]!.falta.join(' ni ')}. Sin eso,{' '}
          {MESES[faltantes[0]!.mes - 1]} sigue mostrándose como mes proyectado en el flujo.
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {/* --------------------------------------------------------- zonas */}
        <div className="grid gap-3 md:grid-cols-3">
          {ZONAS.map((z) => (
            <div
              key={z.tipo}
              onDragOver={(e) => {
                e.preventDefault()
                setEncima(z.tipo)
              }}
              onDragLeave={() => setEncima(null)}
              onDrop={(e) => {
                e.preventDefault()
                setEncima(null)
                procesar(z.tipo, e.dataTransfer.files)
              }}
              className={
                'rounded border-2 border-dashed p-4 text-center transition-colors ' +
                (encima === z.tipo
                  ? 'border-acento bg-realce'
                  : 'border-linea-fuerte bg-panel hover:border-acento')
              }
            >
              <div className="text-[12px] font-semibold">{z.titulo}</div>
              <div className="mt-1 text-[10px] text-tenue">{z.pista}</div>
              <label className="mt-3 inline-block cursor-pointer rounded border border-linea-fuerte bg-white px-3 py-1 text-[11px] hover:bg-panel">
                Elegir archivo
                <input
                  type="file"
                  multiple
                  accept={z.acepta}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) procesar(z.tipo, e.target.files)
                    e.target.value = ''
                  }}
                />
              </label>
              <div className="mt-2 text-[10px] text-tenue">o arrastra aquí</div>
            </div>
          ))}
        </div>

        {pendiente ? (
          <p className="mt-3 text-[12px] text-acento">Procesando…</p>
        ) : null}

        {/* ---------------------------------------------------- resultados */}
        {resultados.length > 0 ? (
          <>
            <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-tenue">
              Qué cambió
            </h2>
            <div className="space-y-2">
              {resultados.map((r, i) => (
                <div
                  key={`${r.archivo}-${i}`}
                  className={
                    'rounded border px-3 py-2 text-[12px] ' +
                    (r.ok ? 'border-linea bg-white' : 'border-red-200 bg-red-50')
                  }
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-medium">{r.archivo}</span>
                    {r.periodo ? <span className="text-tenue">· {r.periodo}</span> : null}
                    {!r.ok ? <span className="text-negativo">· no se cargó</span> : null}
                  </div>
                  {r.error ? <div className="mt-1 text-negativo">{r.error}</div> : null}
                  {r.cambios ? (
                    <ul className="mt-1 space-y-0.5 text-tenue">
                      {r.cambios.map((c, j) => (
                        <li key={j}>· {c}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                onClick={() => setResultados([])}
                className="text-[11px] text-tenue underline underline-offset-2"
              >
                Limpiar
              </button>
            </div>
          </>
        ) : null}

        {/* -------------------------------------------------- estado por mes */}
        <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-tenue">
          Estado de carga por mes
        </h2>
        <table className="tabla-flujo w-full max-w-2xl">
          <thead>
            <tr>
              <Th>Mes</Th>
              <Th>Cartola</Th>
              <Th alineacion="right">Movimientos</Th>
              <Th>Ventas SII</Th>
              <Th alineacion="right">Documentos</Th>
              <Th>Global66</Th>
              <Th>En el flujo</Th>
            </tr>
          </thead>
          <tbody>
            {estado.map((e) => (
              <tr key={e.mes} className="bg-white">
                <td className="px-3 py-1.5">{MESES[e.mes - 1]}</td>
                <td className="px-3 py-1.5">
                  {e.cartola ? (
                    <span className="text-acento">✓ cargada</span>
                  ) : (
                    <span className="text-tenue">—</span>
                  )}
                </td>
                <td className="cifra px-3 py-1.5 text-right text-tenue">
                  {e.movimientosBanco || '—'}
                </td>
                <td className="px-3 py-1.5">
                  {e.ventas ? (
                    <span className="text-acento">✓ cargadas</span>
                  ) : (
                    <span className="text-tenue">—</span>
                  )}
                </td>
                <td className="cifra px-3 py-1.5 text-right text-tenue">
                  {e.documentosVenta || '—'}
                </td>
                <td className="px-3 py-1.5">
                  {e.global66 ? (
                    <span className="text-acento">
                      ✓ <span className="cifra text-tenue">{e.movimientosGlobal66}</span>
                    </span>
                  ) : (
                    <span className="text-tenue">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-[11px]">
                  {e.cartola ? (
                    <span className="text-tenue">real</span>
                  ) : (
                    <span className="text-amber-700">proyectado</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 max-w-2xl text-[11px] text-tenue">
          Un mes con cartola es un <span className="font-medium">mes real</span>: sus montos son lo
          que pasó por la cuenta. Sin cartola, el flujo lo muestra como{' '}
          <span className="text-amber-700">proyectado</span>.
        </p>
        <p className="mt-1 max-w-2xl text-[11px] text-tenue">
          El export de Global66 se reconoce por el contenido de la hoja y no por el nombre: se
          llama <span className="cifra">movements-…</span>, no dice qué es, y viene con extensión
          .xls aunque por dentro sea xlsx, así que por nombre se confundiría con una cartola.
        </p>
        <p className="mt-2 max-w-2xl text-[11px] text-tenue">
          El registro de compras es el crédito fiscal: con él, el IVA a pagar se calcula en vez
          de estimarse. La fila "Pago de impuestos IVA" del flujo sale de ahí. La zona acepta el archivo y avisa.
        </p>

        <div className="h-8" />
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
