const FORMATEADOR = new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
})

/** 1234567 -> "1.234.567". El cero se muestra como guion para aligerar la grilla. */
export function formatearCLP(monto: number, opciones?: { ceroComoGuion?: boolean }): string {
  if (monto === 0 && opciones?.ceroComoGuion !== false) return '—'
  return FORMATEADOR.format(Math.round(monto))
}

/** Igual que formatearCLP pero el cero se imprime como "0". Para filas de total. */
export function formatearCLPConCero(monto: number): string {
  return FORMATEADOR.format(Math.round(monto))
}

/**
 * Acepta lo que el usuario tipee en una celda: "1.234.567", "1234567", "$ 1.234.567",
 * "1,234,567" o vacio. Devuelve pesos enteros, o null si no se entiende.
 */
export function parsearCLP(texto: string): number | null {
  const limpio = texto.replace(/[^0-9,.\-]/g, '').trim()
  if (limpio === '' || limpio === '-') return 0
  // Se descartan separadores de miles (punto o coma) porque no manejamos decimales.
  const soloDigitos = limpio.replace(/[.,]/g, '')
  if (!/^-?\d+$/.test(soloDigitos)) return null
  const valor = Number(soloDigitos)
  return Number.isFinite(valor) ? valor : null
}

export function formatearFecha(fecha: Date): string {
  return new Intl.DateTimeFormat('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(fecha)
}

/** "2026-03-01", para inputs type=date, sin que la zona horaria corra el dia. */
export function fechaParaInput(fecha: Date): string {
  return fecha.toISOString().slice(0, 10)
}
