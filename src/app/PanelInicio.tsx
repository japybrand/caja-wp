import Link from 'next/link'
import type { Panel, Vencimiento } from '@/lib/panel'
import { DIAS_VENTANA } from '@/lib/panel'
import { Grafico } from './Grafico'

const clp = (n: number): string =>
  '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

/** 2026-09-20 -> "20 de septiembre" */
const enPalabras = (iso: string): string => {
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ]
  const [, m, d] = iso.split('-')
  return `${Number(d)} de ${meses[Number(m) - 1]}`
}

/**
 * Panel de inicio.
 *
 * Siete preguntas en lenguaje normal, cada una con el número grande, una frase que
 * lo explica y, si hay que hacer algo, un verbo con fecha.
 *
 * El color aparece solo dos veces: en lo atrasado y en la plata que falta. Si todo
 * estuviera al día, el panel no tendría un solo color. Las barras y el gráfico van
 * en gris a propósito — colorearlos no agrega información y le resta fuerza a lo
 * que sí exige una decisión.
 */

function Bloque({
  titulo,
  alerta,
  children,
}: {
  titulo: string
  alerta?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={
        'rounded border px-4 py-3 ' +
        (alerta ? 'border-negativo/40 bg-negativo/[0.03]' : 'border-linea')
      }
    >
      <h2 className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wide text-tenue">
        {titulo}
        {alerta ? <span className="negativo normal-case">· requiere acción</span> : null}
      </h2>
      {children}
    </section>
  )
}

function Cifra({ valor, tono }: { valor: string; tono?: 'negativo' }) {
  return (
    <div className={'cifra text-[26px] leading-tight ' + (tono === 'negativo' ? 'negativo' : '')}>
      {valor}
    </div>
  )
}

