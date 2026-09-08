// Alterna el provider de prisma/schema.prisma entre sqlite y postgresql.
//   node scripts/db-provider.mjs postgresql
// No hay cambios en el codigo de la aplicacion: solo esta linea y DATABASE_URL.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VALIDOS = ['sqlite', 'postgresql']
const destino = process.argv[2]

if (!VALIDOS.includes(destino)) {
  console.error(`Uso: node scripts/db-provider.mjs <${VALIDOS.join('|')}>`)
  process.exit(1)
}

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ruta = path.join(raiz, 'prisma', 'schema.prisma')
const original = readFileSync(ruta, 'utf8')

/*
 * El bloque datasource entero se reescribe, no solo el provider.
 *
 * PostgreSQL necesita `directUrl`: en Supabase la app se conecta por el pooler
 * (puerto 6543) porque las funciones serverless abren y cierran conexiones todo el
 * tiempo, pero `prisma db push` y `prisma migrate` NO pueden pasar por el pooler y
 * necesitan la conexion directa (5432). Sin esta linea, el primer db push contra
 * Supabase falla.
 *
 * SQLite no lleva `directUrl`: si la linea queda ahi, Prisma exige que DIRECT_URL
 * exista y el entorno local deja de arrancar.
 */
const BLOQUES = {
  sqlite: `datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}`,
  postgresql: `datasource db {
  provider  = "postgresql"
  // El pooler de Supabase, puerto 6543. Es el que usa la aplicacion.
  url       = env("DATABASE_URL")
  // Conexion directa, puerto 5432. Solo para db push y migrate.
  directUrl = env("DIRECT_URL")
}`,
}

const actualizado = original.replace(/datasource\s+db\s*\{[^}]*\}/, BLOQUES[destino])

if (original === actualizado) {
  console.log(`El provider ya era "${destino}". Sin cambios.`)
} else {
  writeFileSync(ruta, actualizado, 'utf8')
  console.log(`Provider cambiado a "${destino}" en prisma/schema.prisma.`)
  if (destino === 'postgresql') {
    console.log('Necesitas DATABASE_URL (pooler, 6543) y DIRECT_URL (directa, 5432).')
  }
  console.log('Ahora corre:  npx prisma generate  &&  npx prisma db push')
}
