/**
 * Comprueba que se puede llegar a la base de producción antes de migrar nada.
 *
 *   npm run migrar:probar
 *
 * NO ESCRIBE NADA. Solo abre la conexión, mira qué hay y lo informa.
 *
 * NUNCA IMPRIME LA CLAVE
 * Los mensajes de error de Postgres y de Prisma a veces traen la cadena de conexión
 * entera, con la contraseña adentro. Todo lo que sale por pantalla pasa antes por
 * `enmascarar`, que la reemplaza por asteriscos. Sin eso, un error de conexión
 * habría dejado la clave en la terminal y en el historial.
 *
 * EXISTE PORQUE EL PRIMER INTENTO ES EL QUE FALLA
 * Entre la clave sin codificar, el puerto equivocado y el host del pooler, hay tres
 * formas distintas de que la conexión no funcione, y cada una da un error que no
 * dice cuál de las tres es. Este script las distingue.
 */

import { PrismaClient } from '@prisma/client'

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)

/** Reemplaza la contraseña de cualquier URL de Postgres que aparezca en el texto. */
function enmascarar(texto: string): string {
  return texto.replace(/(postgres(?:ql)?:\/\/[^:@\s]+:)([^@\s]+)(@)/g, '$1********$3')
}

function describir(url: string | undefined, nombre: string): void {
  if (!url) {
    console.log(`  ${nombre.padEnd(13)} NO está definida`)
    return
  }
  const m = /^(\w+):\/\/([^:]+):([^@]*)@([^:/?]+):(\d+)/.exec(url)
  if (!m) {
    console.log(`  ${nombre.padEnd(13)} no parece una URL de Postgres`)
    return
  }
  const [, , usuario, clave, host, puerto] = m
  console.log(`  ${nombre.padEnd(13)} ${usuario}@${host}:${puerto}  (clave de ${clave?.length ?? 0} caracteres)`)

  // Los caracteres que rompen una URL si no van codificados. Detectarlos aquí evita
  // perder el rato con un "authentication failed" que en realidad es de sintaxis.
  const sospechosos = [...new Set((clave ?? '').match(/[^A-Za-z0-9\-._~%]/g) ?? [])]
  if (sospechosos.length > 0) {
    console.log(
      `  ${' '.repeat(13)} OJO: la clave trae ${sospechosos.map((c) => `"${c}"`).join(' ')} sin codificar. ` +
        'Pásala por encodeURIComponent.',
    )
  }
}

async function main(): Promise<void> {
  console.log('CONEXIONES CONFIGURADAS')
  describir(process.env.DATABASE_URL, 'DATABASE_URL')
  describir(process.env.DIRECT_URL, 'DIRECT_URL')

  if (!(process.env.DATABASE_URL ?? '').startsWith('postgres')) {
    console.log('\nDATABASE_URL no apunta a Postgres.')
    console.log('\nFalta crear .env.produccion. Copia la plantilla y pon tu clave:')
    console.log('  cp .env.produccion.example .env.produccion')
    console.log('\nEstá en .gitignore, así que no se versiona.')
    process.exitCode = 1
    return
  }

  const prisma = new PrismaClient()
  try {
    const inicio = Date.now()
    const version = await prisma.$queryRaw<{ v: string }[]>`select version() as v`
    console.log(`\nCONEXIÓN OK en ${Date.now() - inicio} ms`)
    console.log(`  ${(version[0]?.v ?? '').slice(0, 60)}`)

    // Si las tablas no existen todavía, esto falla y se informa como tal: es el
    // estado normal antes del primer db push.
    try {
      const filas = await prisma.movimiento.count()
      const bancarios = await prisma.movimientoBancario.count()
      console.log(`\nLA BASE YA TIENE TABLAS`)
      console.log(`  movimientos ${clp(filas)}   movimientos bancarios ${clp(bancarios)}`)
      if (filas > 0) {
        console.log('  Ojo: ya hay datos. El importador hace upsert por id, así que no duplica.')
      }
    } catch {
      console.log('\nLA BASE ESTÁ VACÍA: faltan las tablas. El siguiente paso es db push.')
    }
  } catch (e: unknown) {
    const mensaje = enmascarar(e instanceof Error ? e.message : String(e))
    console.log('\nNO SE PUDO CONECTAR')
    console.log(mensaje.split('\n').slice(0, 6).join('\n'))
    console.log('\nLo más probable, en este orden:')
    console.log('  1. La clave tiene caracteres especiales sin codificar.')
    console.log('  2. Se copió la clave equivocada, o quedó el [YOUR-PASSWORD] del ejemplo.')
    console.log('  3. El proyecto de Supabase todavía está arrancando.')
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(enmascarar(e instanceof Error ? e.message : String(e)))
  process.exitCode = 1
})
