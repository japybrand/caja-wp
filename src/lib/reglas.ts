import { normalizarTexto } from './banco/glosa'

/**
 * Motor de reglas de clasificación.
 *
 * Un mismo texto del banco puede corresponder a cosas contablemente distintas: la
 * transferencia a MOLINA OVALLE por 1.500.000 es remuneración y la de 1.000.000 es
 * retiro, y el banco las describe igual. El monto desempata.
 *
 * Precedencia:
 *   1. Regla con `montoExacto` que coincide. Entre varias, gana el patrón más largo.
 *   2. Regla del mismo patrón sin monto (vale para cualquier monto).
 *   3. Si el patrón calza pero no hay ni monto que coincida ni regla general, el
 *      cargo queda SIN CONCILIAR para que lo decida una persona.
 */

export interface ReglaEvaluable {
  id: string
  patron: string
  /** Valor absoluto en pesos. Null = vale para cualquier monto que calce el patrón. */
  montoExacto: number | null
  categoriaId: string
  proveedorId: string | null
  nota: string
  activa: boolean
}

export type ResultadoRegla =
  | {
      tipo: 'calce'
      regla: ReglaEvaluable
      /** 'monto' es más específico que 'patron'. */
      especificidad: 'monto' | 'patron'
    }
  | {
      /**
       * El patrón calza pero ninguna regla cubre este monto, y no hay regla general.
       * A propósito no se adivina: el cargo queda para que lo resuelva una persona.
       */
      tipo: 'monto_sin_regla'
      reglas: ReglaEvaluable[]
    }
  | { tipo: 'sin_calce' }

/**
 * El monto se compara en valor absoluto. En la cartola los cargos son negativos,
 * pero una regla se escribe con el monto tal como se piensa ("la de 1.500.000"),
 * y la dirección la implica la categoría.
 */
function coincideMonto(montoExacto: number, monto: number): boolean {
  return Math.abs(montoExacto) === Math.abs(monto)
}

function calzaPatron(descripcion: string, patron: string): boolean {
  const d = normalizarTexto(descripcion)
  const p = normalizarTexto(patron)
  return p.length > 0 && d.includes(p)
}

export function evaluarReglas(
  descripcion: string,
  monto: number,
  reglas: ReglaEvaluable[],
): ResultadoRegla {
  const candidatas = reglas.filter((r) => r.activa && calzaPatron(descripcion, r.patron))
  if (candidatas.length === 0) return { tipo: 'sin_calce' }

  // Entre varias con monto que coincide, gana el patrón más largo: es el más específico.
  const porMonto = candidatas
    .filter((r) => r.montoExacto !== null && coincideMonto(r.montoExacto, monto))
    .sort((a, b) => b.patron.length - a.patron.length)
  const ganadoraMonto = porMonto[0]
  if (ganadoraMonto) return { tipo: 'calce', regla: ganadoraMonto, especificidad: 'monto' }

  const generales = candidatas
    .filter((r) => r.montoExacto === null)
    .sort((a, b) => b.patron.length - a.patron.length)
  const ganadoraGeneral = generales[0]
  if (ganadoraGeneral) return { tipo: 'calce', regla: ganadoraGeneral, especificidad: 'patron' }

  // Quedan solo reglas con monto que no coincide: no se elige ninguna.
  return { tipo: 'monto_sin_regla', reglas: candidatas }
}

/** Texto corto para explicar en la interfaz por qué se clasificó así. */
export function explicarResultado(resultado: ResultadoRegla): string {
  switch (resultado.tipo) {
    case 'calce':
      return resultado.especificidad === 'monto'
        ? `regla "${resultado.regla.patron}" con monto exacto ${resultado.regla.montoExacto?.toLocaleString('es-CL')}`
        : `regla "${resultado.regla.patron}" (cualquier monto)`
    case 'monto_sin_regla':
      return (
        `el patrón "${resultado.reglas[0]?.patron ?? ''}" calza, pero ninguna regla cubre este monto ` +
        `(hay reglas para ${resultado.reglas
          .map((r) => r.montoExacto?.toLocaleString('es-CL'))
          .filter(Boolean)
          .join(', ')})`
      )
    case 'sin_calce':
      return 'ninguna regla calza'
  }
}
