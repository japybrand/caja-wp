// Tipos del dominio. Van como uniones de TypeScript y no como enums de Prisma,
// para que el mismo esquema funcione en SQLite y en PostgreSQL.

export const GRUPOS = [
  'saldo_inicial',
  'ingresos',
  'financiamiento',
  'colaboradores',
  'proveedores',
  'impuestos',
  'retiros',
  'deudas',
] as const
export type Grupo = (typeof GRUPOS)[number]

/**
 * De dónde salió un movimiento. Es su procedencia, no su estado.
 *
 * El orden va de lo menos a lo más verificado, que es como conviene leerlas:
 *
 *  - `excel`      proyección de la planilla con que arrancó el año.
 *  - `manual`     alguien lo escribió o corrigió en la app.
 *  - `declarado`  alguien declaró haberlo pagado, pero el banco todavía no lo
 *                 muestra. NO cuenta como pagado hasta que un cargo se le enlace:
 *                 mientras tanto la plata sigue en la cuenta y sigue comprometida,
 *                 y darla por salida la contaría dos veces.
 *  - `gmail`      lo extrajo el modelo de un recibo del correo.
 *  - `compromiso` deuda declarada que todavía no se paga. Lo contrario de un pago.
 *  - `sii`        Registro de Ventas o de Compras.
 *  - `global66`   export del monedero de pagos internacionales.
 *  - `cartola`    salió de la cartola del banco. Es un hecho.
 *
 * `global66` y `compromiso` faltaban en esta lista aunque sí existen en la base: el
 * filtro de /movimientos no podía filtrar por ellas.
 */
export const FUENTES = [
  'excel',
  'manual',
  'declarado',
  'gmail',
  'compromiso',
  'sii',
  'global66',
  'cartola',
] as const
export type Fuente = (typeof FUENTES)[number]

/**
 * Fuentes que significan "esto ya pasó por la cuenta".
 *
 * `declarado` NO está aquí a propósito, y es la decisión que sostiene todo el
 * registro manual: una declaración no es evidencia de que la plata salió. Cuando la
 * conciliación le enlaza un cargo, pasa a contar por el enlace, no por la fuente.
 */
export const FUENTES_EJECUTADAS: readonly string[] = ['cartola', 'global66']

export const ESTADOS = ['confirmado', 'por_revisar'] as const
export type Estado = (typeof ESTADOS)[number]

export const MONEDAS = ['CLP', 'USD'] as const
export type Moneda = (typeof MONEDAS)[number]

export const ETIQUETA_FUENTE: Record<Fuente, string> = {
  excel: 'Excel',
  manual: 'Manual',
  declarado: 'Declarado',
  gmail: 'Gmail',
  compromiso: 'Compromiso',
  sii: 'SII',
  global66: 'Global66',
  cartola: 'Cartola',
}

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  confirmado: 'Confirmado',
  por_revisar: 'Por revisar',
}

export const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const

export const MESES_CORTOS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
] as const

/** Numeros de mes 1..12, en orden. */
export const NUMEROS_MES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

export const ANIO_ACTIVO = Number(process.env.NEXT_PUBLIC_ANIO_ACTIVO ?? '2026')

export function nombreMes(mes: number): string {
  return MESES[mes - 1] ?? String(mes)
}

export function esGrupo(valor: string): valor is Grupo {
  return (GRUPOS as readonly string[]).includes(valor)
}

export function esFuente(valor: string): valor is Fuente {
  return (FUENTES as readonly string[]).includes(valor)
}

export function esEstado(valor: string): valor is Estado {
  return (ESTADOS as readonly string[]).includes(valor)
}

export function esMoneda(valor: string): valor is Moneda {
  return (MONEDAS as readonly string[]).includes(valor)
}

/** Lee el campo remitentesEmail, que se guarda como JSON para ser portable a SQLite. */
export function leerRemitentes(json: string): string[] {
  try {
    const dato: unknown = JSON.parse(json)
    if (!Array.isArray(dato)) return []
    return dato.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

export function escribirRemitentes(lista: string[]): string {
  const limpia = lista.map((x) => x.trim().toLowerCase()).filter((x) => x.length > 0)
  return JSON.stringify([...new Set(limpia)])
}

/**
 * Los tipos de obligación con calendario cerrado, y lo que cada uno necesita.
 *
 * Antes esto vivía repartido en siete lugares: la etiqueta en dos componentes, el
 * día de vencimiento y el nombre de la cuota en `vencimientos.ts`, y filtros por
 * tipo en `panel.ts`. Agregar un tipo obligaba a encontrarlos todos, y el que se
 * olvidara fallaba en silencio: una obligación de tipo desconocido se habría
 * mostrado como "Convenio TGR" con el número equivocado.
 *
 * `diaDeVencimiento` sale de cuándo cobra cada acreedor: la línea de crédito a
 * principios de mes, los convenios de Tesorería el último día del mes, y los
 * acuerdos de pago a mediados, que es cuando se han cobrado los cheques de Inmotion.
 *
 * 'fin_de_mes' no es un 30 disfrazado: el último día del mes son 28, 29, 30 o 31
 * según cuál sea. Con un 30 fijo, la cuota de febrero vencía el 30 de febrero, una
 * fecha que no existe y que JavaScript convierte en marzo, así que el aviso habría
 * llegado dos días tarde y el vencimiento se mostraría con el mes equivocado.
 */
export const TIPOS_OBLIGACION = {
  convenio_tgr: {
    etiqueta: 'Convenio',
    diaDeVencimiento: 'fin_de_mes',
    /** Cómo se nombra una cuota suya en un aviso o en una lista. */
    nombre: (o: { institucion: string; numero: string }) => `Convenio TGR ${o.numero}`,
  },
  linea_credito: {
    etiqueta: 'Línea de crédito',
    diaDeVencimiento: 5,
    nombre: (o: { institucion: string; numero: string }) => `Cuota Fogape ${o.institucion}`,
  },
  acuerdo_pago: {
    etiqueta: 'Acuerdo de pago',
    diaDeVencimiento: 15,
    nombre: (o: { institucion: string; numero: string }) => `Acuerdo ${o.institucion}`,
  },
} as const

export type TipoObligacion = keyof typeof TIPOS_OBLIGACION

/** Los datos de un tipo, con respaldo para el caso de un tipo que no exista. */
export function tipoObligacion(tipo: string): {
  etiqueta: string
  diaDeVencimiento: number | 'fin_de_mes'
  nombre: (o: { institucion: string; numero: string }) => string
} {
  return TIPOS_OBLIGACION[tipo as TipoObligacion] ?? TIPOS_OBLIGACION.convenio_tgr
}

/**
 * Cuándo vence la cuota de un mes.
 *
 * El día 0 del mes siguiente es el último del mes pedido, y así el cálculo sirve
 * para febrero y para los años bisiestos sin ninguna tabla de por medio.
 *
 * Mediodía UTC y no medianoche: las fechas de la cartola están a medianoche y las
 * comparaciones entre ambas ya fallaron una vez por unas horas de diferencia.
 */
export function fechaVencimientoCuota(tipo: string, anio: number, mes: number): Date {
  const dia = tipoObligacion(tipo).diaDeVencimiento
  return dia === 'fin_de_mes'
    ? new Date(Date.UTC(anio, mes, 0, 12))
    : new Date(Date.UTC(anio, mes - 1, dia, 12))
}
