import { ChevronRight } from 'lucide-react'
import type { GrupoEgreso, LineaEgreso, Panel } from '@/lib/panel'
import { clp, fechaEnPalabras } from '@/componentes/ui'

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
 * POR QUÉ TRES COLUMNAS Y NO UN DESCUENTO GLOBAL
 * Antes los egresos se listaban por grupo y "ya pagado" era una sola resta al final.
 * Ese formato no se puede verificar: la línea de proveedores mostraba 3.434.813
 * enteros aunque AWS ya estuviera pagado, y no había forma de saber si el descuento
 * global lo incluía o no. Con egreso, pagado y falta en cada fila —y el detalle por
 * proveedor abriendo la fila— el número se comprueba leyendo, sin abrir el código.
 */

/**
 * Concepto a la izquierda, tres montos a la derecha. Los cuatro niveles se alinean.
 *
 * Las tres columnas de monto son fijas —6,5rem cada una— para que grupo, categoría y
 * proveedor queden en la misma vertical. Eso hace que el bloque tenga un ancho mínimo
 * y no quepa en un teléfono, así que va dentro de un contenedor que hace scroll
 * horizontal por su cuenta. Encoger las columnas habría sido peor: los montos se
 * partirían en dos líneas y se perdería la alineación, que es lo único que hace
 * verificable el desglose.
 */
const REJILLA = 'grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_6.5rem] items-baseline gap-x-e2'

/** Ancho bajo el cual las columnas de monto ya no alcanzan. */
const ANCHO_MINIMO = 'min-w-[420px]'

/** Un cero se lee como dato; un punto se lee como "aquí no queda nada". */
function Monto({ valor, apagado }: { valor: number; apagado?: boolean }) {
  if (valor === 0) return <span className="monto text-claro-suave">·</span>
  return <span className={'monto ' + (apagado ? 'text-claro-tenue' : '')}>{clp(valor)}</span>
}

function Celdas({ linea }: { linea: LineaEgreso }) {
  return (
    <>
      <Monto valor={linea.egreso} />
      <div>
        <Monto valor={linea.pagado} apagado />
        {/*
          Lo declarado va debajo de lo pagado y no sumado a ello. Una declaración
          dice que la plata salió, pero el saldo de la cuenta todavía la incluye:
          descontarla de "falta" bajaría el número sobre una plata que igual va a
          salir. Se ve, y no mueve nada.
        */}
        {linea.declarado > 0 ? (
          <div className="t-apoyo text-right !text-alerta-claro">
            +{clp(linea.declarado)} declarado
          </div>
        ) : null}
      </div>
      <Monto valor={linea.falta} />
    </>
  )
}

/** Una categoría sin detalle, o una línea de detalle por proveedor o por persona. */
function Fila({ linea, sangria }: { linea: LineaEgreso; sangria: number }) {
  return (
    <div className={REJILLA + ' py-0.5'}>
      <span className={'truncate ' + (sangria === 2 ? 'text-claro-suave' : 'text-claro-tenue')}>
        <span style={{ paddingLeft: sangria * 12 }}>{linea.nombre}</span>
      </span>
      <Celdas linea={linea} />
    </div>
  )
}

/**
 * Categoría con detalle, desplegable.
 *
 * Es el mismo gesto que la grilla de /flujo: la fila se abre y muestra quién la
 * compone. Allá responde qué proveedor pesa; acá, cuál ya se pagó.
 */
function Categoria({ linea }: { linea: GrupoEgreso['categorias'][number] }) {
  if (linea.detalle.length === 0) return <Fila linea={linea} sangria={1} />
  return (
    <details className="group/cat">
      <summary
        className={
          REJILLA +
          ' cursor-pointer list-none py-0.5 text-claro-tenue transition-colors' +
          ' hover:text-claro [&::-webkit-details-marker]:hidden'
        }
      >
        <span className="flex min-w-0 items-center gap-1 pl-e3">
          <ChevronRight
            size={12}
            strokeWidth={2}
            className="shrink-0 text-claro-suave transition-transform group-open/cat:rotate-90"
          />
          <span className="truncate">{linea.nombre}</span>
          <span className="t-apoyo shrink-0 text-claro-suave">({linea.detalle.length})</span>
        </span>
        <Celdas linea={linea} />
      </summary>
      <div className="mb-e2">
        {linea.detalle.map((d) => (
          <Fila key={d.clave} linea={d} sangria={2} />
        ))}
      </div>
    </details>
  )
}

function Grupo({ grupo }: { grupo: GrupoEgreso }) {
  return (
    <div className="border-t border-acento-linea py-e2 first:border-t-0 first:pt-0">
      <div className={REJILLA + ' font-medium'}>
        <span className="truncate">{grupo.nombre}</span>
        <Celdas linea={grupo} />
      </div>
      <div className="mt-0.5">
        {grupo.categorias.map((c) => (
          <Categoria key={c.clave} linea={c} />
        ))}
      </div>
    </div>
  )
}

