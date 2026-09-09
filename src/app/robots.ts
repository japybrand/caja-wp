import type { MetadataRoute } from 'next'

/**
 * robots.txt: fuera de todos los buscadores.
 *
 * Esto no es una web pública. Es el flujo de caja de la empresa, y aunque el
 * middleware exige sesión para todo, la pantalla de login sí es accesible sin
 * autenticarse: sin este archivo, `caja-wp.vercel.app` podría terminar indexada y
 * dejar el nombre de la empresa asociado a una app de finanzas en los resultados de
 * búsqueda.
 *
 * Va como ruta y no como archivo estático en `public/` para que quede junto al
 * `metadata.robots` del layout: las dos cosas dicen lo mismo y conviene que se
 * editen juntas. Se sirve en /robots.txt igual.
 *
 * ROBOTS.TXT NO ES UNA MEDIDA DE SEGURIDAD
 * Es una petición que los buscadores serios respetan y cualquier otro ignora. Lo
 * que de verdad protege la app es la sesión de Auth.js en el middleware; esto solo
 * evita que aparezca en Google.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  }
}
