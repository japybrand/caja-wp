/**
 * Filtros de Prisma que se comportan igual en SQLite y en PostgreSQL.
 *
 * SQLite resuelve `contains` con LIKE, que en ASCII no distingue mayúsculas:
 * buscar "santander" encuentra "PAC Seg. Fraude Santander". PostgreSQL sí las
 * distingue, así que esa misma búsqueda no devolvería nada después de migrar, y
 * sin ningún error: el buscador simplemente diría que no hay resultados.
 *
 * Prisma lo resuelve con `mode: 'insensitive'`, pero ese modificador NO existe en
 * el conector de SQLite —pasarlo ahí es un error de validación—, así que la
 * decisión tiene que tomarse en tiempo de ejecución y no escribirse fija.
 *
 * OJO CON EL ALCANCE
 * Esto es solo para las búsquedas por texto que van a la base. El motor de reglas
 * y el calce de glosas NO pasan por aquí y el cambio de motor no los afecta:
 * normalizan en JavaScript con `normalizarTexto` —mayúsculas, sin acentos, sin
 * puntuación— y comparan con `String.includes`. La conciliación de los nueve meses
 * es indiferente a la colación de la base, que era el riesgo que había que
 * descartar antes de migrar.
 */

/**
 * Si la base es PostgreSQL.
 *
 * Se mira `DATABASE_URL` y no una variable propia para que no haya dos fuentes de
 * verdad que puedan quedar desincronizadas.
 */
export function esPostgres(): boolean {
  return (process.env.DATABASE_URL ?? '').startsWith('postgres')
}

/** Un `contains` que no distingue mayúsculas en ninguno de los dos motores. */
export function contiene(texto: string): { contains: string; mode?: 'insensitive' } {
  return esPostgres() ? { contains: texto, mode: 'insensitive' } : { contains: texto }
}
