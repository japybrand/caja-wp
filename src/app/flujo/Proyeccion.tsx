import Link from 'next/link'
import { MESES_CORTOS } from '@/lib/dominio'
import type { Horizonte } from '@/lib/flujo'

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

/**
 * El flujo a lo largo de varios años, de solo lectura.
 *
 * No comparte componente con la grilla editable a propósito. La grilla replica el
 * Excel mes a mes y tiene toda la maquinaria de edición en línea; esta vista
 * responde otra pregunta: cuánto pesa la deuda ya comprometida sobre la caja de
 * aquí a que termine el último convenio. Meterlas en un mismo componente habría
 * significado tocar el cálculo verificado para ganar nada.
 */
export function Proyeccion({ horizonte, anioEditable }: { horizonte: Horizonte; anioEditable: number }) {
  const { columnas, filas, naturalezaPorMes, aniosIncompletos } = horizonte

  const anchoTotal = 260 + columnas.length * 96

  // Dónde cambia el año, para separar visualmente los bloques.
  const inicioDeAnio = new Set(
    columnas.map((c, i) => (i === 0 || columnas[i - 1]?.anio !== c.anio ? i : -1)).filter((i) => i >= 0),
  )

  const saldoFinal = filas.find((f) => f.clave === 'flujo_financiero')?.montos.at(-1) ?? 0
  const ultima = columnas.at(-1)

  return (
    <div className="flex h-[calc(100vh-41px)] flex-col">
      <div className="flex items-center justify-between border-b border-linea px-4 py-2">
        <div>
          <h1 className="text-[14px] font-semibold tracking-tight">
            Proyección {columnas[0]?.anio} – {ultima?.anio}
          </h1>
          <p className="max-w-[95ch] text-[11px] text-tenue">
            Las cuotas de convenio y la cuota Fogape entran solas desde su calendario. Los meses{' '}
            <span className="text-amber-700">proy.</span> no tienen cartola. Los meses{' '}
            <span className="text-slate-500">incompl.</span> no tienen ingresos ni gastos
            operacionales cargados: su saldo es el peso de la deuda comprometida, no un
            pronóstico de caja.
          </p>
        </div>
        <div className="text-right text-[11px] text-tenue">
          <Link href="/flujo" className="text-acento underline underline-offset-2">
            Volver al {anioEditable} editable
          </Link>
          <div className="mt-1">
            Saldo al cerrar {MESES_CORTOS[(ultima?.mes ?? 1) - 1]} {ultima?.anio}
          </div>
          <div className={'cifra text-[13px] ' + (saldoFinal < 0 ? 'negativo' : '')}>
            {clp(saldoFinal)}
          </div>
        </div>
      </div>

      {aniosIncompletos.length > 0 ? (
        <div className="border-b border-linea bg-panel px-4 py-1.5 text-[11px] text-tenue">
          {aniosIncompletos.join(' y ')}{' '}
          {aniosIncompletos.length === 1 ? 'está incompleto' : 'están incompletos'}: solo traen
          servicio de deuda. El saldo que muestran es cuánto hay que generar para cubrirla, no
          lo que quedará en la cuenta.
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="tabla-flujo" style={{ minWidth: anchoTotal }}>
          <thead>
            <tr>
              <th
                className="col-fija px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-tenue"
                style={{ minWidth: 260 }}
              >
                Concepto
              </th>
              {columnas.map((c, i) => {
                const naturaleza = naturalezaPorMes[i]
                return (
                  <th
                    key={`${c.anio}-${c.mes}`}
                    className={
                      'px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-tenue ' +
                      (naturaleza === 'proyectado' ? 'mes-proyectado ' : '') +
                      (naturaleza === 'incompleto' ? 'mes-incompleto ' : '') +
                      (inicioDeAnio.has(i) ? 'corte-anio' : '')
                    }
                    style={{ minWidth: 96 }}
                  >
                    {MESES_CORTOS[c.mes - 1]}
                    <div className="text-[9px] font-normal normal-case">
                      {c.mes === 1 || i === 0 ? (
                        <span className="text-tinta">{c.anio}</span>
                      ) : naturaleza === 'real' ? (
                        'real'
                      ) : naturaleza === 'proyectado' ? (
                        <span className="text-amber-700">proy.</span>
                      ) : (
                        <span className="text-slate-500">incompl.</span>
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => {
              const esEncabezado = fila.tipo === 'encabezado'
              const esResultado = fila.tipo === 'resultado' || fila.tipo === 'saldo'
              const esSubtotal = fila.tipo === 'subtotal'
              return (
                <tr
                  key={fila.clave}
                  className={
                    (esEncabezado ? 'fila-encabezado bg-panel ' : '') +
                    (esSubtotal ? 'fila-subtotal bg-panel font-medium ' : '') +
                    (esResultado ? 'fila-resultado bg-realce font-medium ' : '')
                  }
                >
                  <td
                    className={
                      'col-fija px-3 py-1 text-[12px] ' +
                      (esEncabezado ? 'text-[11px] font-semibold uppercase tracking-wide' : '')
                    }
                  >
                    {fila.etiqueta}
                  </td>
                  {columnas.map((c, i) => {
                    if (esEncabezado) {
                      return (
                        <td
                          key={i}
                          className={inicioDeAnio.has(i) ? 'corte-anio' : ''}
                          aria-hidden
                        />
                      )
                    }
                    const monto = fila.montos[i] ?? 0
                    const naturaleza = naturalezaPorMes[i]
                    const desdeCalendario = fila.origenPorMes?.[i] === 'calendario'
                    return (
                      <td
                        key={i}
                        className={
                          'cifra px-3 py-1 text-right ' +
                          (naturaleza === 'proyectado' ? 'mes-proyectado ' : '') +
                          (naturaleza === 'incompleto' ? 'mes-incompleto ' : '') +
                          (inicioDeAnio.has(i) ? 'corte-anio ' : '') +
                          (monto < 0 ? 'negativo' : '')
                        }
                      >
                        {monto === 0 ? (
                          <span className="text-linea-fuerte">·</span>
                        ) : (
                          <>
                            {clp(monto)}
                            {desdeCalendario ? (
                              <div className="text-[9px] uppercase tracking-wide text-acento">
                                cuota
                              </div>
                            ) : null}
                          </>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
