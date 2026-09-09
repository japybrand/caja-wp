/**
 * Deja el estado de TGR como es de verdad: cinco correcciones en una corrida.
 *
 *   npm run tgr            # simula
 *   npm run tgr -- --firme # aplica
 *
 * DATOS DE PRODUCCIÓN: sin --firme no escribe nada.
 *
 * EL ERROR DE FONDO: SE CONFUNDIÓ PAGAR ATRASOS CON PAGAR EL MES
 * Los cargos del 07/09 (688.740 en dos operaciones) y del 28/08 (1.767.057) son
 * pies iniciales y cuotas ATRASADAS, anteriores a los calendarios que están
 * cargados. Se habían imputado a cuotas de septiembre, que en realidad no están
 * pagadas: vencen el 30. El resultado era un septiembre que parecía medio pagado y
 * un calendario que empezaba un mes tarde.
 *
 * LAS CINCO CORRECCIONES
 *  1. El convenio 257782 parte en septiembre, no en octubre: se activó el 04/09 y el
 *     pie no cubre ningún mes. Todo su calendario se corre un mes y la última cuota
 *     pasa de febrero a enero de 2028.
 *  2. Las cuatro cuotas de septiembre vuelven a pendiente y se sueltan de los cargos
 *     que las daban por pagadas.
 *  3. Agosto recupera sus dos filas: el pie inicial de 1.014.705 y 752.352 de cuotas
 *     atrasadas, que se habían borrado creyendo que duplicaban el embargo del 26/08.
 *     No lo duplican: el embargo está en "Santander Pagos TGR", del grupo impuestos.
 *  4. Septiembre pasa a mostrar los 688.740 de atrasos efectivamente pagados, en vez
 *     de 257.342. Los dos cargos quedan imputados a la fila que no depende del
 *     calendario, porque si fueran a "TGR convenio" el calendario los pisaría: ese
 *     override REEMPLAZA el valor manual en los meses que tienen cuota.
 *  5. Las notas de los dos cargos dicen lo que son.
 *
 * POR QUÉ LOS ATRASOS VIVEN EN LA FILA DEL PIE
 * Es la única fila de TGR que no maneja el calendario, y ya venía conteniendo cosas
 * que no son pies: los 771.640 de mayo son giros F21 anteriores a los convenios. En
 * los hechos es "TGR fuera del calendario". Convendría renombrarla, pero eso toca el
 * catálogo, el importador y la base a la vez, así que se deja anotado y aparte.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const FIRME = process.argv.includes('--firme')
const ANIO = 2026

const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))
const MC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** Un mes hacia atrás, cruzando el cambio de año. */
const anterior = (anio: number, mes: number): { anio: number; mes: number } =>
  mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 }

/** El valor que debe quedar en cada fila manual, con su procedencia. */
const VALORES = [
  // Agosto: el pie de los convenios 248426 y 257782, pagado el 28/08.
  { categoria: 'TGR pie inicial', mes: 8, monto: 1_014_705, origen: 'comprobante' },
  // Agosto: cuotas atrasadas pagadas el 28/08.
  { categoria: 'TGR convenio', mes: 8, monto: 752_352, origen: 'comprobante' },
  // Septiembre: los dos cargos del 07/09, que son atrasos y no cuotas del mes.
  { categoria: 'TGR pie inicial', mes: 9, monto: 688_740, origen: 'banco' },
]

