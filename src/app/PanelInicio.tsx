import Link from 'next/link'
import type { Panel } from '@/lib/panel'
import { Grafico } from './Grafico'

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

/**
 * Panel de inicio.
 *
 * El color solo comunica estado: rojo para lo negativo, ámbar para lo que exige
 * hacer algo. Las barras del gráfico van en gris a propósito — colorearlas no
 * agregaría información y le quitaría fuerza a la línea de saldo, que es lo único
 * que hay que mirar.
 */

function Tarjeta({
  etiqueta,
  valor,
  detalle,
  tono,
  href,
}: {
  etiqueta: string
  valor: string
  detalle: string
  tono: 'neutro' | 'negativo' | 'alerta'
  href?: string
}) {
  const cuerpo = (
    <>
      <div className="text-[10px] uppercase tracking-wide text-tenue">{etiqueta}</div>
      <div
        className={
          'cifra mt-1 text-[17px] ' +
          (tono === 'negativo' ? 'negativo' : tono === 'alerta' ? 'text-amber-700' : '')
        }
      >
        {valor}
      </div>
      <div className="mt-0.5 text-[10px] text-tenue">{detalle}</div>
    </>
  )
  const clases = 'rounded border border-linea bg-panel px-3 py-2.5'
  return href ? (
    <Link href={href} className={clases + ' transition-colors hover:border-linea-fuerte'}>
      {cuerpo}
    </Link>
  ) : (
    <div className={clases}>{cuerpo}</div>
  )
}

export function PanelInicio({ panel }: { panel: Panel }) {
  const { tarjetas, barras, vencimientos, egresosDelMes, deficit, comparacion } = panel
  const mayorEgreso = Math.max(...egresosDelMes.map((e) => e.monto), 1)

  return (
    <div className="px-4 py-4">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Caja WP</h1>
        <span className="text-[11px] text-tenue">Estado de la caja al día de hoy</span>
      </div>

      {/* ── Tarjetas ────────────────────────────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
        {tarjetas.map((t) => (
          <Tarjeta
            key={t.etiqueta}
            etiqueta={t.etiqueta}
            valor={clp(t.valor)}
            detalle={t.detalle}
            tono={t.tono}
            href={t.href}
          />
        ))}
      </div>

      {/* ── Vencimientos ───────────────────────────────────────────────────── */}
      {vencimientos.length > 0 ? (
        <div className="mb-5 rounded border border-amber-300 bg-amber-50/50 px-3 py-2">
          <div className="mb-1.5 text-[11px] font-semibold text-amber-800">
            Vence en los próximos 15 días
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {vencimientos.map((v, i) => (
                <tr key={i}>
                  <td className="cifra w-24 py-0.5 text-tenue">{v.fecha}</td>
                  <td className="py-0.5">{v.concepto}</td>
                  <td className="cifra py-0.5 text-right">{clp(v.monto)}</td>
                  <td className="w-28 py-0.5 pl-3 text-[11px]">
                    {v.vencido ? (
                      <span className="negativo font-medium">
                        atrasada {Math.abs(v.dias)} d
                      </span>
                    ) : (
                      <span className="text-amber-700">en {v.dias} d</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* ── Gráfico ──────────────────────────────────────────────────────── */}
        <div className="rounded border border-linea px-3 py-2.5">
          <div className="mb-1 text-[12px] font-semibold">Ingresos y egresos por mes</div>
          <p className="mb-2 text-[10px] text-tenue">
            La línea es el saldo acumulado. Se pone roja cuando el año cierra en negativo.
          </p>
          <Grafico barras={barras} />
        </div>

        {/* ── Egresos del mes ──────────────────────────────────────────────── */}
        <div className="rounded border border-linea px-3 py-2.5">
          <div className="mb-2 text-[12px] font-semibold">Egresos del mes en curso</div>
          <table className="w-full text-[12px]">
            <tbody>
              {egresosDelMes.map((e) => (
                <tr key={e.grupo}>
                  <td className="py-1 pr-2 align-middle">{e.grupo}</td>
                  <td className="w-full py-1 align-middle">
                    <div
                      className="h-2 rounded-sm bg-linea-fuerte"
                      style={{ width: `${Math.max((e.monto / mayorEgreso) * 100, 2)}%` }}
                    />
                  </td>
                  <td className="cifra py-1 pl-2 text-right align-middle">{clp(e.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Comparación ──────────────────────────────────────────────────── */}
        {comparacion.length > 0 ? (
          <div className="rounded border border-linea px-3 py-2.5">
            <div className="mb-2 text-[12px] font-semibold">Este mes contra el anterior</div>
            <table className="tabla-flujo w-full text-[12px]">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Concepto</th>
                  <th className="px-2 py-1 text-right font-medium">Anterior</th>
                  <th className="px-2 py-1 text-right font-medium">Actual</th>
                  <th className="px-2 py-1 text-right font-medium">Var.</th>
                </tr>
              </thead>
              <tbody>
                {comparacion.map((c) => {
                  const empeora =
                    c.variacion !== null && (c.masEsPeor ? c.variacion > 0 : c.variacion < 0)
                  return (
                    <tr key={c.concepto}>
                      <td className="px-2 py-1">{c.concepto}</td>
                      <td className="cifra px-2 py-1 text-right text-tenue">{clp(c.anterior)}</td>
                      <td className={'cifra px-2 py-1 text-right ' + (c.actual < 0 ? 'negativo' : '')}>
                        {clp(c.actual)}
                      </td>
                      <td className={'cifra px-2 py-1 text-right ' + (empeora ? 'negativo' : '')}>
                        {c.variacion === null
                          ? '—'
                          : `${c.variacion > 0 ? '+' : ''}${c.variacion.toFixed(0)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* ── Meses en déficit ─────────────────────────────────────────────── */}
        <div className="rounded border border-linea px-3 py-2.5">
          <div className="mb-1 text-[12px] font-semibold">Meses que cierran en negativo</div>
          <p className="mb-2 text-[10px] text-tenue">
            El saldo acumulado al cierre de cada mes, no el déficit del mes solo.
          </p>
          {deficit.length === 0 ? (
            <div className="py-2 text-[12px] text-tenue">Ningún mes cierra en negativo.</div>
          ) : (
            <table className="tabla-flujo w-full text-[12px]">
              <tbody>
                {deficit.map((d) => (
                  <tr key={d.mes}>
                    <td className="px-2 py-1">{d.mes}</td>
                    <td className="px-2 py-1 text-[10px] text-tenue">
                      {d.naturaleza === 'real'
                        ? 'real'
                        : d.naturaleza === 'incompleto'
                          ? 'incompleto'
                          : 'proyectado'}
                    </td>
                    <td className="cifra negativo px-2 py-1 text-right">{clp(d.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
