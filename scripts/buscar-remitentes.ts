/**
 * Corre el descubrimiento de remitentes desde la terminal, contra la misma
 * función que usa el botón "Buscar remitentes en Gmail" de /proveedores.
 *
 *   npm run remitentes
 *
 * Útil cuando la sesión del navegador no está a mano. Necesita que alguien
 * haya entrado antes con Google, porque lee el refresh token de CuentaGoogle.
 */

import { PrismaClient } from '@prisma/client'
import { descubrirRemitentes } from '../src/lib/gmail/descubrir'

const prisma = new PrismaClient()

const alinear = (texto: string, ancho: number): string =>
  texto.length > ancho ? texto.slice(0, ancho - 1) + '…' : texto.padEnd(ancho)

async function main(): Promise<void> {
  const cuenta = await prisma.cuentaGoogle.findFirst()
  if (!cuenta) {
    console.error('No hay cuenta de Google conectada. Entra a /login primero.')
    process.exitCode = 1
    return
  }
  console.log(`Buscando en Gmail con la cuenta ${cuenta.email} …\n`)

  const inicio = Date.now()
  const resumen = await descubrirRemitentes()
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1)

  console.log('═'.repeat(70))
  console.log('RESUMEN DE LA BÚSQUEDA')
  console.log('═'.repeat(70))
  console.log(`  Proveedores buscados      ${resumen.proveedoresBuscados}`)
  console.log(`  Con al menos un candidato ${resumen.proveedoresConCandidatos}`)
  console.log(`  Candidatos nuevos         ${resumen.candidatosNuevos}`)
  console.log(`  Errores                   ${resumen.errores.length}`)
  console.log(`  Tiempo                    ${segundos}s`)

  if (resumen.errores.length > 0) {
    console.log('\n  Proveedores con error:')
    for (const error of resumen.errores) {
      console.log(`    · ${error.proveedor}: ${error.detalle}`)
    }
  }

  const candidatos = await prisma.remitenteCandidato.findMany({
    where: { estado: 'propuesto' },
    include: { proveedor: { select: { nombre: true, categoria: { select: { nombre: true } } } } },
    orderBy: [{ proveedor: { nombre: 'asc' } }, { cantidad: 'desc' }],
  })

  console.log('\n' + '═'.repeat(118))
  console.log(`CANDIDATOS PROPUESTOS (${candidatos.length})`)
  console.log('═'.repeat(118))
  console.log(
    alinear('Proveedor', 26) +
      ' │ ' +
      alinear('Remitente', 38) +
      ' │ ' +
      alinear('N°', 4) +
      ' │ ' +
      alinear('Último', 11) +
      ' │ Asunto de ejemplo',
  )
  console.log('─'.repeat(118))

  let proveedorPrevio = ''
  for (const candidato of candidatos) {
    const nombre = candidato.proveedor.nombre
    console.log(
      alinear(nombre === proveedorPrevio ? '' : nombre, 26) +
        ' │ ' +
        alinear(candidato.email, 38) +
        ' │ ' +
        alinear(String(candidato.cantidad), 4) +
        ' │ ' +
        alinear(candidato.ultimoCorreo.toISOString().slice(0, 10), 11) +
        ' │ ' +
        alinear(candidato.asuntoEjemplo || '(sin asunto)', 44),
    )
    proveedorPrevio = nombre
  }

  const sinCandidatos = await prisma.proveedor.findMany({
    where: { activo: true, remitentesEmail: '[]', candidatos: { none: {} } },
    select: { nombre: true },
    orderBy: { nombre: 'asc' },
  })
  if (sinCandidatos.length > 0) {
    console.log(`\nSin ningún candidato (${sinCandidatos.length}):`)
    console.log('  ' + sinCandidatos.map((p) => p.nombre).join(' · '))
  }

  console.log('\nNada se guardó en los proveedores todavía. Apruébalos en /proveedores.')
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
