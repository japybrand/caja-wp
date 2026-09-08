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
const actualizado = original.replace(
  /(datasource\s+db\s*\{[^}]*?provider\s*=\s*)"[^"]*"/,
  `$1"${destino}"`,
)

if (original === actualizado) {
  console.log(`El provider ya era "${destino}". Sin cambios.`)
} else {
  writeFileSync(ruta, actualizado, 'utf8')
  console.log(`Provider cambiado a "${destino}" en prisma/schema.prisma.`)
  console.log('Ahora corre:  npx prisma generate  &&  npx prisma db push')
}
