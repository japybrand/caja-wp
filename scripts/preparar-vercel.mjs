// Arma el archivo de variables de entorno para Vercel.
//
//   node scripts/preparar-vercel.mjs
//
// Escribe `.env.vercel` con todo lo que necesita produccion: lo que se copia de
// .env.local, lo que se genera nuevo y lo que falta por completar a mano. El panel
// de Vercel acepta pegar un archivo .env completo en Settings -> Environment
// Variables -> Import .env, asi que esto se resuelve en un solo pegado.
//
// POR QUE UN ARCHIVO Y NO IMPRIMIRLAS
// Los valores no salen por pantalla en ningun momento: solo los nombres y de donde
// sale cada uno. Un secreto impreso en la terminal queda en el scrollback, en el
// historial y en la transcripcion de la conversacion, que son tres lugares mas de
// los que hacen falta. El archivo esta en .gitignore y se borra cuando ya se pego.

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/** Lee un .env a un mapa. No imprime nada. */
function leer(ruta) {
  if (!existsSync(ruta)) return {}
  const salida = {}
  for (const linea of readFileSync(ruta, 'utf-8').split('\n')) {
    const t = linea.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const [clave, ...resto] = t.split('=')
    salida[clave.trim()] = resto.join('=').trim().replace(/^["']|["']$/g, '')
  }
  return salida
}

const local = { ...leer('.env'), ...leer('.env.local') }
const produccion = leer('.env.produccion')

/** 32 bytes al azar, que es lo que piden Auth.js y el guardia del cron. */
const secreto = () => randomBytes(32).toString('base64')

const FALTA = ''

const variables = [
  // [nombre, valor, de donde sale]
  ['DATABASE_URL', produccion.DATABASE_URL ?? FALTA, 'de .env.produccion'],
  ['DIRECT_URL', produccion.DIRECT_URL ?? FALTA, 'de .env.produccion'],

  // Nuevos: no se comparte el secreto de desarrollo con produccion. Si el de
  // desarrollo se filtra alguna vez, no sirve para firmar sesiones reales.
  ['AUTH_SECRET', secreto(), 'GENERADO nuevo'],
  ['CRON_SECRET', secreto(), 'GENERADO nuevo'],

  ['AUTH_URL', 'https://caja.japybrand.com', 'fijo'],
  // Auth.js v5 lo exige detras del proxy de Vercel: sin esto el callback de Google
  // se arma con el host interno y el login falla con un error que no lo explica.
  ['AUTH_TRUST_HOST', 'true', 'fijo'],

  // El mismo de desarrollo, obligatorio: cifra el refresh token de Gmail que se
  // acaba de migrar. Con otra clave el token no se puede descifrar y hay que
  // volver a autorizar el acceso a Gmail.
  ['ENCRYPTION_KEY', local.ENCRYPTION_KEY ?? FALTA, 'MISMO de .env.local (obligatorio)'],

  // El mismo cliente OAuth, con los dos redirects configurados en Google Cloud.
  ['GOOGLE_CLIENT_ID', local.GOOGLE_CLIENT_ID ?? FALTA, 'de .env.local'],
  ['GOOGLE_CLIENT_SECRET', local.GOOGLE_CLIENT_SECRET ?? FALTA, 'de .env.local'],
  ['ANTHROPIC_API_KEY', local.ANTHROPIC_API_KEY ?? FALTA, 'de .env.local'],
  ['ALLOWED_EMAILS', local.ALLOWED_EMAILS ?? 'finanzas@japybrand.cl', 'de .env.local'],
  ['NEXT_PUBLIC_ANIO_ACTIVO', local.NEXT_PUBLIC_ANIO_ACTIVO ?? '2026', 'de .env'],

  ['RESEND_API_KEY', local.RESEND_API_KEY ?? FALTA, 'PEGAR de resend.com'],
  ['ALERTAS_REMITENTE', 'caja@japybrand.com', 'fijo, dominio verificado en Resend'],
  ['ALERTAS_DESTINO', 'finanzas@japybrand.cl', 'fijo'],
]

const cuerpo = [
  '# Variables de entorno de Caja WP en produccion.',
  '# Generado por scripts/preparar-vercel.mjs. NO se versiona.',
  '# Pegar entero en Vercel: Settings -> Environment Variables -> Import .env',
  '# Borrar este archivo despues de pegarlo.',
  '',
  ...variables.map(([nombre, valor]) => `${nombre}="${valor}"`),
  '',
].join('\n')

writeFileSync('.env.vercel', cuerpo, 'utf-8')

console.log('Escrito .env.vercel con', variables.length, 'variables.\n')
const ancho = Math.max(...variables.map(([n]) => n.length))
let faltan = 0
for (const [nombre, valor, origen] of variables) {
  const estado = valor === FALTA ? 'FALTA' : `${String(valor.length).padStart(3)} caracteres`
  if (valor === FALTA) faltan += 1
  console.log(`  ${nombre.padEnd(ancho)}  ${estado.padStart(14)}   ${origen}`)
}
console.log('\nNingun valor se imprimio: solo los nombres y su largo.')
if (faltan > 0) {
  console.log(`\nFaltan ${faltan} por completar a mano dentro del archivo.`)
}
console.log('\nAbrelo, pegalo en Vercel y despues borralo:  rm .env.vercel')
