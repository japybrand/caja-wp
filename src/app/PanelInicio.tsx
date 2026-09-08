import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  BadgePercent,
  CalendarClock,
  CheckCircle2,
  Landmark,
  PieChart,
  Scale,
  Wallet,
} from 'lucide-react'
import type { Panel, Vencimiento } from '@/lib/panel'
import { DIAS_VENTANA } from '@/lib/panel'
import { Accion, Marca, Pagina, Tarjeta, Titular, Vacio, clp, fechaEnPalabras } from '@/componentes/ui'
import { Grafico } from './Grafico'

/**
 * Panel de inicio.
 *
 * Siete preguntas en lenguaje normal, cada una con el número grande, una frase que
 * lo explica y, si hay que hacer algo, un verbo con fecha.
 *
 * Los íconos identifican el bloque, no lo decoran: uno por tarjeta, del mismo
 * tamaño, y en gris salvo cuando el bloque exige una decisión. El color aparece
 * solo en lo atrasado y en la plata que falta — si todo estuviera al día, el panel
 * no tendría un solo color.
 */

function ListaVencimientos({ items }: { items: Vencimiento[] }) {
  return (
    <table className="tabla">
      <tbody>
        {items.map((v, i) => (
          <tr key={i}>
            <td className="!px-0">{v.concepto}</td>
            <td className="monto !px-0 font-medium">{clp(v.monto)}</td>
            <td className="!pr-0 !pl-4 text-right">
              {v.vencido ? (
                <Marca tono="negativo">
                  {Math.abs(v.dias) === 0 ? 'vencía hoy' : `hace ${Math.abs(v.dias)} días`}
                </Marca>
              ) : (
                <span className="text-[11px] text-tenue">
                  {v.accion} antes del {fechaEnPalabras(v.fecha).split(' de ')[0]}
                </span>
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
  const mes = nombreMes.toLowerCase()
  const mayorCosto = Math.max(...costos.map((c) => c.monto), 1)

  return (
    <Pagina
      titulo="Cómo va la caja"
      bajada={`${mes} · datos al ${fechaSaldo ? fechaEnPalabras(fechaSaldo) : 'día'}`}
      acciones={
        <Link href="/flujo" className="flex items-center gap-1 text-acento hover:underline">
          Ver el flujo completo <ArrowRight size={13} strokeWidth={2} />
        </Link>
      }
    >
      <div className="grid gap-3">
        {/* 1 ─ Plata ─────────────────────────────────────────────────────── */}
        <Tarjeta titulo="¿Cuánta plata tengo?" icono={Wallet}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Titular
              valor={clp(saldoHoy)}
              tono={saldoHoy < 0 ? 'negativo' : 'neutro'}
              explica="en la cuenta corriente hoy"
            />
            <Titular
              valor={clp(Math.abs(brechaDelMes))}
              tono={brechaDelMes < 0 ? 'negativo' : 'neutro'}
              explica={
                brechaDelMes < 0
                  ? `es lo que te falta si pagas todo lo de ${mes}`
                  : `es lo que te quedaría al cerrar ${mes}`
              }
            />
          </div>
          {mesAMedias ? (
            <p className="mt-4 border-t border-linea pt-3 text-[12px] text-tenue">
              El cálculo es conservador: el registro de ventas de {mes} todavía está a medias, así
              que lo que falta cobrar aparece más bajo de lo que será.
            </p>
          ) : null}
        </Tarjeta>

        {/* 2 ─ Atrasos ───────────────────────────────────────────────────── */}
        {atrasados.length > 0 ? (
          <Tarjeta
            titulo={atrasados.length === 1 ? '1 pago atrasado' : `${atrasados.length} pagos atrasados`}
            icono={AlertTriangle}
            tono="negativo"
          >
            <Titular
              valor={clp(totalAtrasado)}
              tono="negativo"
              explica="deberías haber pagado esto y todavía no está pagado"
            />
            <div className="mt-3 border-t border-linea pt-1">
              <ListaVencimientos items={atrasados} />
            </div>
            <Accion icono={AlertTriangle} tono="negativo">
              Págalos cuanto antes: las cotizaciones acumulan multa e interés.
            </Accion>
          </Tarjeta>
        ) : (
          <Tarjeta titulo="¿Hay algo atrasado?" icono={CheckCircle2} tono="positivo">
            <Vacio
              icono={CheckCircle2}
              tono="positivo"
              titulo="Nada atrasado"
              detalle="Estás al día con todo lo que ya venció."
            />
          </Tarjeta>
        )}

        {/* 3 y 4 ─ Lo que viene y si alcanza ─────────────────────────────── */}
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Tarjeta
            titulo={`Qué pagar antes del ${fechaEnPalabras(hasta)}`}
            icono={CalendarClock}
          >
            <Titular
              valor={clp(totalProximos)}
              explica={`todo lo que vence en los próximos ${DIAS_VENTANA} días, incluido lo atrasado`}
            />
            {totalProximos > 0 ? (
              <div className="mt-3 border-t border-linea pt-1">
                <ListaVencimientos items={[...atrasados, ...proximos]} />
              </div>
            ) : (
              <Vacio icono={CheckCircle2} titulo="Nada vence en 15 días" />
            )}
          </Tarjeta>

          <Tarjeta
            titulo="¿Te alcanza la plata?"
            icono={Scale}
            tono={alcanza ? 'positivo' : 'negativo'}
          >
            <Titular
              valor={alcanza ? 'Sí, alcanza' : `Faltan ${clp(falta)}`}
              tono={alcanza ? 'positivo' : 'negativo'}
              explica={
                <>
                  Tienes {clp(saldoHoy)} y en {DIAS_VENTANA} días tienes que pagar{' '}
                  {clp(totalProximos)}.
                </>
              }
            />
            {alcanza ? null : (
              <Accion icono={ArrowRight} tono="negativo">
                Cobra {clp(falta)} antes del {fechaEnPalabras(hasta)} para llegar.
              </Accion>
            )}
          </Tarjeta>
        </div>

        {/* 5 ─ IVA ───────────────────────────────────────────────────────── */}
        <Tarjeta titulo="Cuánto IVA vas a pagar" icono={BadgePercent}>
          {iva ? (
            <>
              <Titular
                valor={clp(iva.aPagar)}
                explica={`IVA del período ${fechaEnPalabras(`2026-${String(iva.mes).padStart(2, '0')}-01`).split(' de ')[1]}, se paga antes del ${fechaEnPalabras(iva.venceEl)}`}
              />
              <table className="tabla mt-3 max-w-lg border-t border-linea">
                <tbody>
                  <tr>
                    <td className="!pl-0">Le cobraste a tus clientes</td>
                    <td className="monto">{clp(iva.debito)}</td>
                    <td className="!pr-0 text-right text-[11px] text-suave">débito fiscal</td>
                  </tr>
                  <tr>
                    <td className="!pl-0">Te cobraron tus proveedores</td>
                    <td className="monto">−{clp(iva.credito)}</td>
                    <td className="!pr-0 text-right text-[11px] text-suave">crédito fiscal</td>
                  </tr>
                  {iva.remanenteAnterior > 0 ? (
                    <tr>
                      <td className="!pl-0">Tenías a favor del mes anterior</td>
                      <td className="monto">−{clp(iva.remanenteAnterior)}</td>
                      <td className="!pr-0 text-right text-[11px] text-suave">remanente</td>
                    </tr>
                  ) : null}
                  <tr className="font-medium">
                    <td className="!pl-0">Lo que le debes al SII</td>
                    <td className="monto">{clp(iva.aPagar)}</td>
                    <td className="!pr-0" />
                  </tr>
                </tbody>
              </table>
              {iva.remanente > 0 ? (
                <Accion icono={CheckCircle2} tono="positivo">
                  Te quedan {clp(iva.remanente)} a favor para descontar del próximo mes.
                </Accion>
              ) : null}
              {ivaEnCurso ? (
                <p className="mt-3 text-[12px] text-tenue">
                  {nombreMes} va en {clp(ivaEnCurso.aPagar)}, pero el mes no ha terminado.
                </p>
              ) : null}
            </>
          ) : (
            <Vacio
              icono={BadgePercent}
              tono="alerta"
              titulo="Falta un registro del SII"
              detalle="Sin el registro de compras y el de ventas del período anterior no se puede calcular el IVA."
            />
          )}
        </Tarjeta>

        {/* 6 y 7 ─ Costos y deuda ────────────────────────────────────────── */}
        <div className="grid gap-3 lg:grid-cols-2">
          <Tarjeta titulo={`Qué te cuesta más en ${mes}`} icono={PieChart}>
            <table className="tabla">
              <tbody>
                {costos.map((c) => (
                  <tr key={c.concepto}>
                    <td className="!pl-0 whitespace-nowrap">{c.concepto}</td>
                    <td className="w-full">
                      <div
                        className="h-1.5 rounded-full bg-linea-fuerte"
                        style={{ width: `${Math.max((c.monto / mayorCosto) * 100, 3)}%` }}
                      />
                    </td>
                    <td className="monto">{clp(c.monto)}</td>
                    <td className="monto !pr-0 w-11 text-suave">{c.porcentaje.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-tenue">
              Total de {mes}: <span className="cifra">{clp(totalCostos)}</span>.{' '}
              {costos[0]?.concepto === 'Deudas y convenios'
                ? 'Lo que más pesa es la deuda, no la operación.'
                : `Lo que más pesa es ${costos[0]?.concepto.toLowerCase()}.`}
            </p>
          </Tarjeta>

          <Tarjeta
            titulo="A quién le debes"
            icono={Landmark}
            pie={
              <Link
                href="/obligaciones"
                className="flex items-center gap-1 text-acento hover:underline"
              >
                Ver el detalle en Obligaciones <ArrowRight size={13} strokeWidth={2} />
              </Link>
            }
          >
            <Titular
              valor={clp(totalDeuda)}
              explica="en total, sumando convenios, crédito y colaboradores"
            />
            <table className="tabla mt-3 border-t border-linea">
              <tbody>
                {deudas.map((d, i) => (
                  <tr key={i}>
                    <td className="!pl-0">{d.quien}</td>
                    <td className={'monto ' + (d.atrasado ? 'text-negativo' : '')}>
                      {clp(d.monto)}
                    </td>
                    <td className="!pr-0 text-right">
                      {d.atrasado ? (
                        <Marca tono="negativo">{d.detalle}</Marca>
                      ) : (
                        <span className="text-[11px] text-suave">{d.detalle}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[12px] text-tenue">
              Cada mes se van <span className="cifra">{clp(cuotaFijaMensual)}</span> solo en cuotas,
              pase lo que pase.
            </p>
          </Tarjeta>
        </div>
      </div>

      {/* ── El detalle, abajo ────────────────────────────────────────────── */}
      <div className="mt-8 mb-3 flex items-center gap-3">
        <div className="h-px flex-1 bg-linea" />
        <span className="rotulo">De aquí abajo, el detalle</span>
        <div className="h-px flex-1 bg-linea" />
      </div>

      <Tarjeta
        titulo="Ingresos y egresos por mes"
        bajada="La línea es el saldo acumulado del flujo, que mide la brecha entre lo comprometido y lo que entró. No es el saldo de la cuenta."
      >
        <Grafico barras={barras} />
      </Tarjeta>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {comparacion.length > 0 ? (
          <Tarjeta titulo={`${nombreMes} contra el mes anterior`}>
            <table className="tabla">
              <thead>
                <tr>
                  <th className="!pl-0">Concepto</th>
                  <th className="!text-right">Anterior</th>
                  <th className="!text-right">Actual</th>
                  <th className="!pr-0 !text-right">Var.</th>
                </tr>
              </thead>
              <tbody>
                {comparacion.map((c) => {
                  const empeora =
                    c.variacion !== null && (c.masEsPeor ? c.variacion > 0 : c.variacion < 0)
                  return (
                    <tr key={c.concepto}>
                      <td className="!pl-0">{c.concepto}</td>
                      <td className="monto text-tenue">{clp(c.anterior)}</td>
                      <td className="monto">{clp(c.actual)}</td>
                      <td className={'monto !pr-0 ' + (empeora ? 'text-negativo' : 'text-tenue')}>
                        {c.variacion === null
                          ? '—'
                          : `${c.variacion > 0 ? '+' : ''}${c.variacion.toFixed(0)}%`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Tarjeta>
        ) : null}

        <Tarjeta titulo="Meses que cierran en negativo">
          {deficit.length === 0 ? (
            <Vacio icono={CheckCircle2} tono="positivo" titulo="Ninguno cierra en negativo" />
          ) : (
            <table className="tabla">
              <tbody>
                {deficit.map((d) => (
                  <tr key={d.mes}>
                    <td className="!pl-0">{d.mes}</td>
                    <td>
                      <Marca tono={d.naturaleza === 'real' ? 'neutro' : 'alerta'}>
                        {d.naturaleza === 'real'
                          ? 'real'
                          : d.naturaleza === 'incompleto'
                            ? 'incompleto'
                            : 'proyectado'}
                      </Marca>
                    </td>
                    <td className="monto !pr-0 text-negativo">{clp(d.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>
      </div>

      {porRevisar > 0 || sinConciliar > 0 ? (
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
          {porRevisar > 0 ? (
            <Link
              href="/movimientos"
              className="flex items-center gap-1 text-alerta hover:underline"
            >
              <AlertTriangle size={13} strokeWidth={2} />
              Revisa {porRevisar} movimientos
            </Link>
          ) : null}
          {sinConciliar > 0 ? (
            <Link href="/banco" className="flex items-center gap-1 text-alerta hover:underline">
              <AlertTriangle size={13} strokeWidth={2} />
              Resuelve {sinConciliar} cargos del banco
            </Link>
          ) : null}
        </p>
      ) : null}
    </Pagina>
  )
}
