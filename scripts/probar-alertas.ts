/**
 * Muestra qué avisos saldrían en una fecha, sin mandar nada.
 *
 *   npm run probar-alertas -- --fecha 2026-10-11
 *   npm run probar-alertas -- --fecha 2026-10-12 --firme
 *
 * Sin `--fecha` usa hoy. Sin `--firme` no envía ni registra en AvisoEnviado, así
 * que se puede correr las veces que haga falta.
 *
 * Existe porque tres de las cuatro reglas dependen del calendario: una se dispara
 * el día 11, otra los lunes y la de vencimientos mira cinco días hacia adelante.
 * Sin poder mover la fecha, probarlas significaría esperar al día correcto.
 */

import { ejecutarAlertas, evaluarAlertas, enSantiago } from '../src/lib/alertas'
import { componer } from '../src/lib/correo/plantilla'
import { destino, remitente } from '../src/lib/correo/enviar'

const FIRME = process.argv.includes('--firme')
const i = process.argv.indexOf('--fecha')
const arg = i >= 0 ? process.argv[i + 1] : undefined
// Mediodía UTC: cae dentro del mismo día en Santiago con cualquiera de los dos husos.
const hoy = arg ? new Date(`${arg}T12:00:00Z`) : new Date()

async function main(): Promise<void> {
  const s = enSantiago(hoy)
  const semana = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
  console.log(`fecha: ${hoy.toISOString()}`)
  console.log(`en Santiago: ${s.dia}/${s.mes}/${s.anio}, ${semana[s.diaSemana - 1]}`)
  console.log(`de ${remitente()} para ${destino()}\n`)

  const reglas = await evaluarAlertas(hoy)
  if (reglas.length === 0) {
    console.log('Ninguna regla se dispara con esta fecha.')
    return
  }

  for (const regla of reglas) {
    const { asunto, texto } = componer(regla.aviso)
    console.log('─'.repeat(78))
    console.log(`[${regla.tipo} · ${regla.clave}] repetir cada ${regla.repetirCadaDias || '—'} días`)
    console.log(`ASUNTO: ${asunto}\n`)
    console.log(texto)
    console.log('')
  }

  console.log('─'.repeat(78))
  const r = await ejecutarAlertas({ hoy, seco: !FIRME })
  console.log(
    `evaluadas ${r.evaluadas}, ${FIRME ? 'enviadas' : 'se enviarían'} ${r.enviados}, ` +
      `omitidas ${r.omitidos}, fallidas ${r.fallidos}`,
  )
  for (const d of r.detalle) console.log(`  ${d.estado.padEnd(14)} ${d.tipo}/${d.clave}`)
  if (!FIRME) console.log('\nSimulación. Repite con --firme para enviar de verdad.')
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
