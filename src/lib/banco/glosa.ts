/**
 * Normalización y emparejamiento de glosas del banco.
 *
 * El banco trunca la descripción alrededor de los 24 caracteres y le antepone el
 * tipo de operación y, en las transferencias, el número de cuenta:
 *
 *   "0153152497 Transf a MOLINA OVALLE"   ->  MOLINA OVALLE
 *   "Compra Amazon web servic"            ->  AMAZON WEB SERVIC
 *   "Compra VERPEX.COM* VPX-4"            ->  VERPEX COM VPX 4
 *
 * Como la glosa viene cortada, el emparejamiento es por prefijo en las dos
 * direcciones: "AMAZON WEB SERVIC" calza con "Amazon Web Services", y "MODULAR PRO"
 * con "Modular DS" no calza — para eso están los alias que se aprenden a mano.
 */

/** Prefijos que pone el banco y que no dicen nada del proveedor. */
const PREFIJOS = [
  'COMPRA INTERNACIONAL',
  'COMPRA',
  'TRANSF A',
  'TRANSF DE',
  'TRANSF',
  'TRANSFERENCIA A',
  'TRANSFERENCIA DE',
  'PAGO EN LINEA',
  'PAGO AUTOMATICO',
  'PAGO DE',
  'PAGO',
  'CARGO POR',
  'ABONO POR',
  'ANULACION REV',
  'ANULACION',
  'GIRO',
  'GLOSA',
]

/** Mayúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Quita el número de cuenta inicial y el prefijo de operación, y deja el núcleo
 * de la glosa: lo que de verdad identifica a la contraparte.
 */
export function nucleoGlosa(descripcion: string): string {
  let texto = normalizarTexto(descripcion)

  // Las transferencias empiezan con el número de cuenta o el RUT del destinatario.
  texto = texto.replace(/^[0-9K]{6,14}\s+/i, '')

  for (const prefijo of PREFIJOS) {
    if (texto.startsWith(prefijo + ' ')) {
      texto = texto.slice(prefijo.length + 1)
      break
    }
  }
  return texto.trim()
}

/** Largo mínimo para que una coincidencia por prefijo signifique algo. */
const MINIMO = 5

/**
 * Devuelve true si la glosa y el nombre corresponden a lo mismo, tolerando que
 * el banco haya cortado el texto.
 */
export function calzan(glosa: string, nombre: string): boolean {
  const a = nucleoGlosa(glosa)
  const b = normalizarTexto(nombre)
  if (a.length < MINIMO || b.length < MINIMO) return false
  if (a === b) return true
  // El banco corta: la glosa suele ser prefijo del nombre real.
  if (a.startsWith(b) || b.startsWith(a)) return true
  // O el nombre aparece entero dentro de la glosa.
  if (a.includes(b) || b.includes(a)) return true
  return false
}

/** Busca el proveedor que calza con una glosa, mirando nombre y alias. */
export function buscarProveedor<T extends { nombre: string; alias: string[] }>(
  descripcion: string,
  proveedores: T[],
): { proveedor: T; via: 'alias' | 'nombre' } | null {
  // El alias manda: lo cargó una persona a propósito.
  for (const proveedor of proveedores) {
    for (const alias of proveedor.alias) {
      if (normalizarTexto(alias) === normalizarTexto(descripcion)) {
        return { proveedor, via: 'alias' }
      }
    }
  }
  for (const proveedor of proveedores) {
    for (const alias of proveedor.alias) {
      if (calzan(descripcion, alias)) return { proveedor, via: 'alias' }
    }
  }
  // Entre varios calces por nombre gana el más largo, que es el más específico.
  let mejor: { proveedor: T; largo: number } | null = null
  for (const proveedor of proveedores) {
    if (!calzan(descripcion, proveedor.nombre)) continue
    const largo = normalizarTexto(proveedor.nombre).length
    if (!mejor || largo > mejor.largo) mejor = { proveedor, largo }
  }
  return mejor ? { proveedor: mejor.proveedor, via: 'nombre' } : null
}
