import { AlertTriangle, CalendarDays, CheckCircle2, FileText, Landmark, Users } from 'lucide-react'
import type { EstadoObligaciones } from '@/lib/obligaciones'
import { tipoObligacion } from '@/lib/dominio'
import { Barra, Cifra, Marca, Pagina, Tarjeta, Vacio, clp } from '@/componentes/ui'
import { TablaF29 } from './TablaF29'
import { PendientesDePago } from './PendientesDePago'



export function PanelObligaciones({
  estado,
  hoy,
}: {
  estado: EstadoObligaciones
  hoy: { anio: number; mes: number }
}) {
  const { obligaciones, calendario, cotizaciones, totales, cotizacionesAtrasadas } = estado
  const { compromisos, totalCompromisos, f29, totalF29 } = estado
  const anioF29 = f29[0]?.anioPeriodo ?? new Date().getFullYear()

  /**
   * Cuánto se lleva pagado de una obligación, en porcentaje.
   *
   * Se calcula sobre el total comprometido, no sobre las cuotas emitidas: las que
   * la institución todavía no emite son parte del compromiso igual, y dejarlas
   * fuera inflaría el avance de los convenios largos.
   */
  const avance = (o: { totalComprometido: number; saldo: number }): number =>
    o.totalComprometido === 0
      ? 0
      : Math.round(((o.totalComprometido - o.saldo) / o.totalComprometido) * 100)
  const comprometidoTotal = totales.pagado + totales.pendiente + totales.porGenerar
  const avanceTotal =
    comprometidoTotal === 0 ? 0 : Math.round((totales.pagado / comprometidoTotal) * 100)
  const f29Incompletos = f29.filter((f) => !f.completo || f.sinDesglosar > 0).length

  return (
    <Pagina
      titulo="Obligaciones"
      bajada="Convenios de la Tesorería, línea Fogape, Formulario 29 y cotizaciones previsionales"
    >
      {/* ═══ El estado de la deuda, en la superficie de tinta ════════════ */}
      <Tarjeta variante="principal">
        <div className="grid grid-cols-2 gap-e5 sm:grid-cols-4">
          <Cifra rotulo="Pendiente" valor={clp(totales.pendiente)} tono="negativo" inverso />
          <Cifra rotulo="Ya pagado" valor={clp(totales.pagado)} inverso />
          <Cifra rotulo="Cuotas por generar" valor={clp(totales.porGenerar)} inverso />
          <Cifra
            rotulo="Mes más pesado"
            valor={totales.peak ? clp(totales.peak.monto) : '—'}
            tono="alerta"
            inverso
          />
        </div>
        {totales.peak ? (
          <p className="t-apoyo mt-e5 border-t border-acento-linea pt-e3 text-claro-tenue">
            El mes más pesado es {totales.peak.etiqueta}, con {clp(totales.peak.monto)} solo en
            cuotas. Esa plata sale pase lo que pase.
          </p>
        ) : null}
      </Tarjeta>

      <div className="mt-e5 grid gap-e3">
        {/* Lo primero después del estado: lo que hay que pagar ahora y se puede
            dar por pagado sin esperar a la cartola. */}
        <PendientesDePago estado={estado} hoy={hoy} />

        {cotizacionesAtrasadas > 0 ? (
          <Tarjeta titulo="Atención" icono={AlertTriangle} tono="negativo">
            <p className="text-[12.5px]">
              <span className="font-medium text-negativo">
                {cotizacionesAtrasadas === 1
                  ? '1 cotización previsional atrasada'
                  : `${cotizacionesAtrasadas} cotizaciones previsionales atrasadas`}
                .
              </span>{' '}
              <span className="text-tenue">
                Las cotizaciones no están dentro de ningún convenio: se pagan mes a mes.
              </span>
            </p>
          </Tarjeta>
        ) : null}

        {/* ── Compromisos vigentes ─────────────────────────────────────────── */}
        <Tarjeta titulo="Compromisos vigentes" icono={Landmark}>
          <div className="-mx-4 overflow-x-auto">
            <table className="tabla tabla-interactiva min-w-[820px]">
              <thead>
                <tr>
                  <th>Obligación</th>
                  <th>Marco</th>
                  <th>Activado</th>
                  <th className="!text-right">Cuota</th>
                  <th className="!text-right">Total</th>
                  <th className="!text-right">Pagado</th>
                  <th className="!text-right">Falta</th>
                  <th>Avance</th>
                  <th>Última</th>
                </tr>
              </thead>
              <tbody>
                {obligaciones.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <span className="font-medium">
                        {o.institucion} {o.numero}
                      </span>
                      <span className="ml-2 text-[11.5px] text-suave">
                        {tipoObligacion(o.tipo).etiqueta}
                      </span>
                    </td>
                    <td className="text-tenue">{o.marco}</td>
                    <td className="cifra text-tenue">{o.fechaActivacion}</td>
                    <td className="monto">{clp(o.cuotaMensual)}</td>
                    <td className="monto text-tenue">{clp(o.totalComprometido)}</td>
                    <td className="monto text-tenue">
                      {clp(o.totalComprometido - o.saldo)}
                      <div className="t-apoyo">{o.pagadas} cuotas</div>
                    </td>
                    <td className="monto font-medium text-negativo">
                      {clp(o.saldo)}
                      <div className="t-apoyo !text-tenue">
                        {o.pendientes} cuotas
                        {o.porGenerar > 0 ? ` +${o.porGenerar} por generar` : ''}
                      </div>
                    </td>
                    {/* La barra pesa más que el porcentaje solo: cinco obligaciones
                        con avances distintos se comparan de un vistazo, y el número
                        exacto queda al lado para quien lo necesite. */}
                    <td className="w-[110px]">
                      <Barra porcentaje={avance(o)} />
                      <div className="t-apoyo mt-1">{avance(o)}%</div>
                    </td>
                    <td className="cifra text-tenue">
                      {o.ultimoMes
                        ? `${String(o.ultimoMes.mes).padStart(2, '0')}/${o.ultimoMes.anio}`
                        : '—'}
                    </td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td colSpan={3}>Todas las obligaciones</td>
                  <td className="monto">{clp(totales.pagado + totales.pendiente + totales.porGenerar)}</td>
                  <td className="monto">{clp(totales.pagado)}</td>
                  <td className="monto text-negativo">
                    {clp(totales.pendiente + totales.porGenerar)}
                  </td>
                  <td className="w-[110px]">
                    <Barra porcentaje={avanceTotal} />
                    <div className="t-apoyo mt-1">{avanceTotal}%</div>
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </Tarjeta>

        {/* ── Calendario ───────────────────────────────────────────────────── */}
        <Tarjeta
          titulo="Calendario de cuotas"
          icono={CalendarDays}
          bajada="Lo que hay que pagar cada mes por deuda comprometida, sin contar cotizaciones ni operación. Los meses en gris ya pasaron."
        >
          <div className="-mx-4 overflow-x-auto">
            <table className="tabla min-w-[720px]">
              <thead>
                <tr>
                  <th>Mes</th>
                  {obligaciones.map((o) => (
                    <th key={o.id} className="!text-right">
                      {o.numero}
                    </th>
                  ))}
                  <th className="!text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {calendario.map((c) => {
                  const esPeak = totales.peak !== null && c.total === totales.peak.monto
                  return (
                    <tr key={`${c.anio}-${c.mes}`} className={c.pasado ? 'text-suave' : ''}>
                      <td className={c.pasado ? 'text-suave' : ''}>{c.etiqueta}</td>
                      {c.montos.map((m, i) => (
                        <td key={i} className="monto">
                          {m === 0 ? <span className="text-linea-fuerte">·</span> : clp(m)}
                        </td>
                      ))}
                      <td
                        className={
                          'monto font-medium ' + (esPeak && !c.pasado ? 'text-alerta' : '')
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
        </Tarjeta>

        {/* ── Deuda con colaboradores ──────────────────────────────────────── */}
        {compromisos.length > 0 ? (
          <Tarjeta
            titulo="Deuda con colaboradores"
            icono={Users}
            bajada="Deuda declarada, no calculada. Las planillas son fuente confiable de cuánto se facturó, no de qué quedó pagado: sus estados de pago arrastran meses ya regularizados."
          >
            <div className="-mx-4 overflow-x-auto">
              <table className="tabla min-w-[560px]">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Concepto</th>
                    <th className="!text-right">USD</th>
                    <th className="!text-right">CLP</th>
                    <th>Sale en</th>
                  </tr>
                </thead>
                <tbody>
                  {compromisos.map((c, i) => (
                    <tr key={i}>
                      <td className="font-medium">{c.colaborador}</td>
                      <td className="text-tenue">{c.descripcion}</td>
                      <td className="monto">
                        {c.usd === null ? '—' : c.usd.toLocaleString('es-CL')}
                      </td>
                      <td className="monto text-negativo">{clp(c.montoCLP)}</td>
                      <td className="cifra text-tenue">
                        {String(c.mes).padStart(2, '0')}/{c.anio}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td colSpan={3}>Total comprometido</td>
                    <td className="monto text-negativo">{clp(totalCompromisos)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </Tarjeta>
        ) : null}

        {/* ── Formulario 29 ────────────────────────────────────────────────── */}
        <Tarjeta
          titulo="Formulario 29"
          icono={FileText}
          tono={f29Incompletos > 0 ? 'alerta' : 'neutro'}
          bajada="La declaración mensual de impuestos. Vence el día 20 del mes siguiente al período. El IVA se calcula desde el SII; el resto lo informa tu contador."
        >
          {f29.length === 0 ? (
            <Vacio
              icono={FileText}
              tono="alerta"
              titulo="Sin períodos cargados"
              detalle="Carga los registros de compras y ventas del SII para calcular el IVA."
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-8 gap-y-2">
                <div>
                  <div className="rotulo">Total del año</div>
                  <div className="t-cifra mt-e2">
                    {clp(totalF29)}
                  </div>
                </div>
                {f29Incompletos > 0 ? (
                  <p className="text-[12.5px] text-alerta">
                    {f29Incompletos === 1
                      ? '1 período sin el formulario completo'
                      : `${f29Incompletos} períodos sin el formulario completo`}
                    : ahí el monto es solo el IVA o falta desglosar el total.
                  </p>
                ) : null}
              </div>
              <TablaF29 filas={f29} anio={anioF29} />
            </>
          )}
        </Tarjeta>

        {/* ── Cotizaciones ─────────────────────────────────────────────────── */}
        <Tarjeta
          titulo="Cotizaciones previsionales"
          icono={cotizacionesAtrasadas > 0 ? AlertTriangle : CheckCircle2}
          tono={cotizacionesAtrasadas > 0 ? 'negativo' : 'neutro'}
          bajada="El período es el mes que se cotiza, no el mes en que se paga. Vencen el 13 del mes siguiente. Banco es lo que salió de la cuenta y certificado lo que Previred certifica por Felipe Molina."
          pie={
            cotizaciones.some((c) => c.nota !== '')
              ? 'De enero a octubre de 2025 no hay cartola cargada, así que ahí la columna Banco muestra lo certificado y no el cargo real, que además incluía a Cristián Andrés.'
              : undefined
          }
        >
          {cotizaciones.length === 0 ? (
            <Vacio
              icono={CalendarDays}
              tono="alerta"
              titulo="Sin cotizaciones cargadas"
              detalle="Corre el cargador de obligaciones para traerlas desde el certificado de Previred."
            />
          ) : (
            <div className="-mx-4 overflow-x-auto">
              <table className="tabla min-w-[700px]">
                <thead>
                  <tr>
                    <th>Período</th>
                    <th className="!text-right">Banco</th>
                    <th className="!text-right">Certificado</th>
                    <th className="!text-right">Resto</th>
                    <th>Estado</th>
                    <th>Pagada el</th>
                    <th className="!text-right">Atraso</th>
                  </tr>
                </thead>
                <tbody>
                  {cotizaciones.map((c) => (
                    <tr key={`${c.anio}-${c.mes}`}>
                      <td>{c.etiqueta}</td>
                      <td className="monto">{clp(c.monto)}</td>
                      <td className="monto text-tenue">
                        {c.montoCertificado > 0 ? clp(c.montoCertificado) : '—'}
                      </td>
                      <td className="monto text-tenue">{c.resto > 0 ? clp(c.resto) : '—'}</td>
                      <td>
                        {c.estado === 'pagada' ? (
                          <Marca tono="positivo">Pagada</Marca>
                        ) : c.estado === 'atrasada' ? (
                          <Marca tono="negativo">Atrasada</Marca>
                        ) : (
                          <Marca tono="alerta">
                            Pendiente{c.fechaVencimiento ? ` · vence ${c.fechaVencimiento}` : ''}
                          </Marca>
                        )}
                      </td>
                      <td className="cifra text-tenue">{c.fechaPago ?? '—'}</td>
                      <td className="monto">
                        {c.diasDeAtraso === null ? (
                          <span className="text-linea-fuerte">·</span>
                        ) : c.diasDeAtraso === 0 ? (
                          <span className="text-[11.5px] text-positivo">al día</span>
                        ) : (
                          <span className={c.diasDeAtraso >= 60 ? 'text-negativo' : 'text-tenue'}>
                            {c.diasDeAtraso} d
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Tarjeta>
      </div>
    </Pagina>
  )
}
