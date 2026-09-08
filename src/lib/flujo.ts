import { prisma } from '@/lib/prisma'
import { NUMEROS_MES, type Grupo } from '@/lib/dominio'
import { signo } from '@/lib/sii/ventas'
import { f29PorMesDePago } from '@/lib/sii/f29'

/**
 * Replica del flujo de caja del Excel "Flujo de Caja 2026 - Japybrand WP".
 *
 * Correspondencia con las filas del Excel (columnas C..N = enero..diciembre):
 *
 *   Saldo Inicial (8)                  C8 = manual;  D8 = C68 (encadenado)
 *   Total Ingresos (14)                = SUM(C11:C13)
 *   Total Financiamiento (21)          = SUM(C18:C20)
 *   Total Egresos colaboradores (29)   = SUM(C25:C28)
 *   Total Egresos proveedores (40)     = SUM(C33:C39)
 *   Resultado antes de impuestos (42)  = C8 + C14 + C21 - C29 - C40   <- incluye el saldo inicial
 *   Total Impuestos (52)               = SUM(C46:C51)
 *   Retiros (54)                       = Retiros!C11
 *   Flujo de caja economico (56)       = C42 - C52 - C54
 *   Total Deudas (66)                  = SUM(C60:C65)
 *   Flujo de caja financiero (68)      = C56 - C66
 *
 * Una diferencia deliberada con el Excel: la fila "Ventas del mes" ya no sale solo
 * de un valor manual. Si el mes tiene documentos del Registro de Ventas del SII
 * cargados, manda el SII; si no, cae al ValorManual que dejó la planilla. Asi
 * octubre a diciembre siguen proyectados mientras el resto es facturacion real.
 */

/** Nombre de la fila cuyo valor puede venir del SII. */
const CATEGORIA_VENTAS = 'Ventas del mes'

/**
 * Fila de impuestos. Lleva el F29 COMPLETO, no solo el IVA.
 *
 * Lo que sale de la cuenta es el formulario entero: IVA mas PPM, retenciones de
 * honorarios y otros conceptos. Para el periodo agosto de 2026 el IVA son 1.470.812
 * y el F29 2.429.918, casi un millon de diferencia. Mientras el contador no mande
 * el formulario se usa el IVA calculado, que es lo mejor que se sabe.
 *
 * Ojo con el mes: el F29 de un periodo se paga hasta el dia 20 del mes siguiente,
 * asi que la fila de septiembre lleva el formulario del periodo agosto.
 */
const CATEGORIA_IMPUESTOS = 'Pago de impuestos (F29)'

/**
 * De dónde salió el monto de cada mes en una fila híbrida.
 *
 *  - 'sii':        Registro de Ventas del SII.
 *  - 'calendario': cuotas de una obligación con calendario cerrado, o sea los
 *                  convenios de la Tesorería y la línea Fogape. Manda sobre el
 *                  ValorManual porque la planilla traía una estimación: para
 *                  octubre a diciembre suponía 1.664.507 al mes cuando el cuarto
 *                  convenio, activado el 04/09, sube la cuota a 1.966.905.
 *  - 'manual':     el valor que dejó la planilla.
 */
export type OrigenMonto = 'sii' | 'calendario' | 'manual'

/**
 * Principio del modelo: un mes es REAL o es PROYECTADO, nunca a medias.
 *
 * Real = hay cartola bancaria de ese mes, así que los montos son lo que
 * efectivamente pasó por la cuenta. Proyectado = no hay cartola, y lo que se
 * muestra viene de la proyección anual que se armó al empezar el año.
 *
 * Esto importa porque los montos originales del Excel eran justamente eso, una
 * proyección: 24 de 39 proveedores repetían uno o dos valores en los doce meses
 * (Verpex 233.511 los doce). Son suscripciones en dólares con tarjeta chilena,
 * donde el cargo real varía con el tipo de cambio. Mezclar ambos sin marcarlos
 * hace que un número proyectado se lea como un hecho.
 *
 * Hay un tercer estado, INCOMPLETO, para los meses que existen solo porque hay
 * deuda comprometida ahí: 2027 y 2028 no tienen ingresos ni gastos operacionales
 * cargados, así que su saldo no es un pronóstico de caja sino el peso del
 * compromiso. Se marca aparte a propósito, para que nadie lea ese saldo como una
 * proyección del negocio.
 */
