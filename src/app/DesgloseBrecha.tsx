import { ChevronRight } from 'lucide-react'
import type { Panel } from '@/lib/panel'
import { clp } from '@/componentes/ui'

/**
 * El desglose de la brecha del mes, desplegable.
 *
 * POR QUÉ DESPLEGAR Y NO MOSTRAR AL PASAR EL CURSOR
 * Es la cifra principal del panel y hay que poder explicarla a un contador o a un
 * banco. Un tooltip no sirve para eso: desaparece al mover el mouse, no existe en
 * pantalla táctil, no se puede leer con calma ni copiar, y nadie descubre que está
 * ahí. Un `details` nativo se abre con clic o con teclado, queda abierto mientras
 * se lee, funciona en cualquier dispositivo y no necesita JavaScript.
 *
 * Va cerrado por omisión: quien mira el panel de reojo quiere el número, no la
 * aritmética.
 */

function Linea({
  concepto,
  monto,
  signo,
  nota,
  fuerte,
  sangria,
}: {
  concepto: string
  monto: number
  signo?: '+' | '−'
  nota?: string
  fuerte?: boolean
  sangria?: boolean
}) {
  return (
    <tr className={fuerte ? 'font-medium' : ''}>
      <td className={'!pl-0 ' + (sangria ? 'pl-e3 text-claro-tenue' : '')}>
        <span className={sangria ? 'ml-e3' : ''}>{concepto}</span>
        {nota ? <span className="t-apoyo ml-e2 text-claro-suave">{nota}</span> : null}
      </td>
      <td className="monto !pr-0 w-8 text-claro-suave">{signo ?? ''}</td>
      <td className="monto !pr-0">{clp(monto)}</td>
    </tr>
  )
}

export function DesgloseBrecha({ panel }: { panel: Panel }) {
  const { desglose: d, brechaDelMes, nombreMes, mesAMedias } = panel
  const mes = nombreMes.toLowerCase()

  return (
    <details className="group mt-e4 border-t border-acento-linea pt-e3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-claro-tenue transition-colors hover:text-claro [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={13}
          strokeWidth={2}
          className="transition-transform group-open:rotate-90"
        />
        Cómo se calcula
      </summary>

      <div className="mt-e3 max-w-[560px]">
        <table className="tabla">
          <tbody>
            <Linea concepto="Saldo inicial de enero" monto={d.saldoInicial} />
            <Linea
              concepto="Movimientos del banco hasta hoy"
              monto={d.movimientosHastaHoy}
              signo="+"
            />
            <Linea concepto="Tienes hoy" monto={panel.saldoHoy} fuerte />
          </tbody>
        </table>

        <table className="tabla mt-e3">
          <tbody>
            <Linea concepto={`Ingresos de ${mes} según el flujo`} monto={d.ingresosDelMes} />
            <Linea concepto="Ya cobrado este mes" monto={d.yaCobrado} signo="−" />
            <Linea
              concepto="Falta cobrar"
              monto={d.porCobrar}
              fuerte
              nota={d.porCobrarCrudo < 0 ? `da ${clp(d.porCobrarCrudo)}, se corta en cero` : undefined}
            />
          </tbody>
        </table>

        <table className="tabla mt-e3">
          <tbody>
            {d.egresosPorGrupo.map((g) => (
              <Linea key={g.grupo} concepto={g.grupo} monto={g.monto} sangria />
            ))}
            <Linea concepto={`Egresos de ${mes}`} monto={d.egresosDelMes} fuerte />
            <Linea concepto="Ya pagado este mes" monto={d.yaPagado} signo="−" />
            <Linea concepto="Falta pagar" monto={d.porPagar} fuerte />
          </tbody>
        </table>

        <div className="mt-e3 border-t border-acento-linea pt-e3">
          <table className="tabla">
            <tbody>
              <Linea concepto="Tienes hoy" monto={panel.saldoHoy} />
              <Linea concepto="Falta cobrar" monto={d.porCobrar} signo="+" />
              <Linea concepto="Falta pagar" monto={d.porPagar} signo="−" />
              <tr className="font-medium">
                <td className="!pl-0">
                  {brechaDelMes < 0 ? `Te falta para cerrar ${mes}` : `Te queda al cerrar ${mes}`}
                </td>
                <td className="!pr-0 w-8" />
                <td
                  className={
                    'monto !pr-0 ' + (brechaDelMes < 0 ? 'text-negativo-claro' : 'text-positivo-claro')
                  }
                >
                  {clp(Math.abs(brechaDelMes))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="t-apoyo mt-e3 text-claro-suave">
          El saldo de hoy sale del banco, no del flujo. &quot;Ya pagado&quot; es la parte de los
          egresos del mes que ya pasó por la cuenta: se reconoce porque el monto vino de la cartola
          o porque tiene un cargo del banco enlazado. Los gastos marcados como personales no son
          egresos del flujo y quedan fuera de las dos partes.
          {mesAMedias
            ? ` El registro de ventas de ${mes} está a medias, así que "falta cobrar" queda corto y la brecha real será menor.`
            : ''}
        </p>
      </div>
    </details>
  )
}
