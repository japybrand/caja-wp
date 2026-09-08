/**
 * Lo que comparten exportar-datos, importar-datos y verificar-migracion.
 *
 * Vive aparte para que importar el orden de tablas no ejecute la exportación: un
 * script con `main()` en el cuerpo del módulo se corre solo al importarlo.
 */

/**
 * Las 18 tablas, en orden de dependencias.
 *
 * Sale del mapa de claves foráneas del esquema: cada tabla va después de todas las
 * que referencia, así que ninguna inserción encuentra un id que todavía no existe.
 * Para borrar, se recorre al revés.
 */
export const ORDEN_DE_TABLAS = [
  // 1. Sin dependencias.
  'categoria',
  'cuentaGoogle',
  'tipoCambio',
  'sincronizacion',
  'documentoVenta',
  'documentoCompra',
  'declaracionF29',
  // 2. Depende de Categoria.
  'proveedor',
  // 3. Depende de Categoria y Proveedor.
  'movimiento',
  // 4. Dependen de Movimiento o Proveedor.
  'valorManual',
  'reglaClasificacion',
  'remitenteCandidato',
  'correoProcesado',
  'movimientoGlobal66',
  // 5. Depende de Movimiento y Categoria.
  'movimientoBancario',
  // 6. Depende de Categoria.
  'obligacionFinanciera',
  // 7. Dependen de ObligacionFinanciera y MovimientoBancario.
  'cuotaObligacion',
  'cotizacionPrevisional',
] as const

export type Tabla = (typeof ORDEN_DE_TABLAS)[number]

/**
 * Cifras que solo se obtienen recorriendo los enlaces entre tablas.
 *
 * Viajan dentro del respaldo para que la verificación compare la base migrada
 * contra el estado real del origen y no contra constantes escritas a mano. Una
 * constante envejece: en cuanto los datos cambian legítimamente, la verificación
 * falla por la razón equivocada y deja de servir.
 */
export interface CifrasDerivadas {
  saldoHoy: number
  yaPagadoDelMes: number
  egresosDelMes: number
  flujoFinancieroDiciembre: number
  porRevisar: number
  sinConciliar: number
}

export interface Respaldo {
  generadoEn: string
  origen: string
  /** El orden viaja con los datos: quien importe no tiene que volver a deducirlo. */
  orden: readonly string[]
  /** Ausente en respaldos anteriores a la fase 8. */
  cifras?: CifrasDerivadas
  filas: Record<string, unknown[]>
}

/** La fecha con la que se calculan las cifras, para que el respaldo sea reproducible. */
export const FECHA_DE_CORTE = new Date('2026-09-08T12:00:00Z')

/** Qué motor hay detrás de DATABASE_URL. */
export function motor(): 'postgresql' | 'sqlite' {
  return (process.env.DATABASE_URL ?? '').startsWith('postgres') ? 'postgresql' : 'sqlite'
}
