/**
 * Corre la ingesta desde la terminal, contra la misma función que usa el botón
 * "Sincronizar ahora" de /movimientos.
 *
 *   npm run sincronizar -- --dias 7 --revisar
 *
 *   --dias N     ventana hacia atrás (por defecto 7)
 *   --desde F    fecha AAAA-MM-DD, gana sobre --dias
 *   --hasta F    fecha AAAA-MM-DD
 *   --revisar    fuerza todo a por_revisar, sin confirmar nada
 */

import { PrismaClient } from '@prisma/client'
import { ejecutarIngesta, type OpcionesIngesta } from '../src/lib/ingesta'

const prisma = new PrismaClient()

const alinear = (t: string, a: number): string => (t.length > a ? t.slice(0, a - 1) + '…' : t.padEnd(a))
const derecha = (t: string, a: number): string => (t.length > a ? t.slice(0, a) : t.padStart(a))
const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const cuenta = await prisma.cuentaGoogle.findFirst()
  if (!cuenta) {
    console.error('No hay cuenta de Google conectada. Entra a /login primero.')
    process.exitCode = 1
    return
  }

  const desde = argumento('desde')
  const hasta = argumento('hasta')
  const opciones: OpcionesIngesta = {
    origen: 'manual',
    dias: Number(argumento('dias') ?? 7),
    forzarRevision: process.argv.includes('--revisar'),
    ...(desde ? { desde: new Date(`${desde}T00:00:00.000Z`) } : {}),
    ...(hasta ? { hasta: new Date(`${hasta}T00:00:00.000Z`) } : {}),
  }

  console.log(`Cuenta        ${cuenta.email}`)
  console.log(`Ventana       ${desde ? `${desde} a ${hasta ?? 'hoy'}` : `últimos ${opciones.dias} días`}`)
  console.log(`Confirmación  ${opciones.forzarRevision ? 'DESACTIVADA (todo a por_revisar)' : 'automática sobre 0,85'}`)
  console.log('\nProcesando …\n')

  const inicio = Date.now()
  const r = await ejecutarIngesta(opciones)
  const segundos = ((Date.now() - inicio) / 1000).toFixed(1)

  console.log('═'.repeat(62))
  console.log('RESUMEN DE LA SINCRONIZACIÓN')
  console.log('═'.repeat(62))
  console.log(`  Correos encontrados       ${r.correosVistos}`)
  console.log(`  Ya vistos antes           ${r.yaProcesados}`)
  console.log(`  Movimientos creados       ${r.creados}`)
  console.log(`    · confirmados           ${r.confirmados}`)
  console.log(`    · por revisar           ${r.porRevisar}`)
  console.log(`  Descartados (sin monto)   ${r.sinMonto}`)
  console.log(`  Errores                   ${r.errores}`)
  console.log(`  Tiempo                    ${segundos}s`)

  if (r.detalle.length > 0) {
    console.log('\n' + '═'.repeat(132))
    console.log('CORREO POR CORREO')
    console.log('═'.repeat(132))
    console.log(
      alinear('Proveedor', 17) + ' │ ' + alinear('Fecha', 10) + ' │ ' + alinear('Asunto', 40) +
        ' │ ' + derecha('Monto CLP', 11) + ' │ ' + alinear('Orig.', 11) + ' │ ' +
        alinear('Conf.', 5) + ' │ Resultado',
    )
    console.log('─'.repeat(132))

    const orden = ['por_revisar', 'confirmado']
    const ordenados = [...r.detalle].sort(
      (a, b) => orden.indexOf(a.resultado) - orden.indexOf(b.resultado) || a.proveedor.localeCompare(b.proveedor, 'es'),
    )
    for (const d of ordenados) {
      const original = d.moneda === 'USD' && d.montoOriginal !== undefined ? `${d.montoOriginal} USD` : ''
      console.log(
        alinear(d.proveedor, 17) + ' │ ' + alinear(d.fecha, 10) + ' │ ' + alinear(d.asunto || '(sin asunto)', 40) +
          ' │ ' + derecha(d.montoCLP !== undefined ? fmt(d.montoCLP) : '—', 11) + ' │ ' + alinear(original, 11) +
          ' │ ' + alinear(d.confianza !== undefined ? d.confianza.toFixed(2) : '—', 5) + ' │ ' + d.resultado,
      )
      if (d.nota) console.log(' '.repeat(19) + `↳ ${d.nota}`)
    }
  }

  const porRevisar = await prisma.movimiento.count({ where: { estado: 'por_revisar' } })
  console.log(`\nMovimientos en la bandeja de revisión: ${porRevisar}. Revísalos en /movimientos.`)
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