export type NaturalezaMes = 'real' | 'proyectado' | 'incompleto'

export type TipoFila = 'saldo' | 'encabezado' | 'manual' | 'derivada' | 'subtotal' | 'resultado'

export interface LineaDetalle {
  clave: string
  nombre: string
  montos: number[]
  total: number
}

export interface FilaFlujo {
  clave: string
  etiqueta: string
  tipo: TipoFila
  /** Solo en filas 'manual' y 'derivada'. */
  categoriaId?: string
  grupo?: Grupo
  montos: number[]
  total: number
  /**
   * Movimientos con estado por_revisar. NO entran en `montos` ni en ningún total:
   * un duplicado sin revisar descuadraría el flujo en silencio. Se muestran aparte
   * para que se vea lo que está esperando aprobación.
   */
  pendientes: number[]
  totalPendiente: number
  /** Desglose por proveedor o por movimiento suelto. Solo en filas 'derivada'. */
  detalle?: LineaDetalle[]
  /**
   * Solo en "Ventas del mes": de dónde salió el monto de cada mes. Los meses con
   * origen 'sii' no se editan a mano, porque el valor lo manda el Registro de
   * Ventas; los 'manual' siguen siendo editables.
   */
  origenPorMes?: OrigenMonto[]
  /**
   * Reversas aplicadas a esta fila en cada mes: abonos del banco asignados a una
   * fila de egreso, que restan. Se muestran a propósito — un monto que baja sin
   * explicación visible es peor que uno alto.
   */
  reversasPorMes?: number[]
}

export interface Flujo {
  anio: number
  filas: FilaFlujo[]
  /** Total por revisar de cada mes, sumando todas las categorías. */
  pendientePorMes: number[]
  hayPendientes: boolean
  /** Si cada mes es real (hay cartola) o proyectado. */
  naturalezaPorMes: NaturalezaMes[]
}

const CERO_12 = (): number[] => Array<number>(12).fill(0)

/** Orden en que los grupos de subtotales aparecen dentro del flujo. */
const ENCABEZADOS: Record<string, string> = {
  ingresos: 'Ingresos',
  financiamiento: 'Financiamiento',
  colaboradores: 'Pago Colaboradores',
  proveedores: 'Pago Proveedores',
  impuestos: 'Pago Impuestos / Cotizaciones',
  deudas: 'Deudas por pagar',
}

