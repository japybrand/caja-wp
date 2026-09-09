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

export const FUENTES = ['excel', 'manual', 'gmail', 'cartola', 'sii'] as const
export type Fuente = (typeof FUENTES)[number]

export const ESTADOS = ['confirmado', 'por_revisar'] as const
export type Estado = (typeof ESTADOS)[number]

export const MONEDAS = ['CLP', 'USD'] as const
export type Moneda = (typeof MONEDAS)[number]

export const ETIQUETA_FUENTE: Record<Fuente, string> = {
  excel: 'Excel',
  manual: 'Manual',
  gmail: 'Gmail',
  cartola: 'Cartola',
  sii: 'SII',
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
 * principios de mes, los convenios de Tesorería a fin de mes, y los acuerdos de
 * pago a mediados, que es cuando se han cobrado los cheques de Inmotion.
 */
export const TIPOS_OBLIGACION = {
  convenio_tgr: {
    etiqueta: 'Convenio',
    diaDeVencimiento: 30,
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
export function tipoObligacion(tipo: string): (typeof TIPOS_OBLIGACION)[TipoObligacion] {
  return TIPOS_OBLIGACION[tipo as TipoObligacion] ?? TIPOS_OBLIGACION.convenio_tgr
}