async function main(): Promise<void> {
  const categorias = new Map(
    (await prisma.categoria.findMany({ where: { grupo: 'deudas' } })).map((c) => [c.nombre, c]),
  )
  const pieInicial = categorias.get('TGR pie inicial')
  if (!pieInicial) throw new Error('No existe la fila "TGR pie inicial".')

  // ── 1. El calendario del 257782 ──────────────────────────────────────────
  const convenio = await prisma.obligacionFinanciera.findFirst({
    where: { numero: '257782' },
    include: { cuotas: { orderBy: [{ anio: 'asc' }, { mes: 'asc' }] } },
  })
  if (!convenio) throw new Error('No existe el convenio 257782.')
  const primera = convenio.cuotas[0]
  const ultima = convenio.cuotas.at(-1)
  if (!primera || !ultima) throw new Error('El convenio 257782 no tiene cuotas.')
  const nuevaPrimera = anterior(primera.anio, primera.mes)
  const nuevaUltima = anterior(ultima.anio, ultima.mes)

  console.log('1. CALENDARIO DEL CONVENIO 257782')
  console.log(
    `   ${MC[primera.mes - 1]} ${primera.anio} → ${MC[ultima.mes - 1]} ${ultima.anio}` +
      `   pasa a   ${MC[nuevaPrimera.mes - 1]} ${nuevaPrimera.anio} → ${MC[nuevaUltima.mes - 1]} ${nuevaUltima.anio}`,
  )
  console.log(`   ${convenio.cuotas.length} cuotas, total ${clp(convenio.cuotas.reduce((a, c) => a + c.monto, 0))}, sin cambio`)

  // ── 2. Las cuotas de septiembre vuelven a pendiente ──────────────────────
  const deSeptiembre = await prisma.cuotaObligacion.findMany({
    where: { anio: ANIO, mes: 9, obligacion: { tipo: 'convenio_tgr' } },
    include: { obligacion: true },
  })
  console.log('\n2. CUOTAS DE SEPTIEMBRE DE LOS CONVENIOS')
  for (const c of deSeptiembre) {
    console.log(
      `   ${c.obligacion.numero.padEnd(8)} ${clp(c.monto).padStart(11)}  ${c.estado} → pendiente` +
        (c.movimientoBancarioId ? '   (se suelta del cargo del 07/09)' : ''),
    )
  }
  console.log(`   ${convenio.numero.padEnd(8)} ${clp(convenio.cuotaMensual).padStart(11)}  se crea al correr el calendario, pendiente`)
  const totalSeptiembre = deSeptiembre.reduce((a, c) => a + c.monto, 0) + convenio.cuotaMensual
  console.log(`   total de septiembre, todo pendiente al 30: ${clp(totalSeptiembre)}`)

  // ── 3 y 4. Las filas manuales ────────────────────────────────────────────
  console.log('\n3 y 4. FILAS DEL FLUJO')
  let delta = 0
  for (const v of VALORES) {
    const categoria = categorias.get(v.categoria)
    if (!categoria) throw new Error(`No existe la fila "${v.categoria}".`)
    const actual = await prisma.valorManual.findUnique({
      where: { categoriaId_anio_mes: { categoriaId: categoria.id, anio: ANIO, mes: v.mes } },
    })
    const antes = actual?.montoCLP ?? 0
    delta += v.monto - antes
    console.log(
      `   ${MC[v.mes - 1]}  ${v.categoria.padEnd(18)} ${clp(antes).padStart(11)} → ${clp(v.monto).padStart(11)}   origen ${v.origen}`,
    )
  }
  console.log(`   efecto directo en los egresos: ${clp(delta)}`)
  console.log(
    `   más la cuota que gana septiembre por el calendario: ${clp(convenio.cuotaMensual)}`,
  )

  if (!FIRME) {
    console.log('\nSimulación. Repite con --firme para aplicarlo.')
    return
  }

  // De la más antigua a la más nueva: hay un índice único por (obligación, año, mes)
  // y así el destino siempre está libre justo antes de escribirlo.
  for (const cuota of convenio.cuotas) {
    const destino = anterior(cuota.anio, cuota.mes)
    await prisma.cuotaObligacion.update({
      where: { id: cuota.id },
      data: { anio: destino.anio, mes: destino.mes },
    })
  }
  await prisma.obligacionFinanciera.update({
    where: { id: convenio.id },
    data: {
      fechaUltimaCuota: new Date(Date.UTC(nuevaUltima.anio, nuevaUltima.mes - 1, 30, 12)),
      nota:
        'La primera cuota es de septiembre de 2026, el mismo mes de la activación. El pie ' +
        'inicial se pagó el 28/08/2026 y es aparte de las cuotas: no cubre ningún mes.',
    },
  })

  await prisma.cuotaObligacion.updateMany({
    where: { anio: ANIO, mes: 9, obligacion: { tipo: 'convenio_tgr' } },
    data: { estado: 'pendiente', fechaPago: null, movimientoBancarioId: null },
  })

  for (const v of VALORES) {
    const categoria = categorias.get(v.categoria)
    if (!categoria) continue
    await prisma.valorManual.upsert({
      where: { categoriaId_anio_mes: { categoriaId: categoria.id, anio: ANIO, mes: v.mes } },
      create: {
        categoriaId: categoria.id,
        anio: ANIO,
        mes: v.mes,
        montoCLP: v.monto,
        origen: v.origen,
      },
      update: { montoCLP: v.monto, origen: v.origen },
    })
  }

  // ── 5. Los dos cargos del 07/09 dicen lo que son ─────────────────────────
  const cargos = await prisma.movimientoBancario.findMany({
    where: { anio: ANIO, mes: 9, descripcion: { contains: 'T.G.R' } },
  })
  for (const cargo of cargos) {
    await prisma.movimientoBancario.update({
      where: { id: cargo.id },
      data: {
        categoriaManualId: pieInicial.id,
        notaConciliacion:
          'cuotas atrasadas de TGR pagadas el 07/09/2026, junto con el otro cargo del mismo ' +
          'día: 688.740 en total. No son cuotas de septiembre, que vencen el 30 y siguen impagas',
      },
    })
  }

  console.log(`\nAplicado: calendario corrido, ${deSeptiembre.length + 1} cuotas pendientes, ${VALORES.length} filas y ${cargos.length} cargos actualizados.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