export async function calcularFlujo(anio: number): Promise<Flujo> {
  const [
    categorias,
    valoresManuales,
    sumasPorProveedor,
    movimientosSueltos,
    sumasPorRevisar,
    ventasSII,
    mesesBancarios,
    reversasBancarias,
    f29,
    cuotasObligacion,
  ] = await Promise.all([
    prisma.categoria.findMany({
      orderBy: [{ grupo: 'asc' }, { orden: 'asc' }],
      include: { proveedores: { orderBy: { orden: 'asc' } } },
    }),
    prisma.valorManual.findMany({ where: { anio } }),
    prisma.movimiento.groupBy({
      by: ['categoriaId', 'proveedorId', 'mes'],
      // Solo lo confirmado entra en el flujo.
      where: { anio, proveedorId: { not: null }, estado: 'confirmado' },
      _sum: { montoCLP: true },
    }),
    // Movimientos sin proveedor (retiros y cargas manuales sueltas): se listan uno a uno.
    prisma.movimiento.findMany({
      where: { anio, proveedorId: null, estado: 'confirmado' },
      orderBy: [{ mes: 'asc' }, { fecha: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, categoriaId: true, mes: true, montoCLP: true, descripcion: true },
    }),
    prisma.movimiento.groupBy({
      by: ['categoriaId', 'mes'],
      where: { anio, estado: 'por_revisar' },
      _sum: { montoCLP: true },
    }),
    // Registro de Ventas del SII: 33 y 34 suman, 61 resta.
    prisma.documentoVenta.groupBy({
      by: ['mes', 'tipoDocumento'],
      where: { anio },
      _sum: { montoTotal: true },
    }),
    // Un mes con cartola es un mes real.
    prisma.movimientoBancario.groupBy({ by: ['mes'], where: { anio }, _count: { _all: true } }),
    // Reversas: abonos asignados a una fila de egreso.
    prisma.movimientoBancario.groupBy({
      by: ['categoriaManualId', 'mes'],
      where: { anio, esReversa: true, categoriaManualId: { not: null } },
      _sum: { monto: true },
    }),
    // F29 completo, indexado por el mes en que sale la plata.
    f29PorMesDePago(anio),
    // Cuotas de convenio y de la linea Fogape del ano.
    prisma.cuotaObligacion.findMany({
      where: { anio, obligacion: { categoriaId: { not: null }, activa: true } },
      select: { mes: true, monto: true, obligacion: { select: { categoriaId: true } } },
    }),
  ])

  const nombreProveedor = new Map<string, string>()
  for (const categoria of categorias) {
    for (const proveedor of categoria.proveedores) nombreProveedor.set(proveedor.id, proveedor.nombre)
  }

  // categoriaId -> montos[12]
  const montosPorCategoria = new Map<string, number[]>()
  // categoriaId -> lineas de detalle
  const detallePorCategoria = new Map<string, Map<string, LineaDetalle>>()

  const acumular = (categoriaId: string, mes: number, monto: number): void => {
    let montos = montosPorCategoria.get(categoriaId)
    if (!montos) {
      montos = CERO_12()
      montosPorCategoria.set(categoriaId, montos)
    }
    montos[mes - 1] = (montos[mes - 1] ?? 0) + monto
  }

  const acumularDetalle = (
    categoriaId: string,
    clave: string,
    nombre: string,
    mes: number,
    monto: number,
  ): void => {
    let lineas = detallePorCategoria.get(categoriaId)
    if (!lineas) {
      lineas = new Map<string, LineaDetalle>()
      detallePorCategoria.set(categoriaId, lineas)
    }
    let linea = lineas.get(clave)
    if (!linea) {
      linea = { clave, nombre, montos: CERO_12(), total: 0 }
      lineas.set(clave, linea)
    }
    linea.montos[mes - 1] = (linea.montos[mes - 1] ?? 0) + monto
    linea.total += monto
  }

  // categoriaId -> montos[12] de lo que está esperando revisión
  const pendientesPorCategoria = new Map<string, number[]>()
  for (const suma of sumasPorRevisar) {
    const monto = suma._sum.montoCLP ?? 0
    if (monto === 0) continue
    let montos = pendientesPorCategoria.get(suma.categoriaId)
    if (!montos) {
      montos = CERO_12()
      pendientesPorCategoria.set(suma.categoriaId, montos)
    }
    montos[suma.mes - 1] = (montos[suma.mes - 1] ?? 0) + monto
  }

  for (const valor of valoresManuales) {
    acumular(valor.categoriaId, valor.mes, valor.montoCLP)
  }

  // --- Ventas del SII: pisan al valor manual en los meses que tienen documentos.
  const totalSIIPorMes = CERO_12()
  const mesesConSII = new Set<number>()
  for (const fila of ventasSII) {
    const s = signo(fila.tipoDocumento)
    if (s === 0) continue
    mesesConSII.add(fila.mes)
    totalSIIPorMes[fila.mes - 1] =
      (totalSIIPorMes[fila.mes - 1] ?? 0) + s * (fila._sum.montoTotal ?? 0)
  }

  // categoriaId -> de donde salio el monto de cada mes, en las filas hibridas.
  const origenPorCategoria = new Map<string, OrigenMonto[]>()

  const categoriaVentas = categorias.find((c) => c.nombre === CATEGORIA_VENTAS)
  if (categoriaVentas && mesesConSII.size > 0) {
    const origen = Array<OrigenMonto>(12).fill('manual')
    const montos = montosPorCategoria.get(categoriaVentas.id) ?? CERO_12()
    montosPorCategoria.set(categoriaVentas.id, montos)
    for (const mes of mesesConSII) {
      montos[mes - 1] = totalSIIPorMes[mes - 1] ?? 0
      origen[mes - 1] = 'sii'
    }
    origenPorCategoria.set(categoriaVentas.id, origen)
  }

  // --- F29: pisa al valor manual en los meses que se pueden calcular.
  //
  // Entra si el contador ya mando el total, o si el periodo tiene ventas Y compras
  // cargadas para calcular al menos el IVA. Con un solo registro del SII el numero
  // seria un debito sin credito, peor que la estimacion que reemplaza.
  const categoriaImpuestos = categorias.find((c) => c.nombre === CATEGORIA_IMPUESTOS)
  if (categoriaImpuestos) {
    const montos = montosPorCategoria.get(categoriaImpuestos.id) ?? CERO_12()
    montosPorCategoria.set(categoriaImpuestos.id, montos)
    const origen = Array<OrigenMonto>(12).fill('manual')
    for (const [mes, f] of f29) {
      if (!f.completo && !f.iva?.completo) continue
      montos[mes - 1] = f.total
      origen[mes - 1] = 'sii'
    }
    if (origen.some((o) => o === 'sii')) origenPorCategoria.set(categoriaImpuestos.id, origen)
  }

  // --- Calendario de obligaciones: pisa al valor manual en los meses con cuota.
  //
  // Reemplaza, no suma. La planilla ya traia una estimacion de estas filas y
  // sumarle el calendario contaria la cuota dos veces. El calendario es el dato
  // firme: sale de la resolucion del convenio y de la tabla de desarrollo del
  // credito, no de un supuesto.
  const cuotasPorCategoriaMes = new Map<string, number[]>()
  for (const cuota of cuotasObligacion) {
    const categoriaId = cuota.obligacion.categoriaId
    if (!categoriaId) continue
    let montos = cuotasPorCategoriaMes.get(categoriaId)
    if (!montos) {
      montos = CERO_12()
      cuotasPorCategoriaMes.set(categoriaId, montos)
    }
    montos[cuota.mes - 1] = (montos[cuota.mes - 1] ?? 0) + cuota.monto
  }

  for (const [categoriaId, cuotasDelMes] of cuotasPorCategoriaMes) {
    const montos = montosPorCategoria.get(categoriaId) ?? CERO_12()
    montosPorCategoria.set(categoriaId, montos)
    const origen = origenPorCategoria.get(categoriaId) ?? Array<OrigenMonto>(12).fill('manual')
    for (let i = 0; i < 12; i += 1) {
      if ((cuotasDelMes[i] ?? 0) === 0) continue
      montos[i] = cuotasDelMes[i] ?? 0
      origen[i] = 'calendario'
    }
    origenPorCategoria.set(categoriaId, origen)
  }

  for (const suma of sumasPorProveedor) {
    const monto = suma._sum.montoCLP ?? 0
    if (monto === 0) continue
    acumular(suma.categoriaId, suma.mes, monto)
    const proveedorId = suma.proveedorId
    if (proveedorId) {
      acumularDetalle(
        suma.categoriaId,
        proveedorId,
        nombreProveedor.get(proveedorId) ?? 'Sin proveedor',
        suma.mes,
        monto,
      )
    }
  }

  for (const movimiento of movimientosSueltos) {
    if (movimiento.montoCLP === 0) continue
    acumular(movimiento.categoriaId, movimiento.mes, movimiento.montoCLP)
    acumularDetalle(
      movimiento.categoriaId,
      movimiento.id,
      movimiento.descripcion.trim() === '' ? 'Sin descripción' : movimiento.descripcion,
      movimiento.mes,
      movimiento.montoCLP,
    )
  }

  // categoriaId -> reversas[12]
  const reversasPorCategoria = new Map<string, number[]>()
  for (const r of reversasBancarias) {
    if (!r.categoriaManualId) continue
    let montos = reversasPorCategoria.get(r.categoriaManualId)
    if (!montos) {
      montos = CERO_12()
      reversasPorCategoria.set(r.categoriaManualId, montos)
    }
    montos[r.mes - 1] = (montos[r.mes - 1] ?? 0) + Math.abs(r._sum.monto ?? 0)
  }

  const porGrupo = (grupo: Grupo) => categorias.filter((c) => c.grupo === grupo)
  const montosDe = (categoriaId: string): number[] => montosPorCategoria.get(categoriaId) ?? CERO_12()

  const pendientesDe = (categoriaId: string): number[] =>
    pendientesPorCategoria.get(categoriaId) ?? CERO_12()

  const sumarGrupo = (grupo: Grupo, mes: number): number =>
    porGrupo(grupo).reduce((acc, c) => acc + (montosDe(c.id)[mes - 1] ?? 0), 0)

  // --- Cadena mes a mes. El saldo inicial de cada mes es el flujo financiero del anterior.
  const saldoInicial = CERO_12()
  const totalIngresos = CERO_12()
  const totalFinanciamiento = CERO_12()
  const totalColaboradores = CERO_12()
  const totalProveedores = CERO_12()
  const resultadoAntesImpuestos = CERO_12()
  const totalImpuestos = CERO_12()
  const retiros = CERO_12()
  const flujoEconomico = CERO_12()
  const totalDeudas = CERO_12()
  const flujoFinanciero = CERO_12()

  const categoriaSaldo = porGrupo('saldo_inicial')[0]
  const saldoInicialEnero = categoriaSaldo ? (montosDe(categoriaSaldo.id)[0] ?? 0) : 0

  for (const mes of NUMEROS_MES) {
    const i = mes - 1
    saldoInicial[i] = mes === 1 ? saldoInicialEnero : (flujoFinanciero[i - 1] ?? 0)
    totalIngresos[i] = sumarGrupo('ingresos', mes)
    totalFinanciamiento[i] = sumarGrupo('financiamiento', mes)
    totalColaboradores[i] = sumarGrupo('colaboradores', mes)
    totalProveedores[i] = sumarGrupo('proveedores', mes)
    resultadoAntesImpuestos[i] =
      (saldoInicial[i] ?? 0) +
      (totalIngresos[i] ?? 0) +
      (totalFinanciamiento[i] ?? 0) -
      (totalColaboradores[i] ?? 0) -
      (totalProveedores[i] ?? 0)
    totalImpuestos[i] = sumarGrupo('impuestos', mes)
    retiros[i] = sumarGrupo('retiros', mes)
    flujoEconomico[i] =
      (resultadoAntesImpuestos[i] ?? 0) - (totalImpuestos[i] ?? 0) - (retiros[i] ?? 0)
    totalDeudas[i] = sumarGrupo('deudas', mes)
    flujoFinanciero[i] = (flujoEconomico[i] ?? 0) - (totalDeudas[i] ?? 0)
  }

  const sumar = (montos: number[]): number => montos.reduce((a, b) => a + b, 0)

  const filas: FilaFlujo[] = []

  filas.push({
    clave: 'saldo_inicial',
    etiqueta: 'Saldo Inicial',
    tipo: 'saldo',
    categoriaId: categoriaSaldo?.id,
    grupo: 'saldo_inicial',
    montos: saldoInicial,
    total: 0, // el saldo inicial no se suma en el ano
    pendientes: CERO_12(),
    totalPendiente: 0,
  })

  const agregarBloque = (grupo: Grupo, etiquetaTotal: string, totales: number[]): void => {
    const encabezado = ENCABEZADOS[grupo]
    if (encabezado) {
      filas.push({
        clave: `enc_${grupo}`,
        etiqueta: encabezado,
        tipo: 'encabezado',
        montos: CERO_12(),
        total: 0,
        pendientes: CERO_12(),
        totalPendiente: 0,
      })
    }
    for (const categoria of porGrupo(grupo)) {
      const montos = montosDe(categoria.id)
      const lineas = [...(detallePorCategoria.get(categoria.id)?.values() ?? [])].sort(
        (a, b) => b.total - a.total,
      )
      const pendientes = pendientesDe(categoria.id)
      filas.push({
        clave: categoria.id,
        etiqueta: categoria.nombre,
        tipo: categoria.esManual ? 'manual' : 'derivada',
        categoriaId: categoria.id,
        grupo,
        montos,
        total: sumar(montos),
        pendientes,
        totalPendiente: sumar(pendientes),
        ...(categoria.esManual ? {} : { detalle: lineas }),
        ...(origenPorCategoria.has(categoria.id)
          ? { origenPorMes: origenPorCategoria.get(categoria.id) }
          : {}),
        ...(reversasPorCategoria.has(categoria.id)
          ? { reversasPorMes: reversasPorCategoria.get(categoria.id) }
          : {}),
      })
    }
    const pendientesGrupo = CERO_12()
    for (const categoria of porGrupo(grupo)) {
      const p = pendientesDe(categoria.id)
      for (let i = 0; i < 12; i += 1) pendientesGrupo[i] = (pendientesGrupo[i] ?? 0) + (p[i] ?? 0)
    }
    filas.push({
      clave: `total_${grupo}`,
      etiqueta: etiquetaTotal,
      tipo: 'subtotal',
      montos: totales,
      total: sumar(totales),
      pendientes: pendientesGrupo,
      totalPendiente: sumar(pendientesGrupo),
    })
  }

  agregarBloque('ingresos', 'Total Ingresos', totalIngresos)
  agregarBloque('financiamiento', 'Total Financiamiento', totalFinanciamiento)
  agregarBloque('colaboradores', 'Total Egresos', totalColaboradores)
  agregarBloque('proveedores', 'Total Egresos', totalProveedores)

  filas.push({
    clave: 'resultado_antes_impuestos',
    etiqueta: 'Resultado antes de impuestos',
    tipo: 'resultado',
    montos: resultadoAntesImpuestos,
    total: sumar(resultadoAntesImpuestos),
    pendientes: CERO_12(),
    totalPendiente: 0,
  })

  agregarBloque('impuestos', 'Total Impuestos', totalImpuestos)

  // Retiros no lleva encabezado ni fila de total propia en el Excel: es una fila suelta.
  for (const categoria of porGrupo('retiros')) {
    const montos = montosDe(categoria.id)
    const lineas = [...(detallePorCategoria.get(categoria.id)?.values() ?? [])].sort(
      (a, b) => b.total - a.total,
    )
    const pendientes = pendientesDe(categoria.id)
    filas.push({
      clave: categoria.id,
      etiqueta: categoria.nombre,
      tipo: 'derivada',
      categoriaId: categoria.id,
      grupo: 'retiros',
      montos,
      total: sumar(montos),
      pendientes,
      totalPendiente: sumar(pendientes),
      detalle: lineas,
    })
  }

  filas.push({
    clave: 'flujo_economico',
    etiqueta: 'Flujo de caja económico',
    tipo: 'resultado',
    montos: flujoEconomico,
    total: sumar(flujoEconomico),
    pendientes: CERO_12(),
    totalPendiente: 0,
  })

  agregarBloque('deudas', 'Total Deudas', totalDeudas)

  filas.push({
    clave: 'flujo_financiero',
    etiqueta: 'Flujo de caja financiero',
    tipo: 'resultado',
    montos: flujoFinanciero,
    total: sumar(flujoFinanciero),
    pendientes: CERO_12(),
    totalPendiente: 0,
  })

  // Total por revisar de cada mes, para la fila de cierre de la grilla.
  const pendientePorMes = CERO_12()
  for (const montos of pendientesPorCategoria.values()) {
    for (let i = 0; i < 12; i += 1) pendientePorMes[i] = (pendientePorMes[i] ?? 0) + (montos[i] ?? 0)
  }

  const conCartola = new Set(mesesBancarios.filter((m) => m._count._all > 0).map((m) => m.mes))
  // Un mes sin cartola y sin nada operacional cargado no es una proyeccion del
  // negocio: es solo la deuda comprometida. Se marca incompleto para que su saldo
  // no se lea como un pronostico de caja.
  const naturalezaPorMes: NaturalezaMes[] = NUMEROS_MES.map((mes) => {
    if (conCartola.has(mes)) return 'real'
    const i = mes - 1
    const hayOperacion =
      (totalIngresos[i] ?? 0) !== 0 ||
      (totalColaboradores[i] ?? 0) !== 0 ||
      (totalProveedores[i] ?? 0) !== 0
    return hayOperacion ? 'proyectado' : 'incompleto'
  })

  return {
    anio,
    filas,
    pendientePorMes,
    hayPendientes: pendientePorMes.some((monto) => monto !== 0),
    naturalezaPorMes,
  }
}

/** Atajo para la cuadratura del importador: busca una fila por su etiqueta. */
export function filaPorClave(flujo: Flujo, clave: string): FilaFlujo | undefined {
  return flujo.filas.find((f) => f.clave === clave)
}

/** Una columna del horizonte: un mes concreto de un año concreto. */
export interface ColumnaHorizonte {
  anio: number
  mes: number
}

export interface Horizonte {
  columnas: ColumnaHorizonte[]
  filas: FilaFlujo[]
  naturalezaPorMes: NaturalezaMes[]
  pendientePorMes: number[]
  hayPendientes: boolean
  /** Años sin operación cargada, donde el saldo es solo el peso de la deuda. */
  aniosIncompletos: number[]
}

/** Las cuatro filas cuyo monto depende del saldo que viene arrastrado del año anterior. */
const FILAS_ENCADENADAS = new Set([
  'saldo_inicial',
  'resultado_antes_impuestos',
  'flujo_economico',
  'flujo_financiero',
])

/**
 * El flujo a lo largo de varios años, con el saldo encadenado entre diciembre y
 * enero.
 *
 * No recalcula nada: llama a `calcularFlujo` por año y corrige el arrastre. Puede
 * hacerlo porque la cadena es lineal — el saldo inicial de un mes es el flujo
 * financiero del anterior, y ese flujo es el saldo más una suma que no depende del
 * saldo. Así, una diferencia constante en el saldo de enero se propaga igual a los
 * doce meses, y basta sumársela a las cuatro filas encadenadas.
 *
 * Mantener `calcularFlujo` intacto no es pereza: es la réplica verificada del Excel
 * y el contrato con la planilla original. Extender el horizonte no debería poder
 * romperla.
 */
export async function calcularHorizonte(desde: number, hasta: number): Promise<Horizonte> {
  const anios = Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i)
  const flujos = await Promise.all(anios.map((anio) => calcularFlujo(anio)))

  const columnas: ColumnaHorizonte[] = []
  const naturalezaPorMes: NaturalezaMes[] = []
  const pendientePorMes: number[] = []
  const aniosIncompletos: number[] = []
  // clave -> fila acumulada a lo largo de todos los años
  const acumuladas = new Map<string, FilaFlujo>()
  const orden: string[] = []

  let saldoDeArrastre: number | null = null

  for (const [indice, flujo] of flujos.entries()) {
    const anio = anios[indice] ?? 0

    // Corrección del arrastre: la diferencia entre el saldo con que arranca este
    // año y el que dejó diciembre del anterior.
    const saldoEnero = flujo.filas.find((f) => f.clave === 'saldo_inicial')?.montos[0] ?? 0
    const delta = saldoDeArrastre === null ? 0 : saldoDeArrastre - saldoEnero

    for (const fila of flujo.filas) {
      const montos = FILAS_ENCADENADAS.has(fila.clave)
        ? fila.montos.map((m) => m + delta)
        : [...fila.montos]

      let acumulada = acumuladas.get(fila.clave)
      if (!acumulada) {
        acumulada = { ...fila, montos: [], total: 0, pendientes: [], totalPendiente: 0 }
        if (fila.detalle) acumulada.detalle = []
        if (fila.origenPorMes) acumulada.origenPorMes = []
        if (fila.reversasPorMes) acumulada.reversasPorMes = []
        acumuladas.set(fila.clave, acumulada)
        orden.push(fila.clave)
      }
      acumulada.montos.push(...montos)
      acumulada.pendientes.push(...fila.pendientes)
      // El saldo inicial no se suma en el año, y sumarlo entre años tiene aún menos
      // sentido: es un stock, no un flujo.
      if (fila.tipo !== 'saldo') acumulada.total += fila.total
      acumulada.totalPendiente += fila.totalPendiente
      if (fila.origenPorMes) acumulada.origenPorMes?.push(...fila.origenPorMes)
      else acumulada.origenPorMes?.push(...Array<OrigenMonto>(12).fill('manual'))
      if (fila.reversasPorMes) acumulada.reversasPorMes?.push(...fila.reversasPorMes)
      else acumulada.reversasPorMes?.push(...CERO_12())
    }

    // Las filas derivadas traen detalle por proveedor: se concatena mes a mes.
    for (const fila of flujo.filas) {
      const acumulada = acumuladas.get(fila.clave)
      if (!acumulada?.detalle) continue
      for (const linea of fila.detalle ?? []) {
        let destino = acumulada.detalle.find((l) => l.clave === linea.clave)
        if (!destino) {
          destino = { clave: linea.clave, nombre: linea.nombre, montos: [], total: 0 }
          // Rellena los años anteriores en los que este proveedor no aparecía.
          destino.montos.push(...Array<number>(indice * 12).fill(0))
          acumulada.detalle.push(destino)
        }
        destino.montos.push(...linea.montos)
        destino.total += linea.total
      }
      // Los proveedores que no aparecieron este año igual necesitan sus doce ceros.
      for (const linea of acumulada.detalle) {
        while (linea.montos.length < (indice + 1) * 12) linea.montos.push(0)
      }
    }

    for (const mes of NUMEROS_MES) columnas.push({ anio, mes })
    naturalezaPorMes.push(...flujo.naturalezaPorMes)
    pendientePorMes.push(...flujo.pendientePorMes)
    if (flujo.naturalezaPorMes.every((n) => n === 'incompleto')) aniosIncompletos.push(anio)

    const financiero = acumuladas.get('flujo_financiero')
    saldoDeArrastre = financiero?.montos[financiero.montos.length - 1] ?? 0
  }

  return {
    columnas,
    filas: orden.map((clave) => acumuladas.get(clave)).filter((f): f is FilaFlujo => f !== undefined),
    naturalezaPorMes,
    pendientePorMes,
    hayPendientes: pendientePorMes.some((m) => m !== 0),
    aniosIncompletos,
  }
}
