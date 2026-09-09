import { prisma } from '@/lib/prisma'
import { MESES } from '@/lib/dominio'

/**
 * Detecta cuándo un movimiento repite una deuda ya declarada como compromiso.
 *
 * EL CASO QUE LO ORIGINÓ
 * PayPal mandó un recordatorio de 1.467 USD por los servicios de Juan Pablo Ruiz de
 * agosto. La ingesta creó el movimiento en septiembre, que es cuando llegó el
 * correo. Pero esa misma deuda ya estaba registrada como compromiso en octubre, que
 * es cuando se va a pagar. El resultado fue la misma deuda contada dos veces, en dos
 * meses distintos, inflando septiembre en 1.369.400.
 *
 * POR QUÉ EL ANTI-DUPLICADO DE LA INGESTA NO LO VIO
 * Ese busca dentro del MISMO MES: `where: { proveedorId, anio, mes }`. Sirve para lo
 * que fue pensado —que la primera corrida no vuelva a crear los recibos que ya
 * trajo el Excel— pero un compromiso no está atado al mes en que llega la factura.
 * La factura de agosto puede llegar en septiembre y pagarse en octubre; son tres
 * meses y una sola deuda.
 *
 * POR QUÉ SE COMPARA EN MONEDA DE ORIGEN
 * Los pagos internacionales se declaran en dólares y se convierten a pesos con el
 * tipo de cambio del día. Los dos registros de esta misma deuda quedaron en
 * 1.369.400 y 1.370.912: distintos en pesos, idénticos en dólares. Comparar primero
 * el monto original y la moneda evita depender de una tolerancia.
 */

/** En pesos, dos montos que difieran menos que esto son la misma deuda. */
const TOLERANCIA = 0.02

export interface CompromisoDuplicado {
  id: string
  mes: number
  montoCLP: number
  /** Una frase lista para mostrar, en la bandeja o en el error de confirmación. */
  motivo: string
}

const clp = (n: number): string =>
  '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

/**
 * El compromiso que este movimiento estaría duplicando, si lo hay.
 *
 * Busca en TODO el año y no solo en el mes: es justamente el desfase entre el mes de
 * la factura y el del pago lo que dejó pasar el caso original.
 */
export async function compromisoQueDuplica(movimiento: {
  id?: string
  anio: number
  proveedorId: string | null
  montoCLP: number
  montoOriginal: number | null
  monedaOriginal: string
}): Promise<CompromisoDuplicado | null> {
  if (!movimiento.proveedorId) return null

  const compromisos = await prisma.movimiento.findMany({
    where: {
      fuente: 'compromiso',
      proveedorId: movimiento.proveedorId,
      anio: movimiento.anio,
      ...(movimiento.id ? { id: { not: movimiento.id } } : {}),
    },
    include: { proveedor: { select: { nombre: true } } },
  })

  for (const c of compromisos) {
    const mismaMonedaOrigen =
      movimiento.montoOriginal !== null &&
      c.montoOriginal !== null &&
      c.monedaOriginal === movimiento.monedaOriginal &&
      c.montoOriginal === movimiento.montoOriginal

    const mayor = Math.max(Math.abs(c.montoCLP), Math.abs(movimiento.montoCLP))
    const cercaEnPesos =
      mayor > 0 && Math.abs(c.montoCLP - movimiento.montoCLP) / mayor <= TOLERANCIA

    if (!mismaMonedaOrigen && !cercaEnPesos) continue

    const enMoneda =
      c.montoOriginal !== null && c.monedaOriginal !== 'CLP'
        ? `${c.montoOriginal} ${c.monedaOriginal}`
        : clp(c.montoCLP)
    return {
      id: c.id,
      mes: c.mes,
      montoCLP: c.montoCLP,
      motivo:
        `Ya hay un compromiso declarado con ${c.proveedor?.nombre ?? 'el mismo colaborador'} ` +
        `por ${enMoneda} en ${MESES[c.mes - 1]?.toLowerCase()}` +
        (mismaMonedaOrigen ? ', por el mismo monto en moneda de origen' : '') +
        '. Confirmar este movimiento contaría la misma deuda dos veces.',
    }
  }
  return null
}
