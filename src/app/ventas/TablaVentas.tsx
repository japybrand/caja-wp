'use client'

import { useMemo, useState } from 'react'
import { MESES, MESES_CORTOS } from '@/lib/dominio'
import { formatearCLP, formatearCLPConCero } from '@/lib/formato'

export interface MesVentas {
  mes: number
  documentos: number
  notasCredito: number
  exento: number
  neto: number
  iva: number
  total: number
  planilla: number
  desdeSII: boolean
}

export interface ClienteVentas {
  rut: string
  razonSocial: string
  documentos: number
  total: number
  neto: number
  iva: number
  porcentaje: number
}

export interface NotaVentas {
  mes: number
  folio: string
  fecha: string
  razonSocial: string
  montoTotal: number
  tipoReferencia: number | null
  folioReferencia: string | null
  referenciaMes: number | null
  referenciaMonto: number | null
  mismoMonto: boolean
}

interface Props {
  anio: number
  meses: MesVentas[]
  ranking: ClienteVentas[]
  notas: NotaVentas[]
  totalAnio: number
  totalDocumentos: number
}

export function TablaVentas({ anio, meses, ranking, notas, totalAnio, totalDocumentos }: Props) {
  const [verTodos, setVerTodos] = useState(false)

  const conDatos = useMemo(() => meses.filter((m) => m.documentos > 0), [meses])
  const sinDatos = useMemo(() => meses.filter((m) => m.documentos === 0 && m.planilla > 0), [meses])

  const totalIVA = conDatos.reduce((a, m) => a + m.iva, 0)
  const totalNeto = conDatos.reduce((a, m) => a + m.neto, 0)
  const totalExento = conDatos.reduce((a, m) => a + m.exento, 0)
  const diferenciaPlanilla = conDatos.reduce((a, m) => a + (m.total - m.planilla), 0)

  const visibles = verTodos ? ranking : ranking.slice(0, 10)
  // Concentración: cuánto pesan los tres primeros clientes.
  const top3 = ranking.slice(0, 3).reduce((a, c) => a + c.porcentaje, 0)

  return (
    <div className="flex h-[calc(100vh-41px)] flex-col">
      <div className="border-b border-linea px-4 py-2">
        <h1 className="text-[14px] font-semibold tracking-tight">Ventas {anio}</h1>
        <p className="text-[11px] text-tenue">
          Registro de Ventas del SII · {totalDocumentos} documentos ·{' '}
          {formatearCLPConCero(totalAnio)} facturado · {formatearCLPConCero(totalIVA)} de IVA
          débito · {ranking.length} clientes
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {/* ---------------------------------------------------------- por mes */}
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-tenue">
          Detalle por mes
        </h2>
        <table className="tabla-flujo w-full max-w-4xl">
          <thead>
            <tr>
              <Th>Mes</Th>
              <Th alineacion="right">Docs</Th>
              <Th alineacion="right">Notas cr.</Th>
              <Th alineacion="right">Exento</Th>
              <Th alineacion="right">Neto</Th>
              <Th alineacion="right">IVA débito</Th>
              <Th alineacion="right">Total facturado</Th>
              <Th alineacion="right">vs planilla</Th>
            </tr>
          </thead>
          <tbody>
            {conDatos.map((m) => {
              const dif = m.total - m.planilla
              return (
                <tr key={m.mes} className="bg-white hover:bg-panel">
                  <td className="px-3 py-1.5">{MESES[m.mes - 1]}</td>
                  <td className="cifra px-3 py-1.5 text-right text-tenue">
                    {m.documentos}
                  </td>
                  <td className="cifra px-3 py-1.5 text-right text-tenue">
                    {m.notasCredito === 0 ? '—' : m.notasCredito}
                  </td>
                  <td className="cifra px-3 py-1.5 text-right">{formatearCLP(m.exento)}</td>
                  <td className="cifra px-3 py-1.5 text-right">{formatearCLP(m.neto)}</td>
                  <td className="cifra px-3 py-1.5 text-right">{formatearCLP(m.iva)}</td>
                  <td className="cifra px-3 py-1.5 text-right font-medium">
                    {formatearCLPConCero(m.total)}
                  </td>
                  <td
                    className={
                      'cifra px-3 py-1.5 text-right ' +
                      (dif < 0 ? 'negativo' : dif > 0 ? 'text-acento' : 'text-tenue')
                    }
                  >
                    {dif === 0 ? '—' : formatearCLPConCero(dif)}
                  </td>
                </tr>
              )
            })}
            <tr className="bg-panel font-semibold">
              <td className="px-3 py-1.5">Total</td>
              <td className="cifra px-3 py-1.5 text-right">{totalDocumentos}</td>
              <td className="cifra px-3 py-1.5 text-right">{notas.length}</td>
              <td className="cifra px-3 py-1.5 text-right">{formatearCLPConCero(totalExento)}</td>
              <td className="cifra px-3 py-1.5 text-right">{formatearCLPConCero(totalNeto)}</td>
              <td className="cifra px-3 py-1.5 text-right">{formatearCLPConCero(totalIVA)}</td>
              <td className="cifra px-3 py-1.5 text-right">{formatearCLPConCero(totalAnio)}</td>
              <td
                className={
                  'cifra px-3 py-1.5 text-right ' + (diferenciaPlanilla < 0 ? 'negativo' : '')
                }
              >
                {formatearCLPConCero(diferenciaPlanilla)}
              </td>
            </tr>
          </tbody>
        </table>

        {sinDatos.length > 0 ? (
          <p className="mt-2 max-w-4xl text-[11px] text-tenue">
            Sin documentos del SII:{' '}
            <span className="font-medium">
              {sinDatos.map((m) => MESES_CORTOS[m.mes - 1]).join(' · ')}
            </span>
            . Esos meses siguen tomando el valor proyectado de la planilla en el flujo.
          </p>
        ) : null}
        <p className="mt-1 max-w-4xl text-[11px] text-tenue">
          Las diferencias chicas contra la planilla son comprobantes de pago electrónico
          (tipo 48), que el SII entrega como resumen mensual y no vienen en el detalle.
        </p>

        {/* --------------------------------------------------- notas de crédito */}
        {notas.length > 0 ? (
          <>
            <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-tenue">
              Notas de crédito y el documento que anulan
            </h2>
            <table className="tabla-flujo w-full max-w-4xl">
              <thead>
                <tr>
                  <Th>Mes</Th>
                  <Th>Folio</Th>
                  <Th>Fecha</Th>
                  <Th>Cliente</Th>
                  <Th alineacion="right">Monto</Th>
                  <Th>Anula</Th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => {
                  const cruzada = n.referenciaMes !== null && n.referenciaMes !== n.mes
                  return (
                    <tr key={n.folio} className={cruzada ? 'bg-amber-50' : 'bg-white'}>
                      <td className="px-3 py-1.5">{MESES_CORTOS[n.mes - 1]}</td>
                      <td className="cifra px-3 py-1.5">{n.folio}</td>
                      <td className="cifra px-3 py-1.5 text-tenue">{n.fecha}</td>
                      <td className="px-3 py-1.5">{n.razonSocial}</td>
                      <td className="cifra negativo px-3 py-1.5 text-right">
                        {formatearCLPConCero(-n.montoTotal)}
                      </td>
                      <td className="px-3 py-1.5 text-[11px]">
                        {n.tipoReferencia ? (
                          <>
                            tipo {n.tipoReferencia} folio {n.folioReferencia}
                            {n.referenciaMes !== null ? (
                              <span className={cruzada ? 'ml-1 font-medium text-amber-800' : 'ml-1 text-tenue'}>
                                · emitida en {MESES_CORTOS[n.referenciaMes - 1]}
                                {n.mismoMonto ? ', la anula entera' : ', anulación parcial'}
                                {cruzada ? ' — corrige otro mes' : ''}
                              </span>
                            ) : (
                              <span className="ml-1 text-tenue">
                                · el documento no está entre los cargados
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-tenue">sin referencia</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        ) : null}

        {/* -------------------------------------------------------- clientes */}
        <div className="mb-2 mt-6 flex items-baseline gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-tenue">
            Clientes del año
          </h2>
          <span className="text-[11px] text-tenue">
            Los tres primeros concentran <span className="font-medium">{top3.toFixed(1)}%</span> de
            la facturación
          </span>
        </div>
        <table className="tabla-flujo w-full max-w-4xl">
          <thead>
            <tr>
              <Th alineacion="right">#</Th>
              <Th>RUT</Th>
              <Th>Razón social</Th>
              <Th alineacion="right">Docs</Th>
              <Th alineacion="right">Neto</Th>
              <Th alineacion="right">Total</Th>
              <Th alineacion="right">% del año</Th>
              <Th>Participación</Th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c, i) => (
              <tr key={c.rut} className="bg-white hover:bg-panel">
                <td className="cifra px-3 py-1.5 text-right text-tenue">{i + 1}</td>
                <td className="cifra px-3 py-1.5">{c.rut}</td>
                <td className="px-3 py-1.5">{c.razonSocial}</td>
                <td className="cifra px-3 py-1.5 text-right text-tenue">{c.documentos}</td>
                <td className="cifra px-3 py-1.5 text-right">{formatearCLP(c.neto)}</td>
                <td className="cifra px-3 py-1.5 text-right font-medium">
                  {formatearCLPConCero(c.total)}
                </td>
                <td className="cifra px-3 py-1.5 text-right">{c.porcentaje.toFixed(1)}%</td>
                <td className="px-3 py-1.5" style={{ width: 160 }}>
                  <div className="h-2 w-full rounded-sm bg-linea">
                    <div
                      className="h-2 rounded-sm bg-acento"
                      style={{ width: `${Math.max(c.porcentaje, 0.4)}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {ranking.length > 10 ? (
          <button
            type="button"
            onClick={() => setVerTodos(!verTodos)}
            className="mt-2 text-[11px] text-acento underline underline-offset-2"
          >
            {verTodos ? 'Mostrar solo los 10 primeros' : `Ver los ${ranking.length} clientes`}
          </button>
        ) : null}

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
