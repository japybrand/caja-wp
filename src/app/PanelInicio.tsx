import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  BadgePercent,
  CalendarClock,
  CheckCircle2,
  Landmark,
  PieChart,
} from 'lucide-react'
import type { Panel, Vencimiento } from '@/lib/panel'
import { DIAS_VENTANA } from '@/lib/panel'
import {
  Accion,
  Barra,
  Cifra,
  Marca,
  Pagina,
  Tarjeta,
  Vacio,
  Zona,
  clp,
  fechaEnPalabras,
  nombreMes as nombreDelMes,
} from '@/componentes/ui'
import { Grafico } from './Grafico'

/**
 * Panel de inicio.
 *
 * La composición responde el orden en que hay que mirar, no el orden contable:
 *
 *  1. EL ESTADO DE LA CAJA, en la superficie de tinta. Domina por contraste, no por
 *     tamaño de fuente, y es lo único que usa el paso `t-display`.
 *  2. LO URGENTE, sobre papel cálido. Separado del resto para que se lea como una
 *     zona de acción y no como un dato más.
 *  3. EL PANORAMA, en tarjetas blancas de igual peso entre sí.
 *  4. EL DETALLE, sin tarjeta, sobre el fondo. Queda subordinado por ausencia de
 *     superficie, que es más claro que hacerlo chico.
 *
 * Antes eran siete tarjetas idénticas apiladas y todo llegaba junto.
 */