function Explica({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 max-w-[60ch] text-[12px] text-tenue">{children}</p>
}

function Accion({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[12px] font-medium">→ {children}</p>
}

function ListaVencimientos({ items }: { items: Vencimiento[] }) {
  return (
    <table className="mt-3 w-full text-[12px]">
      <tbody>
        {items.map((v, i) => (
          <tr key={i}>
            <td className="py-1 pr-3">{v.concepto}</td>
            <td className="cifra py-1 pr-3 text-right">{clp(v.monto)}</td>
            <td className="py-1 text-[11px] text-tenue">
              {v.vencido ? (
                <span className="negativo">
                  {Math.abs(v.dias) === 0 ? 'vencía hoy' : `hace ${Math.abs(v.dias)} días`}
                </span>
              ) : (
                `${v.accion} antes del ${enPalabras(v.fecha).split(' de ')[0]}`
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function PanelInicio({ panel }: { panel: Panel }) {
  const {
    nombreMes,
    saldoHoy,
    fechaSaldo,
    brechaDelMes,
    mesAMedias,
    atrasados,
    totalAtrasado,
    proximos,
    totalProximos,
    falta,
    iva,
    ivaEnCurso,
    costos,
    totalCostos,
    deudas,
    totalDeuda,
    cuotaFijaMensual,
    hasta,
    barras,
    deficit,
    comparacion,
    porRevisar,
    sinConciliar,
  } = panel

  const alcanza = falta === 0
  const mayorCosto = Math.max(...costos.map((c) => c.monto), 1)

  return (
    <div className="mx-auto max-w-5xl px-4 py-5">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Cómo va la caja</h1>
        <span className="text-[11px] text-tenue">
          {nombreMes.toLowerCase()} · datos al {fechaSaldo ? enPalabras(fechaSaldo) : 'día'}
        </span>
      </div>

      <div className="grid gap-3">
        {/* 1 ─────────────────────────────────────────────────────────────── */}
        <Bloque titulo="¿Cuánta plata tengo?">
          <div className="flex flex-wrap items-start gap-x-12 gap-y-3">
            <div>
              <Cifra valor={clp(saldoHoy)} tono={saldoHoy < 0 ? 'negativo' : undefined} />
              <Explica>en la cuenta corriente hoy</Explica>
            </div>
            <div>
              <Cifra
                valor={brechaDelMes < 0 ? clp(-brechaDelMes) : clp(brechaDelMes)}
                tono={brechaDelMes < 0 ? 'negativo' : undefined}
              />
              <Explica>
                {brechaDelMes < 0
                  ? `es lo que te falta si pagas todo lo de ${nombreMes.toLowerCase()}`
                  : `es lo que te quedaría al cerrar ${nombreMes.toLowerCase()}`}
              </Explica>
            </div>
          </div>
          {mesAMedias ? (
            <Explica>
              El cálculo es conservador: el registro de ventas de {nombreMes.toLowerCase()} todavía
              está a medias, así que lo que falta cobrar aparece más bajo de lo que será.
            </Explica>
          ) : null}
        </Bloque>

        {/* 2 ─────────────────────────────────────────────────────────────── */}
        {atrasados.length > 0 ? (
          <Bloque
            titulo={
              atrasados.length === 1 ? 'Hay 1 pago atrasado' : `Hay ${atrasados.length} pagos atrasados`
            }
            alerta
          >
            <Cifra valor={clp(totalAtrasado)} tono="negativo" />
            <Explica>deberías haber pagado esto y todavía no está pagado</Explica>
            <ListaVencimientos items={atrasados} />
            <Accion>Págalos cuanto antes: las cotizaciones acumulan multa e interés.</Accion>
          </Bloque>
        ) : (
          <Bloque titulo="¿Hay algo atrasado?">
            <Cifra valor="Nada" />
            <Explica>estás al día con todo lo que ya venció</Explica>
          </Bloque>
        )}

        {/* 3 ─────────────────────────────────────────────────────────────── */}
        <Bloque titulo={`Qué tienes que pagar antes del ${enPalabras(hasta)}`}>
          <Cifra valor={clp(totalProximos)} />
          <Explica>
            todo lo que vence en los próximos {DIAS_VENTANA} días, incluido lo que ya está atrasado
          </Explica>
          {totalProximos > 0 ? <ListaVencimientos items={[...atrasados, ...proximos]} /> : null}
        </Bloque>

        {/* 4 ─────────────────────────────────────────────────────────────── */}
        <Bloque titulo="¿Te alcanza la plata?" alerta={!alcanza}>
          <Cifra valor={alcanza ? 'Sí, alcanza' : `No. Faltan ${clp(falta)}`} tono={alcanza ? undefined : 'negativo'} />
          <Explica>
            Tienes {clp(saldoHoy)} y en los próximos {DIAS_VENTANA} días tienes que pagar{' '}
            {clp(totalProximos)}.
          </Explica>
          {alcanza ? null : (
            <Accion>
              Cobra {clp(falta)} antes del {enPalabras(hasta)} para llegar.
            </Accion>
          )}
        </Bloque>

        {/* 5 ─────────────────────────────────────────────────────────────── */}
        <Bloque titulo="Cuánto IVA vas a pagar">
          {iva ? (
            <>
              <Cifra valor={clp(iva.aPagar)} />
              <Explica>
                IVA del período {enPalabras(`2026-${String(iva.mes).padStart(2, '0')}-01`).split(' de ')[1]},
                se paga antes del {enPalabras(iva.venceEl)}
              </Explica>
              <table className="mt-3 w-full max-w-md text-[12px]">
                <tbody>
                  <tr>
                    <td className="py-1">Le cobraste a tus clientes</td>
                    <td className="cifra py-1 text-right">{clp(iva.debito)}</td>
                    <td className="py-1 pl-3 text-[11px] text-tenue">débito fiscal</td>
                  </tr>
                  <tr>
                    <td className="py-1">Te cobraron tus proveedores</td>
                    <td className="cifra py-1 text-right">{clp(iva.credito)}</td>
                    <td className="py-1 pl-3 text-[11px] text-tenue">crédito fiscal</td>
                  </tr>
                  {iva.remanenteAnterior > 0 ? (
                    <tr>
                      <td className="py-1">Tenías a favor del mes anterior</td>
                      <td className="cifra py-1 text-right">{clp(iva.remanenteAnterior)}</td>
                      <td className="py-1 pl-3 text-[11px] text-tenue">remanente</td>
                    </tr>
                  ) : null}
                  <tr className="border-t border-linea font-medium">
                    <td className="py-1">La diferencia es lo que le debes al SII</td>
                    <td className="cifra py-1 text-right">{clp(iva.aPagar)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              {iva.remanente > 0 ? (
                <Explica>
                  Te quedan {clp(iva.remanente)} a favor para descontar del próximo mes.
                </Explica>
              ) : null}
              {ivaEnCurso ? (
                <Explica>
                  {nombreMes} va en {clp(ivaEnCurso.aPagar)}, pero el mes no ha terminado.
                </Explica>
              ) : null}
            </>
          ) : (
            <>
              <Cifra valor="Sin datos" />
              <Explica>
                Falta cargar el registro de compras o de ventas del período anterior.
              </Explica>
            </>
          )}
        </Bloque>

        {/* 6 ─────────────────────────────────────────────────────────────── */}
        <Bloque titulo={`Qué te está costando más en ${nombreMes.toLowerCase()}`}>
          <table className="w-full max-w-2xl text-[12px]">
            <tbody>
              {costos.map((c) => (
                <tr key={c.concepto}>
                  <td className="w-44 py-1 pr-2">{c.concepto}</td>
                  <td className="w-full py-1">
                    <div
                      className="h-2.5 rounded-sm bg-linea-fuerte"
                      style={{ width: `${Math.max((c.monto / mayorCosto) * 100, 2)}%` }}
                    />
                  </td>
                  <td className="cifra py-1 pl-3 text-right">{clp(c.monto)}</td>
                  <td className="cifra w-12 py-1 pl-2 text-right text-tenue">
                    {c.porcentaje.toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Explica>
            Total de {nombreMes.toLowerCase()}: {clp(totalCostos)}.{' '}
            {costos[0]?.concepto === 'Deudas y convenios'
              ? 'Lo que más pesa es la deuda, no la operación.'
              : `Lo que más pesa es ${costos[0]?.concepto.toLowerCase()}.`}
          </Explica>
        </Bloque>

        {/* 7 ─────────────────────────────────────────────────────────────── */}
        <Bloque titulo="A quién le debes">
          <Cifra valor={clp(totalDeuda)} />
          <Explica>en total, sumando convenios, crédito y colaboradores</Explica>
          <table className="mt-3 w-full max-w-2xl text-[12px]">
            <tbody>
              {deudas.map((d, i) => (
                <tr key={i}>
                  <td className="py-1 pr-3">{d.quien}</td>
                  <td className={'cifra py-1 pr-3 text-right ' + (d.atrasado ? 'negativo' : '')}>
                    {clp(d.monto)}
                  </td>
                  <td className={'py-1 text-[11px] ' + (d.atrasado ? 'negativo' : 'text-tenue')}>
                    {d.detalle}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Explica>
            Cada mes se van {clp(cuotaFijaMensual)} solo en cuotas, pase lo que pase.
          </Explica>
          <p className="mt-2 text-[12px]">
            <Link href="/obligaciones" className="text-acento underline underline-offset-2">
              Ver el detalle en Obligaciones →
            </Link>
          </p>
        </Bloque>
      </div>

      {/* ── El detalle, abajo ──────────────────────────────────────────────── */}
      <div className="mt-8 mb-3 flex items-center gap-3">
        <div className="h-px flex-1 bg-linea" />
        <span className="text-[11px] uppercase tracking-wide text-tenue">De aquí abajo, el detalle</span>
        <div className="h-px flex-1 bg-linea" />
      </div>

      <div className="rounded border border-linea px-3 py-2.5">
        <div className="mb-1 text-[12px] font-semibold">Ingresos y egresos por mes</div>
        <p className="mb-2 text-[10px] text-tenue">
          La línea es el saldo acumulado del flujo, que mide la brecha entre lo comprometido y lo
          que entró. No es el saldo de la cuenta.
        </p>
        <Grafico barras={barras} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {comparacion.length > 0 ? (
          <div className="rounded border border-linea px-3 py-2.5">
            <div className="mb-2 text-[12px] font-semibold">
              {nombreMes} contra el mes anterior
            </div>
            <table className="tabla-flujo w-full text-[12px]">
              <tbody>
                {comparacion.map((c) => {
                  const empeora =
                    c.variacion !== null && (c.masEsPeor ? c.variacion > 0 : c.variacion < 0)
                  return (
                    <tr key={c.concepto}>
                      <td className="px-2 py-1">{c.concepto}</td>
                      <td className="cifra px-2 py-1 text-right text-tenue">{clp(c.anterior)}</td>
                      <td className="cifra px-2 py-1 text-right">{clp(c.actual)}</td>
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

        <div className="rounded border border-linea px-3 py-2.5">
          <div className="mb-2 text-[12px] font-semibold">Meses que cierran en negativo</div>
          {deficit.length === 0 ? (
            <div className="py-2 text-[12px] text-tenue">Ninguno.</div>
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

      <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
        <Link href="/flujo" className="text-acento underline underline-offset-2">
          Ver el flujo completo →
        </Link>
        {porRevisar > 0 ? (
          <Link href="/movimientos" className="text-amber-700 underline underline-offset-2">
            Revisa {porRevisar} movimientos →
          </Link>
        ) : null}
        {sinConciliar > 0 ? (
          <Link href="/banco" className="text-amber-700 underline underline-offset-2">
            Resuelve {sinConciliar} cargos del banco →
          </Link>
        ) : null}
      </p>
    </div>
  )
}
