import { prisma } from '@/lib/prisma'
import { signo } from './ventas'
import { signoCompra } from './compras'

/**
 * IVA mensual calculado desde los registros del SII.
 *
 * Debito fiscal (el IVA que se le cobro a los clientes) menos credito fiscal (el
 * que cobraron los proveedores). Si el credito supera al debito no se devuelve
 * plata: queda un REMANENTE que se arrastra y baja lo que se paga el mes siguiente.
 *
 * En 2026 nunca ocurrio —el debito supero al credito los nueve meses— pero la
 * logica esta igual: sin ella, el primer mes con remanente mostraria un pago que no
 * corresponde.
 *
 * EL PERIODO Y EL MES DE PAGO NO SON EL MISMO
 * El F29 de un periodo se declara y paga hasta el dia 20 del mes siguiente. El IVA
 * de agosto se paga en septiembre. Por eso `mesDePago` va aparte de `mes`: el flujo
 * necesita el mes en que sale la plata, no el periodo que se declara.
 */

export interface IvaDelMes {
  anio: number
  mes: number
  /** IVA cobrado a los clientes. */
  debito: number
  /** IVA pagado a los proveedores, descontable. */
  credito: number
  /** Remanente que venia del mes anterior. */
  remanenteAnterior: number
  /** Lo que efectivamente hay que pagar. Nunca negativo. */
  aPagar: number
  /** Lo que queda a favor para el mes siguiente. */
  remanente: number
  /** Cuando vence el F29 de este periodo. */
  venceEl: string
  /** Mes en que sale la plata: el siguiente al periodo. */
  mesDePago: { anio: number; mes: number }
  /** false cuando falta cargar alguno de los dos registros. */
  completo: boolean
  documentosVenta: number
  documentosCompra: number
}

/** El F29 se declara y paga hasta el dia 20 del mes siguiente al periodo. */
const DIA_VENCIMIENTO = 20

export async function ivaPorMes(anio: number): Promise<IvaDelMes[]> {
  const [ventas, compras] = await Promise.all([
    prisma.documentoVenta.findMany({
      where: { anio },
      select: { mes: true, tipoDocumento: true, montoIVA: true },
    }),
    prisma.documentoCompra.findMany({
      where: { anio },
      select: { mes: true, tipoDocumento: true, montoIVARecuperable: true },
    }),
  ])

  const debito = new Map<number, number>()
  const nVentas = new Map<number, number>()
  for (const v of ventas) {
    debito.set(v.mes, (debito.get(v.mes) ?? 0) + signo(v.tipoDocumento) * v.montoIVA)
    nVentas.set(v.mes, (nVentas.get(v.mes) ?? 0) + 1)
  }

  const credito = new Map<number, number>()
  const nCompras = new Map<number, number>()
  for (const c of compras) {
    credito.set(
      c.mes,
      (credito.get(c.mes) ?? 0) + signoCompra(c.tipoDocumento) * c.montoIVARecuperable,
    )
    nCompras.set(c.mes, (nCompras.get(c.mes) ?? 0) + 1)
  }

  const filas: IvaDelMes[] = []
  let remanente = 0

  for (let mes = 1; mes <= 12; mes += 1) {
    const d = debito.get(mes) ?? 0
    const c = credito.get(mes) ?? 0
    const nv = nVentas.get(mes) ?? 0
    const nc = nCompras.get(mes) ?? 0
    // Un mes sin ningún documento no es un mes con IVA cero: es un mes sin cargar.
    if (nv === 0 && nc === 0) continue

    const remanenteAnterior = remanente
    const bruto = d - c - remanenteAnterior
    const aPagar = Math.max(bruto, 0)
    remanente = bruto < 0 ? -bruto : 0

    const mesDePago = mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 }

    filas.push({
      anio,
      mes,
      debito: d,
      credito: c,
      remanenteAnterior,
      aPagar,
      remanente,
      venceEl: new Date(Date.UTC(mesDePago.anio, mesDePago.mes - 1, DIA_VENCIMIENTO, 12))
        .toISOString()
        .slice(0, 10),
      mesDePago,
      completo: nv > 0 && nc > 0,
      documentosVenta: nv,
      documentosCompra: nc,
    })
  }

  return filas
}

/**
 * El IVA por mes de PAGO en vez de por período.
 *
 * Lo consume f29.ts, que le suma los conceptos del formulario que no se pueden
 * derivar de ningún registro: PPM, retenciones y otros.
 */
export async function ivaPorMesDePago(anio: number): Promise<Map<number, IvaDelMes>> {
  // Se mira tambien el año anterior: el IVA de diciembre se paga en enero.
  const [previo, actual] = await Promise.all([ivaPorMes(anio - 1), ivaPorMes(anio)])
  const porPago = new Map<number, IvaDelMes>()
  for (const fila of [...previo, ...actual]) {
    if (fila.mesDePago.anio !== anio) continue
    porPago.set(fila.mesDePago.mes, fila)
  }
  return porPago
}