function Linea({
  concepto,
  monto,
  signo,
  nota,
  fuerte,
}: {
  concepto: string
  monto: number
  signo?: '+' | '−'
  nota?: string
  fuerte?: boolean
}) {
  return (
    <tr className={fuerte ? 'font-medium' : ''}>
      <td className="!pl-0">
        {concepto}
        {nota ? <span className="t-apoyo ml-e2 text-claro-suave">{nota}</span> : null}
      </td>
      <td className="monto !pr-0 w-8 text-claro-suave">{signo ?? ''}</td>
      <td className="monto !pr-0">{clp(monto)}</td>
    </tr>
  )
}

export function DesgloseBrecha({ panel }: { panel: Panel }) {
  const { desglose: d, brechaDelMes, nombreMes, mesAMedias, fechaSaldo } = panel
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

      <div className="mt-e3 max-w-[700px]">
        <table className="tabla">
          <tbody>
            <Linea concepto="Saldo inicial de enero" monto={d.saldoInicial} />
            {/*
              La fecha real y no "hoy". La suma llega hasta el último movimiento
              cargado, no hasta el día de hoy, y decir "hoy" no era una imprecisión
              de redacción: hacía creer que la cartola estaba al día. Con dos días
              de desfase la diferencia es invisible; con veinte, el saldo se lee como
              actual cuando no lo es.
            */}
            <Linea
              concepto={
                fechaSaldo
                  ? `Movimientos del banco hasta el ${fechaEnPalabras(fechaSaldo)}`
                  : 'Movimientos del banco cargados'
              }
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
              nota={
                d.porCobrarCrudo < 0 ? `da ${clp(d.porCobrarCrudo)}, se corta en cero` : undefined
              }
            />
          </tbody>
        </table>

        {/* Los egresos, con las tres columnas en cada nivel. */}
        <div className="mt-e5 overflow-x-auto">
          <div
            className={
              REJILLA + ` ${ANCHO_MINIMO} t-rotulo border-b border-acento-linea pb-e2 !text-claro-suave`
            }
          >
            <span>Egresos de {mes}</span>
            <span className="monto">Del mes</span>
            <span className="monto">Ya pagado</span>
            <span className="monto">Falta</span>
          </div>
          <div className={`mt-e2 ${ANCHO_MINIMO} text-[12.5px]`}>
            {d.egresos.map((g) => (
              <Grupo key={g.clave} grupo={g} />
            ))}
          </div>
          <div
            className={
              REJILLA + ` ${ANCHO_MINIMO} border-t border-acento-linea pt-e2 text-[12.5px] font-medium`
            }
          >
            <span>Total de {mes}</span>
            <Monto valor={d.egresosDelMes} />
            <div>
              <Monto valor={d.yaPagado} />
              {d.declarado > 0 ? (
                <div className="t-apoyo text-right !text-alerta-claro">
                  +{clp(d.declarado)} declarado
                </div>
              ) : null}
            </div>
            <Monto valor={d.egresosDelMes - d.yaPagado} />
          </div>
        </div>

        <div className="mt-e5 border-t border-acento-linea pt-e3">
          <table className="tabla">
            <tbody>
              <Linea concepto="Tienes hoy" monto={panel.saldoHoy} />
              <Linea concepto="Falta cobrar" monto={d.porCobrar} signo="+" />
              <Linea
                concepto="Falta pagar"
                monto={d.porPagar}
                signo="−"
                nota={d.egresosDelMes - d.yaPagado < 0 ? 'da negativo, se corta en cero' : undefined}
              />
              <tr className="font-medium">
                <td className="!pl-0">
                  {brechaDelMes < 0 ? `Te falta para cerrar ${mes}` : `Te queda al cerrar ${mes}`}
                </td>
                <td className="!pr-0 w-8" />
                <td
                  className={
                    'monto !pr-0 ' +
                    (brechaDelMes < 0 ? 'text-negativo-claro' : 'text-positivo-claro')
                  }
                >
                  {clp(Math.abs(brechaDelMes))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="t-apoyo mt-e3 max-w-[80ch] text-claro-suave">
          El saldo de hoy sale del banco, no del flujo. &quot;Ya pagado&quot; es la parte de los
          egresos del mes que ya pasó por la cuenta: se reconoce porque el monto vino de la cartola
          o porque tiene un cargo del banco enlazado. Los gastos marcados como personales no son
          egresos del flujo y quedan fuera de las dos partes.
          {d.declarado > 0
            ? ` Los ${clp(d.declarado)} marcados como declarados son pagos que registraste a mano y que el banco todavía no muestra: siguen contando como "falta pagar" porque esa plata sigue en la cuenta, y descontarla la contaría dos veces. Cuando el cargo aparezca en la cartola, la conciliación los enlaza y pasan a "ya pagado" solos.`
            : ''}
          {fechaSaldo
            ? ` La cartola llega al ${fechaEnPalabras(fechaSaldo)}: lo que se cobre después de esa fecha todavía no existe en el banco y aparece entero en "falta", aunque sea un cargo automático que nunca ha dejado de llegar.`
            : ''}
          {mesAMedias
            ? ` El registro de ventas de ${mes} está a medias, así que "falta cobrar" queda corto y la brecha real será menor.`
            : ''}
        </p>
      </div>
    </details>
  )
}
