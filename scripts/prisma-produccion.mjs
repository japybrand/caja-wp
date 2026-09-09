// Corre un comando de la CLI de Prisma contra la base de produccion.
//
//   node --env-file=.env.produccion scripts/prisma-produccion.mjs db push
//
// La CLI de Prisma solo lee `.env` y no acepta --env-file, asi que el entorno lo
// carga Node con su propio flag y el proceso hijo lo hereda. Es la forma de apuntar
// a Supabase sin tocar el .env local, que sigue con SQLite para el desarrollo.
import { spawnSync } from 'node:child_process'

const url = process.env.DATABASE_URL ?? ''
if (!url.startsWith('postgres')) {
  console.error('DATABASE_URL no apunta a Postgres. ¿Falta .env.produccion o su clave?')
  process.exit(1)
}
// El host, sin la clave: confirma contra que base se va a correr sin filtrar nada.
const host = /@([^:/?]+)/.exec(url)?.[1] ?? '(desconocido)'
console.log(`prisma ${process.argv.slice(2).join(' ')}  ->  ${host}\n`)

const r = spawnSync('npx', ['prisma', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
process.exit(r.status ?? 1)