function ListaVencimientos({
  items,
  inverso = false,
}: {
  items: Vencimiento[]
  inverso?: boolean
}) {
  return (
    <table className="tabla">
      <tbody>
        {items.map((v, i) => (
          <tr key={i}>
            <td className="!pl-0">{v.concepto}</td>
            <td className="monto font-medium">{clp(v.monto)}</td>
            <td className="!pr-0 text-right">
              {v.vencido ? (
                <Marca tono="negativo" inverso={inverso}>
                  {Math.abs(v.dias) === 0 ? 'vencía hoy' : `hace ${Math.abs(v.dias)} días`}
                </Marca>
              ) : (
                <span className="t-apoyo">
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
    f29,
    f29EnCurso,
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
  /** Qué parte de lo que vence alcanzas a cubrir con lo que hay. */
  const cobertura = totalProximos === 0 ? 100 : (saldoHoy / totalProximos) * 100

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
      {/* ═══ 1. El estado de la caja ══════════════════════════════════════ */}
      <Tarjeta variante="principal">
        <div className="grid gap-e5 lg:grid-cols-[1.1fr_1fr_1fr] lg:gap-e6">
          <Cifra
            rotulo="Tienes hoy"
            valor={clp(saldoHoy)}
            tamano="principal"
            inverso
            tono={saldoHoy < 0 ? 'negativo' : 'neutro'}
            explica="en la cuenta corriente"
          />
          <Cifra
            rotulo={`Para cerrar ${mes}`}
            valor={clp(Math.abs(brechaDelMes))}
            inverso
            tono={brechaDelMes < 0 ? 'negativo' : 'positivo'}
            explica={
              brechaDelMes < 0
                ? `te falta esto si pagas todo lo del mes`
                : `te quedaría esto al cerrar el mes`
            }
          />
          <Cifra
            rotulo={`Vence en ${DIAS_VENTANA} días`}
            valor={clp(totalProximos)}
            inverso
            explica={
              alcanza
                ? 'lo cubres con lo que tienes'
                : `te faltan ${clp(falta)} para cubrirlo`
            }
            tono={alcanza ? 'positivo' : 'negativo'}
          />
        </div>

        <div className="mt-e5 border-t border-acento-linea pt-e4">
          <div className="mb-e2 flex items-baseline justify-between">
            <span className="t-rotulo text-claro-suave">Cobertura de lo que viene</span>
            <span className="cifra text-[12px] text-claro-tenue">
              {Math.round(Math.min(cobertura, 999))}%
            </span>
          </div>
          <Barra porcentaje={cobertura} inverso />
          {mesAMedias ? (
            <p className="t-apoyo mt-e3 text-claro-tenue">
              El cálculo es conservador: el registro de ventas de {mes} está a medias, así que lo
              que falta cobrar aparece más bajo de lo que será.
            </p>
          ) : null}
        </div>
      </Tarjeta>

      {/* ═══ 2. Lo urgente ════════════════════════════════════════════════ */}
      <Zona
        titulo="Requiere acción"
        nota={
          atrasados.length > 0
            ? `${atrasados.length} ${atrasados.length === 1 ? 'pago atrasado' : 'pagos atrasados'}`
            : 'nada atrasado'
        }
      >
        <div className="grid gap-e3 lg:grid-cols-[1fr_1fr]">
          {atrasados.length > 0 ? (
            <Tarjeta
              variante="urgente"
              titulo="Atrasado"
              icono={AlertTriangle}
              tono="negativo"
            >
              <Cifra
                valor={clp(totalAtrasado)}
                tono="negativo"
                explica="deberías haber pagado esto y todavía no está pagado"
              />
              <div className="mt-e3 border-t border-urgente-linea pt-e2">
                <ListaVencimientos items={atrasados} />
              </div>
              <Accion icono={AlertTriangle} tono="negativo">
                Págalos cuanto antes: las cotizaciones acumulan multa e interés.
              </Accion>
            </Tarjeta>
          ) : (
            <Tarjeta variante="urgente" titulo="Al día" icono={CheckCircle2} tono="positivo">
              <Vacio
                icono={CheckCircle2}
                tono="positivo"
                titulo="Nada atrasado"
                detalle="Estás al día con todo lo que ya venció."
              />
            </Tarjeta>
          )}

          <Tarjeta
            variante="urgente"
            titulo={`Vence antes del ${fechaEnPalabras(hasta)}`}
            icono={CalendarClock}
            tono="alerta"
          >
            <Cifra
              valor={clp(totalProximos)}
              explica={`todo lo que vence en ${DIAS_VENTANA} días, incluido lo atrasado`}
            />
            {totalProximos > 0 ? (
              <div className="mt-e3 border-t border-urgente-linea pt-e2">
                <ListaVencimientos items={[...atrasados, ...proximos]} />
              </div>
            ) : (
              <Vacio icono={CheckCircle2} titulo="Nada vence en 15 días" />
            )}
            {alcanza ? null : (
              <Accion icono={ArrowRight} tono="negativo">
                Cobra {clp(falta)} antes del {fechaEnPalabras(hasta)} para llegar.
              </Accion>
            )}
          </Tarjeta>
        </div>
      </Zona>

      {/* ═══ 3. El panorama ═══════════════════════════════════════════════ */}
      <Zona titulo="El panorama del mes">
        <div className="grid gap-e3 lg:grid-cols-3">
          <Tarjeta titulo="Impuestos" icono={BadgePercent}>
            {f29 ? (
              <>
                <Cifra
                  valor={clp(f29.total)}
                  explica={`F29 de ${nombreDelMes(f29.mesPeriodo)}, antes del ${fechaEnPalabras(f29.venceEl)}`}
                />
                <table className="tabla mt-e3 border-t border-linea">
                  <tbody>
                    <tr>
                      <td className="!pl-0">IVA</td>
                      <td className="monto !pr-0">{clp(f29.iva?.aPagar ?? 0)}</td>
                    </tr>
                    <tr>
                      <td className="!pl-0">PPM</td>
                      <td className="monto !pr-0">
                        {f29.ppm > 0 ? clp(f29.ppm) : <span className="text-linea-fuerte">·</span>}
                      </td>
                    </tr>
                    <tr>
                      <td className="!pl-0">Retenciones</td>
                      <td className="monto !pr-0">
                        {f29.retencionesHonorarios > 0 ? (
                          clp(f29.retencionesHonorarios)
                        ) : (
                          <span className="text-linea-fuerte">·</span>
                        )}
                      </td>
                    </tr>
                    {f29.sinDesglosar > 0 ? (
                      <tr className="text-alerta">
                        <td className="!pl-0">Falta desglosar</td>
                        <td className="monto !pr-0">{clp(f29.sinDesglosar)}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
                <p className="t-apoyo mt-e3">
                  El IVA sale del SII: {clp(f29.iva?.debito ?? 0)} que cobraste menos{' '}
                  {clp(f29.iva?.credito ?? 0)} que te cobraron.
                </p>
                {f29.completo ? null : (
                  <Accion icono={AlertTriangle} tono="alerta">
                    Es solo el IVA: falta el resto del formulario.
                  </Accion>
                )}
                {f29EnCurso ? (
                  <p className="t-apoyo mt-e2">
                    {nombreMes} va en {clp(f29EnCurso.total)}, sin cerrar.
                  </p>
                ) : null}
              </>
            ) : (
              <Vacio
                icono={BadgePercent}
                tono="alerta"
                titulo="Falta un registro"
                detalle="Sin compras y ventas del período no se puede calcular."
              />
            )}
          </Tarjeta>

          <Tarjeta titulo={`Qué te cuesta más`} icono={PieChart}>
            <Cifra valor={clp(totalCostos)} explica={`sale en ${mes}`} />
            <div className="mt-e4 space-y-e3">
              {costos.map((c) => (
                <div key={c.concepto}>
                  <div className="mb-1 flex items-baseline justify-between gap-e2">
                    <span className="text-[12px]">{c.concepto}</span>
                    <span className="cifra text-[12px] whitespace-nowrap">
                      {clp(c.monto)}
                      <span className="ml-1.5 text-suave">{c.porcentaje.toFixed(0)}%</span>
                    </span>
                  </div>
                  <Barra porcentaje={(c.monto / mayorCosto) * 100} />
                </div>
              ))}
            </div>
            <p className="t-apoyo mt-e4">
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
                Ver el detalle <ArrowRight size={13} strokeWidth={2} />
              </Link>
            }
          >
            <Cifra valor={clp(totalDeuda)} explica="convenios, crédito y colaboradores" />
            <table className="tabla mt-e3 border-t border-linea">
              <tbody>
                {deudas.map((d, i) => (
                  <tr key={i}>
                    <td className="!pl-0">
                      <div>{d.quien}</div>
                      <div className="t-apoyo">{d.detalle}</div>
                    </td>
                    <td className={'monto !pr-0 ' + (d.atrasado ? 'text-negativo' : '')}>
                      {clp(d.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="t-apoyo mt-e3">
              Cada mes se van {clp(cuotaFijaMensual)} solo en cuotas.
            </p>
          </Tarjeta>
        </div>
      </Zona>

      {/* ═══ 4. El detalle ════════════════════════════════════════════════ */}
      <Zona titulo="El detalle" nota="para cuando quieras profundizar">
        <div className="zona-detalle pt-e4">
          <div className="mb-e2 flex items-baseline gap-e3">
            <h3 className="t-tarjeta">Ingresos y egresos por mes</h3>
          </div>
          <p className="t-apoyo mb-e3 max-w-[70ch]">
            La línea es el saldo acumulado del flujo, que mide la brecha entre lo comprometido y lo
            que entró. No es el saldo de la cuenta.
          </p>
          <Grafico barras={barras} />

          <div className="mt-e5 grid gap-e5 lg:grid-cols-2">
            {comparacion.length > 0 ? (
              <div>
                <h3 className="t-tarjeta mb-e2">{nombreMes} contra el mes anterior</h3>
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
                          <td
                            className={'monto !pr-0 ' + (empeora ? 'text-negativo' : 'text-tenue')}
                          >
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

            <div>
              <h3 className="t-tarjeta mb-e2">Meses que cierran en negativo</h3>
              {deficit.length === 0 ? (
                <Vacio icono={CheckCircle2} tono="positivo" titulo="Ninguno" />
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
            </div>
          </div>
        </div>
      </Zona>

      {porRevisar > 0 || sinConciliar > 0 ? (
        <p className="mt-e5 flex flex-wrap gap-x-e5 gap-y-1 text-[12px]">
          {porRevisar > 0 ? (
            <Link href="/movimientos" className="flex items-center gap-1 text-alerta hover:underline">
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
