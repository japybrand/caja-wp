import type { EstadoObligaciones } from '@/lib/obligaciones'

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

const ETIQUETA_TIPO: Record<string, string> = {
  convenio_tgr: 'Convenio',
  linea_credito: 'Línea de crédito',
}

function Dato({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: 'negativo' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-tenue">{etiqueta}</div>
      <div className={'cifra mt-0.5 text-[14px] ' + (tono === 'negativo' ? 'negativo' : '')}>
        {valor}
      </div>
    </div>
  )
}

export function PanelObligaciones({ estado }: { estado: EstadoObligaciones }) {
  const { obligaciones, calendario, cotizaciones, totales, cotizacionesAtrasadas } = estado
  const { compromisos, totalCompromisos } = estado

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Obligaciones</h1>
        <span className="text-[11px] text-tenue">
          Convenios de la Tesorería, línea Fogape y cotizaciones previsionales
        </span>
      </div>

      {/* ── Resumen ─────────────────────────────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-x-8 gap-y-3 rounded border border-linea bg-panel px-4 py-3 sm:grid-cols-4">
        <Dato etiqueta="Ya pagado" valor={clp(totales.pagado)} />
        <Dato etiqueta="Pendiente" valor={clp(totales.pendiente)} tono="negativo" />
        <Dato etiqueta="Cuotas por generar" valor={clp(totales.porGenerar)} />
        <Dato
          etiqueta="Mes más pesado"
          valor={totales.peak ? `${clp(totales.peak.monto)} · ${totales.peak.etiqueta}` : '—'}
          tono="negativo"
        />
      </div>

      {cotizacionesAtrasadas > 0 ? (
        <div className="mb-5 rounded border border-negativo/30 bg-negativo/5 px-3 py-2 text-[12px]">
          <span className="negativo font-medium">
            {cotizacionesAtrasadas === 1
              ? '1 cotización previsional atrasada'
              : `${cotizacionesAtrasadas} cotizaciones previsionales atrasadas`}
            .
          </span>{' '}
          <span className="text-tenue">
            Las cotizaciones no están dentro de ningún convenio: se pagan mes a mes.
          </span>
        </div>
      ) : null}

      {/* ── Estado de cada obligación ───────────────────────────────────────── */}
      <h2 className="mb-2 text-[12px] font-semibold">Compromisos vigentes</h2>
      <div className="mb-6 overflow-x-auto">
        <table className="tabla-flujo w-full min-w-[860px] text-[12px]">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Obligación</th>
              <th className="px-2 py-1.5 text-left font-medium">Marco</th>
              <th className="px-2 py-1.5 text-left font-medium">Activado</th>
              <th className="px-2 py-1.5 text-right font-medium">Cuota</th>
              <th className="px-2 py-1.5 text-right font-medium">Pagadas</th>
              <th className="px-2 py-1.5 text-right font-medium">Pendientes</th>
              <th className="px-2 py-1.5 text-left font-medium">Última cuota</th>
              <th className="px-2 py-1.5 text-right font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {obligaciones.map((o) => (
              <tr key={o.id}>
                <td className="px-2 py-1.5">
                  <span className="font-medium">
                    {o.institucion} {o.numero}
                  </span>
                  <span className="ml-1.5 text-[10px] text-tenue">
                    {ETIQUETA_TIPO[o.tipo] ?? o.tipo}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-tenue">{o.marco}</td>
                <td className="cifra px-2 py-1.5 text-tenue">{o.fechaActivacion}</td>
                <td className="cifra px-2 py-1.5 text-right">{clp(o.cuotaMensual)}</td>
                <td className="cifra px-2 py-1.5 text-right text-tenue">{o.pagadas}</td>
                <td className="cifra px-2 py-1.5 text-right">
                  {o.pendientes}
                  {o.porGenerar > 0 ? (
                    <span className="ml-1 text-[10px] text-tenue">+{o.porGenerar} por generar</span>
                  ) : null}
                </td>
                <td className="cifra px-2 py-1.5 text-tenue">
                  {o.ultimoMes
                    ? `${String(o.ultimoMes.mes).padStart(2, '0')}/${o.ultimoMes.anio}`
                    : '—'}
                </td>
                <td className="cifra negativo px-2 py-1.5 text-right">{clp(o.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Calendario combinado ────────────────────────────────────────────── */}
      <h2 className="mb-1 text-[12px] font-semibold">Calendario de cuotas</h2>
      <p className="mb-2 text-[11px] text-tenue">
        Lo que hay que pagar cada mes por deuda comprometida, sin contar cotizaciones ni
        operación. Los meses en gris ya pasaron.
      </p>
      <div className="mb-6 overflow-x-auto">
        <table className="tabla-flujo w-full min-w-[760px] text-[12px]">
          <thead>
            <tr>
              <th className="col-fija px-2 py-1.5 text-left font-medium">Mes</th>
              {obligaciones.map((o) => (
                <th key={o.id} className="px-2 py-1.5 text-right font-medium">
                  {o.numero}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {calendario.map((c) => {
              const esPeak = totales.peak !== null && c.total === totales.peak.monto
              return (
                <tr key={`${c.anio}-${c.mes}`} className={c.pasado ? 'text-tenue' : ''}>
                  <td className={'col-fija px-2 py-1 ' + (c.pasado ? 'text-tenue' : '')}>
                    {c.etiqueta}
                  </td>
                  {c.montos.map((m, i) => (
                    <td key={i} className="cifra px-2 py-1 text-right">
                      {m === 0 ? <span className="text-linea-fuerte">·</span> : clp(m)}
                    </td>
                  ))}
                  <td
                    className={
                      'cifra px-2 py-1 text-right font-medium ' +
                      (esPeak && !c.pasado ? 'bg-realce' : '')
                    }
                  >
                    {clp(c.total)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Deuda con colaboradores ─────────────────────────────────────────── */}
      {compromisos.length > 0 ? (
        <>
          <h2 className="mb-1 text-[12px] font-semibold">Deuda con colaboradores</h2>
          <p className="mb-2 max-w-[80ch] text-[11px] text-tenue">
            Deuda declarada, no calculada. Las planillas de los colaboradores son fuente
            confiable de cuánto se facturó, no de qué quedó pagado: sus estados de pago
            arrastran meses ya regularizados. Cada línea entra al flujo como salida del mes en
            que se espera pagarla.
          </p>
          <div className="mb-6 overflow-x-auto">
            <table className="tabla-flujo w-full min-w-[560px] text-[12px]">
              <thead>
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Colaborador</th>
                  <th className="px-2 py-1.5 text-left font-medium">Concepto</th>
                  <th className="px-2 py-1.5 text-right font-medium">USD</th>
                  <th className="px-2 py-1.5 text-right font-medium">CLP</th>
                  <th className="px-2 py-1.5 text-left font-medium">Sale en</th>
                </tr>
              </thead>
              <tbody>
                {compromisos.map((c, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1 font-medium">{c.colaborador}</td>
                    <td className="px-2 py-1 text-tenue">{c.descripcion}</td>
                    <td className="cifra px-2 py-1 text-right">
                      {c.usd === null ? '—' : c.usd.toLocaleString('es-CL')}
                    </td>
                    <td className="cifra negativo px-2 py-1 text-right">{clp(c.montoCLP)}</td>
                    <td className="cifra px-2 py-1 text-tenue">
                      {String(c.mes).padStart(2, '0')}/{c.anio}
                    </td>
                  </tr>
                ))}
                <tr className="fila-subtotal bg-panel font-medium">
                  <td className="px-2 py-1" colSpan={3}>
                    Total comprometido
                  </td>
                  <td className="cifra negativo px-2 py-1 text-right">{clp(totalCompromisos)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {/* ── Cotizaciones ────────────────────────────────────────────────────── */}
      <h2 className="mb-1 text-[12px] font-semibold">Cotizaciones previsionales</h2>
      <p className="mb-2 text-[11px] text-tenue">
        El período es el mes que se cotiza, no el mes en que se paga. Vencen el 13 del mes
        siguiente. <span className="font-medium">Banco</span> es lo que salió de la cuenta y{' '}
        <span className="font-medium">certificado</span> lo que Previred certifica por Felipe
        Molina; la diferencia es lo cotizado por el resto.
      </p>
      <div className="overflow-x-auto">
        <table className="tabla-flujo w-full min-w-[720px] text-[12px]">
          <thead>
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Período</th>
              <th className="px-2 py-1.5 text-right font-medium">Banco</th>
              <th className="px-2 py-1.5 text-right font-medium">Certificado</th>
              <th className="px-2 py-1.5 text-right font-medium">Resto</th>
              <th className="px-2 py-1.5 text-left font-medium">Estado</th>
              <th className="px-2 py-1.5 text-left font-medium">Pagada el</th>
              <th className="px-2 py-1.5 text-right font-medium">Atraso</th>
            </tr>
          </thead>
          <tbody>
            {cotizaciones.map((c) => {
              const alerta = c.estado === 'atrasada'
              return (
                <tr key={`${c.anio}-${c.mes}`} className={alerta ? 'bg-negativo/5' : ''}>
                  <td className="px-2 py-1">{c.etiqueta}</td>
                  <td className="cifra px-2 py-1 text-right">{clp(c.monto)}</td>
                  <td className="cifra px-2 py-1 text-right text-tenue">
                    {c.montoCertificado > 0 ? clp(c.montoCertificado) : '—'}
                  </td>
                  <td className="cifra px-2 py-1 text-right text-tenue">
                    {c.resto > 0 ? clp(c.resto) : '—'}
                  </td>
                  <td className={'px-2 py-1 ' + (alerta ? 'negativo font-medium' : '')}>
                    {c.estado === 'pagada'
                      ? 'Pagada'
                      : c.estado === 'atrasada'
                        ? 'Atrasada'
                        : 'Pendiente'}
                    {c.estado === 'pendiente' && c.fechaVencimiento ? (
                      <span className="ml-1 text-[10px] text-tenue">
                        vence {c.fechaVencimiento}
                      </span>
                    ) : null}
                  </td>
                  <td className="cifra px-2 py-1 text-tenue">{c.fechaPago ?? '—'}</td>
                  <td className="cifra px-2 py-1 text-right">
                    {c.diasDeAtraso === null ? (
                      <span className="text-linea-fuerte">·</span>
                    ) : c.diasDeAtraso === 0 ? (
                      <span className="text-tenue">al día</span>
                    ) : (
                      <span className={c.diasDeAtraso >= 60 ? 'negativo' : ''}>
                        {c.diasDeAtraso} d
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {cotizaciones.some((c) => c.nota !== '') ? (
        <p className="mt-2 max-w-[70ch] text-[11px] text-tenue">
          De enero a octubre de 2025 no hay cartola cargada, así que ahí la columna{' '}
          <span className="font-medium">Banco</span> muestra lo certificado y no el cargo real,
          que además incluía a Cristián Andrés.
        </p>
      ) : null}
    </div>
  )
}
