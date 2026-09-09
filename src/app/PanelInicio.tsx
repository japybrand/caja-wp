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
import { DesgloseBrecha } from './DesgloseBrecha'
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
    totalComprometido,
    totalPagadoDeuda,
    cuotaFijaMensual,
    hasta,
    barras,
    deficit,
    comparacion,
    porRevisar,
    sinConciliar,
  } = panel


  const avanceTotal =
    totalComprometido === 0 ? 0 : Math.round((totalPagadoDeuda / totalComprometido) * 100)
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
        <div className="grid gap-e5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-e6">
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
            <span className="cifra text-[12.5px] text-claro-tenue">
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

        <DesgloseBrecha panel={panel} />
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
        <div className="grid gap-e3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
              valor={clp(totalProximos - totalAtrasado)}
              explica={
                totalAtrasado > 0
                  ? `vence en los próximos ${DIAS_VENTANA} días, sin contar lo atrasado`
                  : `vence en los próximos ${DIAS_VENTANA} días`
              }
            />
            {proximos.length > 0 ? (
              <div className="mt-e3 border-t border-urgente-linea pt-e2">
                <ListaVencimientos items={proximos} />
              </div>
            ) : (
              <Vacio icono={CheckCircle2} titulo="Nada vence en 15 días" />
            )}
            {totalAtrasado > 0 ? (
              <p className="t-apoyo mt-e3 border-t border-urgente-linea pt-e3">
                Con lo atrasado son {clp(totalProximos)} en total.
              </p>
            ) : null}
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
        <div className="grid gap-e3 lg:grid-cols-[repeat(3,minmax(0,1fr))]">
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
                    <span className="min-w-0 truncate text-[12.5px]">{c.concepto}</span>
                    <span className="cifra shrink-0 text-[12.5px] whitespace-nowrap">
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
            {/*
              QUÉ FALTA ARRIBA, CUÁNTO SE AVANZÓ ABAJO
              El saldo solo cuenta la mitad de la historia: 28 millones de convenio
              suenan igual el primer mes que el décimo. Pero el dato que se busca al
              mirar esta tarjeta sigue siendo cuánto falta, así que el avance va como
              contexto y no como una segunda cifra que compita por el espacio.

              Sin tabla, a propósito. La tarjeta ocupa un tercio del ancho de la
              página —unos 300 px— y cuatro columnas de montos no caben ahí: los
              nombres se partían en tres líneas y la tabla desbordaba la tarjeta. Dos
              filas por compromiso entran holgadas y es el mismo patrón que ya usa
              "Qué te cuesta más" al lado.
            */}
            <Cifra
              valor={clp(totalDeuda)}
              explica={`${avanceTotal}% ya pagado de ${clp(totalComprometido)} comprometidos`}
            />
            <div className="mt-e3">
              <Barra porcentaje={avanceTotal} />
            </div>

            <div className="mt-e4 space-y-e3 border-t border-linea pt-e4">
              {deudas.map((d, i) => (
                <div key={i}>
                  <div className="mb-1 flex items-baseline justify-between gap-e2">
                    <span className="min-w-0 truncate text-[12.5px]">{d.quien}</span>
                    <span
                      className={
                        'cifra shrink-0 text-[12.5px] whitespace-nowrap ' +
                        (d.atrasado ? 'text-negativo' : '')
                      }
                    >
                      {clp(d.monto)}
                    </span>
                  </div>
                  <Barra porcentaje={d.avance} />
                  <div className="t-apoyo mt-1 flex justify-between gap-e2">
                    <span className="min-w-0 truncate">
                      {d.conCalendario
                        ? `${clp(d.pagado)} de ${clp(d.total)}`
                        : 'sin historial de cuotas'}
                    </span>
                    <span className="shrink-0">
                      {d.conCalendario ? `${d.avance}% · ` : ''}
                      {d.detalle}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <p className="t-apoyo mt-e4 border-t border-linea pt-e3">
              Llevas {clp(totalPagadoDeuda)} pagados. Cada mes se van{' '}
              {clp(cuotaFijaMensual)} solo en cuotas.
            </p>
          </Tarjeta>
        </div>
      </Zona>

      {/* ═══ 4. El detalle ════════════════════════════════════════════════ */}
      <Zona titulo="El detalle" nota="para cuando quieras profundizar">
        <div className="zona-detalle pt-e4">
          {/* El gráfico y la comparación van juntos: la comparación explica el
              último tramo de la curva, y sola dejaba media columna vacía. */}
          <div className="grid gap-e5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <h3 className="t-tarjeta">Ingresos y egresos por mes</h3>
              <p className="t-apoyo mt-1 mb-e3 max-w-[70ch]">
                La línea es el saldo acumulado del flujo, que mide la brecha entre lo comprometido
                y lo que entró. No es el saldo de la cuenta.
              </p>
              <Grafico barras={barras} />
            </div>

            {comparacion.length > 0 ? (
              <div>
                <h3 className="t-tarjeta">{nombreMes} contra el mes anterior</h3>
                <p className="t-apoyo mt-1 mb-e3">Cómo se movió el último tramo.</p>
                <table className="tabla">
                  <tbody>
                    {comparacion.map((c) => {
                      const empeora =
                        c.variacion !== null && (c.masEsPeor ? c.variacion > 0 : c.variacion < 0)
                      return (
                        <tr key={c.concepto}>
                          <td className="!pl-0">
                            <div>{c.concepto}</div>
                            <div className="t-apoyo">antes {clp(c.anterior)}</div>
                          </td>
                          <td className="monto !pr-0">
                            <div>{clp(c.actual)}</div>
                            <div
                              className={'t-apoyo ' + (empeora ? 'text-negativo' : 'text-tenue')}
                            >
                              {c.variacion === null
                                ? '—'
                                : `${c.variacion > 0 ? '+' : ''}${c.variacion.toFixed(0)}%`}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          {/* Doce meses en una tabla vertical ocupaban una columna entera. En
              cuadrícula se leen de un vistazo y ocupan tres líneas. */}
          <div className="mt-e5">
            <h3 className="t-tarjeta">Meses que cierran en negativo</h3>
            <p className="t-apoyo mt-1 mb-e3">
              El saldo acumulado al cierre de cada mes, no el déficit del mes solo.
            </p>
            {deficit.length === 0 ? (
              <Vacio icono={CheckCircle2} tono="positivo" titulo="Ninguno cierra en negativo" />
            ) : (
              <div className="grid grid-cols-2 gap-x-e5 gap-y-e2 sm:grid-cols-3 lg:grid-cols-6">
                {deficit.map((d) => (
                  <div key={d.mes} className="border-t border-linea pt-e2">
                    <div className="flex items-baseline justify-between gap-e2">
                      <span className="text-[12.5px]">{d.mes}</span>
                      {d.naturaleza === 'real' ? null : (
                        <span className="t-apoyo text-alerta">
                          {d.naturaleza === 'incompleto' ? 'incompl.' : 'proy.'}
                        </span>
                      )}
                    </div>
                    <div className="cifra t-tarjeta mt-0.5 font-normal text-negativo">{clp(d.saldo)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Zona>

      {porRevisar > 0 || sinConciliar > 0 ? (
        <p className="mt-e5 flex flex-wrap gap-x-e5 gap-y-1 text-[12.5px]">
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
