/**
 * Carga los convenios de la Tesoreria, la linea Fogape y las cotizaciones
 * previsionales, y engancha cada uno con el cargo del banco que lo pago.
 *
 *   npm run cargar-obligaciones            (simulacion)
 *   npm run cargar-obligaciones -- --firme
 *
 * Es idempotente: se puede correr de nuevo cuando cambien las cuotas o llegue una
 * cartola nueva.
 *
 * DERIVACION DEL CALENDARIO
 * El dato firme de un convenio de TGR no es cuando empieza sino cuando termina: la
 * fecha de la ultima cuota y cuantas quedan. El calendario se reconstruye contando
 * hacia atras desde ahi. Comprobacion: con esta derivacion los cuatro convenios
 * suman 28.361.006 en cuotas ya emitidas y 30.327.911 contando las cuatro por
 * generar, que es exactamente lo que informa el portal.
 *
 * LA ULTIMA CUOTA DE CADA CONVENIO
 * TGR emite las cuotas por tramos y siempre deja una sin emitir. Esa queda en
 * estado por_generar: esta comprometida y hay que pagarla, pero todavia no existe
 * como documento.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(n)
const d = (iso: string): Date => new Date(`${iso}T12:00:00Z`)

/** Hoy, para decidir que esta pendiente y que esta atrasado. */
const HOY = d('2026-09-08')

interface Definicion {
  tipo: 'convenio_tgr' | 'linea_credito'
  institucion: string
  numero: string
  marco: string
  fechaActivacion: string
  cuotaMensual: number
  fechaUltimaCuota: string
  cuotasPorGenerar: number
  /// Fila manual del flujo que esta obligacion alimenta.
  fila: string
  nota?: string
  /**
   * Cuotas pendientes segun el portal, sin contar las por generar. El calendario
   * se deriva contando hacia atras desde la ultima.
   */
  cuotasPendientes?: number
  /** Para la linea de credito, cuyas cuotas no son parejas. */
  calendario?: { anio: number; mes: number; monto: number }[]
}

const DEFINICIONES: Definicion[] = [
  {
    tipo: 'convenio_tgr',
    institucion: 'TGR',
    numero: '100309',
    marco: 'Ley 20.780',
    fechaActivacion: '2026-05-07',
    cuotaMensual: 320_954,
    cuotasPendientes: 7,
    cuotasPorGenerar: 1,
    fechaUltimaCuota: '2027-04-30',
    fila: 'TGR convenio',
  },
  {
    tipo: 'convenio_tgr',
    institucion: 'TGR',
    numero: '133768',
    marco: 'ProPyme',
    fechaActivacion: '2026-06-07',
    cuotaMensual: 110_444,
    cuotasPendientes: 14,
    cuotasPorGenerar: 1,
    fechaUltimaCuota: '2027-11-30',
    fila: 'TGR convenio',
  },
  {
    tipo: 'convenio_tgr',
    institucion: 'TGR',
    numero: '248426',
    marco: 'ProPyme',
    fechaActivacion: '2026-08-28',
    cuotaMensual: 1_233_109,
    cuotasPendientes: 16,
    cuotasPorGenerar: 1,
    fechaUltimaCuota: '2028-01-31',
    fila: 'TGR convenio',
  },
  {
    tipo: 'convenio_tgr',
    institucion: 'TGR',
    numero: '257782',
    marco: 'ProPyme',
    fechaActivacion: '2026-09-04',
    cuotaMensual: 302_398,
    cuotasPendientes: 16,
    cuotasPorGenerar: 1,
    fechaUltimaCuota: '2028-02-29',
    fila: 'TGR convenio',
  },
  {
    tipo: 'linea_credito',
    institucion: 'Maxxa',
    numero: 'Fogape',
    marco: 'Fogape',
    fechaActivacion: '2026-04-06',
    cuotaMensual: 870_000,
    cuotasPorGenerar: 0,
    fechaUltimaCuota: '2027-07-05',
    fila: 'Fogape - cuotas',
    nota: 'Penta Hipotecario es la razón social de Maxxa. Línea de 8.700.000 girada por completo.',
    // Las tres primeras cuotas no son parejas y la ultima es el saldo: van explicitas.
    calendario: [
      { anio: 2026, mes: 5, monto: 230_000 },
      { anio: 2026, mes: 6, monto: 400_000 },
      { anio: 2026, mes: 7, monto: 872_542 },
      ...Array.from({ length: 11 }, (_, i) => {
        const idx = 2026 * 12 + 7 + i // agosto 2026 en adelante
        return { anio: Math.floor(idx / 12), mes: (idx % 12) + 1, monto: 870_000 }
      }),
      { anio: 2027, mes: 7, monto: 411_695 },
    ],
  },
]

/** Reconstruye el calendario contando hacia atras desde la ultima cuota. */
function derivarCalendario(def: Definicion): { anio: number; mes: number; monto: number }[] {
  if (def.calendario) return def.calendario
  const total = (def.cuotasPendientes ?? 0) + def.cuotasPorGenerar
  const fin = d(def.fechaUltimaCuota)
  const finIdx = fin.getUTCFullYear() * 12 + fin.getUTCMonth()
  return Array.from({ length: total }, (_, i) => {
    const idx = finIdx - (total - 1) + i
    return { anio: Math.floor(idx / 12), mes: (idx % 12) + 1, monto: def.cuotaMensual }
  })
}

/**
 * Cotizaciones previsionales, segun los certificados de Previred de 2025 y 2026.
 *
 * `monto` es lo que salio de la cuenta y `certificado` lo que Previred certifica
 * por Felipe Molina. La diferencia hasta mayo de 2026 es Cristian Andres; en junio
 * quedan 40.617, que es su mes parcial antes del finiquito.
 *
 * La fecha de pago del certificado y la del banco no siempre coinciden: abril de
 * 2026 se pago el viernes 29/05 y el banco lo cargo el lunes 01/06.
 *
 * DE ENERO A OCTUBRE DE 2025 NO HAY CARTOLA, asi que ahi `monto` es el certificado
 * y no lo que realmente salio de la cuenta: falta lo cotizado por Cristian Andres.
 * Quedan marcados en la nota.
 *
 * PAGAR DE A DOS PERIODOS
 * Cuando se acumula rezago, los periodos se ponen al dia de a pares: julio y agosto
 * de 2025 se pagaron el 30/09, septiembre y octubre el 19/12, noviembre y diciembre
 * el 20/02/2026. La cartola muestra que eso son DOS planillas el mismo dia, con dos
 * cargos separados y folios correlativos, no un cargo por los dos periodos.
 */
const SIN_CARTOLA =
  'Sin cartola de ese mes: el monto es lo certificado por Felipe, no el cargo total del banco.'

const COTIZACIONES: {
  anio: number
  mes: number
  monto: number
  certificado: number
  estado: 'pagada' | 'atrasada' | 'pendiente'
  fechaPago?: string
  fechaVencimiento?: string
  nota?: string
}[] = [
  // 2025. Sin cartola hasta octubre: el monto es el certificado, no el cargo real.
  { anio: 2025, mes: 1, monto: 361_503, certificado: 361_503, estado: 'pagada', fechaPago: '2025-02-13', nota: SIN_CARTOLA },
  { anio: 2025, mes: 2, monto: 361_503, certificado: 361_503, estado: 'pagada', fechaPago: '2025-04-02', nota: SIN_CARTOLA },
  { anio: 2025, mes: 3, monto: 361_503, certificado: 361_503, estado: 'pagada', fechaPago: '2025-05-06', nota: SIN_CARTOLA },
  { anio: 2025, mes: 4, monto: 368_629, certificado: 368_629, estado: 'pagada', fechaPago: '2025-06-06', nota: SIN_CARTOLA },
  { anio: 2025, mes: 5, monto: 368_925, certificado: 368_925, estado: 'pagada', fechaPago: '2025-07-15', nota: SIN_CARTOLA },
  { anio: 2025, mes: 6, monto: 368_925, certificado: 368_925, estado: 'pagada', fechaPago: '2025-08-01', nota: SIN_CARTOLA },
  { anio: 2025, mes: 7, monto: 362_173, certificado: 362_173, estado: 'pagada', fechaPago: '2025-09-30', nota: SIN_CARTOLA },
  { anio: 2025, mes: 8, monto: 379_987, certificado: 379_987, estado: 'pagada', fechaPago: '2025-09-30', nota: SIN_CARTOLA },
  { anio: 2025, mes: 9, monto: 379_987, certificado: 379_987, estado: 'pagada', fechaPago: '2025-12-19', nota: SIN_CARTOLA },
  { anio: 2025, mes: 10, monto: 373_039, certificado: 373_039, estado: 'pagada', fechaPago: '2025-12-19', nota: SIN_CARTOLA },
  // Noviembre y diciembre certifican lo mismo, 373.039, asi que el certificado no
  // los distingue. Los ordena el folio de la cartola: la planilla 404332975 por
  // 418.532 entro antes que la 404333366 por 411.100, y al ponerse al dia se paga
  // primero el periodo mas viejo.
  { anio: 2025, mes: 11, monto: 418_532, certificado: 373_039, estado: 'pagada', fechaPago: '2026-02-20' },
  { anio: 2025, mes: 12, monto: 411_100, certificado: 373_039, estado: 'pagada', fechaPago: '2026-02-20' },

  { anio: 2026, mes: 1, monto: 761_272, certificado: 373_930, estado: 'pagada', fechaPago: '2026-03-11' },
  { anio: 2026, mes: 2, monto: 766_551, certificado: 399_032, estado: 'pagada', fechaPago: '2026-03-11' },
  { anio: 2026, mes: 3, monto: 775_732, certificado: 399_032, estado: 'pagada', fechaPago: '2026-04-13' },
  { anio: 2026, mes: 4, monto: 778_661, certificado: 391_923, estado: 'pagada', fechaPago: '2026-05-29' },
  { anio: 2026, mes: 5, monto: 730_370, certificado: 391_923, estado: 'pagada', fechaPago: '2026-06-05' },
  { anio: 2026, mes: 6, monto: 432_540, certificado: 391_923, estado: 'pagada', fechaPago: '2026-08-05' },
  {
    anio: 2026,
    mes: 7,
    monto: 391_923,
    certificado: 0,
    estado: 'atrasada',
    nota: 'Impaga. El monto es la proyección del Excel, que coincide con lo certificado desde abril.',
  },
  {
    anio: 2026,
    mes: 8,
    monto: 391_923,
    certificado: 0,
    estado: 'pendiente',
    fechaVencimiento: '2026-09-13',
    nota: 'El monto es la proyección: todavía no hay certificado ni cargo en la cartola.',
  },
]

/**
 * Busca el cargo del banco que pago una cotizacion.
 *
 * La ventana de fechas no es decorativa: sin ella, un periodo de 2025 cuyo monto
 * coincida por casualidad con un cargo de 2026 se enlazaria al cargo equivocado.
 * Se busca dentro de los 20 dias posteriores a la fecha de la planilla, porque el
 * banco puede cargar uno o dos dias habiles despues.
 */
async function cargoDeCotizacion(
  monto: number,
  fechaPago: string | undefined,
): Promise<{ id: string; fecha: Date } | null> {
  if (!fechaPago) return null
  // La cartola guarda la fecha a medianoche y `d()` construye al mediodia, asi que
  // la ventana parte un dia antes: si no, un cargo del mismo dia queda fuera.
  const desde = new Date(d(fechaPago).getTime() - 24 * 3600 * 1000)
  const hasta = new Date(desde.getTime() + 21 * 24 * 3600 * 1000)
  return prisma.movimientoBancario.findFirst({
    where: {
      descripcion: { contains: 'PREVIRED' },
      monto: -monto,
      fecha: { gte: desde, lte: hasta },
    },
    select: { id: true, fecha: true },
  })
}

/**
 * Dias de atraso respecto del vencimiento legal, que es el dia 13 del mes siguiente
 * al periodo cuando se paga por internet. Es la medida que hace visible el rezago:
 * en 2025 llego a 97 dias.
 */
function diasDeAtraso(anio: number, mes: number, fechaPago: string | undefined): number | null {
  if (!fechaPago) return null
  const vence = new Date(Date.UTC(anio, mes, 13, 12))
  const dias = Math.round((d(fechaPago).getTime() - vence.getTime()) / (24 * 3600 * 1000))
  return dias > 0 ? dias : 0
}

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  // ── Obligaciones ────────────────────────────────────────────────────────────
  const cargosTgr = await prisma.movimientoBancario.findMany({
    where: { descripcion: { contains: 'T.G.R.' } },
    orderBy: { fecha: 'asc' },
  })

  const filas = new Map(
    (await prisma.categoria.findMany({ where: { esManual: true } })).map((c) => [c.nombre, c] as const),
  )
  for (const def of DEFINICIONES) {
    if (!filas.has(def.fila)) throw new Error(`No existe la fila manual "${def.fila}".`)
  }

  // ── Agosto de 2026: el embargo estaba anotado dos veces ─────────────────────
  // El Excel lo registraba a mano en deudas (TGR pie inicial 1.014.705 + TGR
  // convenio 752.352) y ademas en impuestos (Santander Pagos TGR 1.763.883), que
  // es el "Embargo Judicial" de la cartola. Manda la cartola: se borran las dos
  // filas de deudas y queda el hecho real en impuestos.
  const DUPLICADAS_AGOSTO = ['TGR pie inicial', 'TGR convenio']
  console.log('Agosto 2026, duplicado del embargo:')
  for (const nombre of DUPLICADAS_AGOSTO) {
    const cat = filas.get(nombre)
    if (!cat) continue
    const v = await prisma.valorManual.findUnique({
      where: { categoriaId_anio_mes: { categoriaId: cat.id, anio: 2026, mes: 8 } },
    })
    if (!v || v.montoCLP === 0) {
      console.log(`  ${nombre.padEnd(18)} ya estaba en cero`)
      continue
    }
    console.log(`  ${nombre.padEnd(18)} ${fmt(v.montoCLP).padStart(11)} → 0`)
    if (firme) {
      await prisma.valorManual.update({
        where: { id: v.id },
        data: { montoCLP: 0, origen: 'banco' },
      })
    }
  }
  const embargo = await prisma.valorManual.findFirst({
    where: { anio: 2026, mes: 8, categoria: { nombre: 'Santander Pagos TGR' } },
  })
  console.log(`  Santander Pagos TGR ${fmt(embargo?.montoCLP ?? 0).padStart(10)} (impuestos, se mantiene)\n`)


  for (const def of DEFINICIONES) {
    const calendario = derivarCalendario(def)
    const total = calendario.reduce((a, c) => a + c.monto, 0)
    const primera = calendario[0]
    const ultima = calendario[calendario.length - 1]
    console.log(
      `${def.institucion} ${def.numero} · ${def.marco} · ${calendario.length} cuotas · ` +
        `${primera?.anio}-${String(primera?.mes).padStart(2, '0')} a ${ultima?.anio}-${String(ultima?.mes).padStart(2, '0')} · ${fmt(total)}`,
    )

    if (!firme) continue

    const obligacion = await prisma.obligacionFinanciera.upsert({
      where: { institucion_numero: { institucion: def.institucion, numero: def.numero } },
      create: {
        tipo: def.tipo,
        institucion: def.institucion,
        numero: def.numero,
        marco: def.marco,
        fechaActivacion: d(def.fechaActivacion),
        cuotaMensual: def.cuotaMensual,
        fechaUltimaCuota: d(def.fechaUltimaCuota),
        cuotasPorGenerar: def.cuotasPorGenerar,
        categoriaId: filas.get(def.fila)?.id ?? null,
        nota: def.nota ?? '',
      },
      update: {
        cuotaMensual: def.cuotaMensual,
        fechaUltimaCuota: d(def.fechaUltimaCuota),
        cuotasPorGenerar: def.cuotasPorGenerar,
        categoriaId: filas.get(def.fila)?.id ?? null,
        nota: def.nota ?? '',
      },
    })

    for (const [i, cuota] of calendario.entries()) {
      // Las ultimas `cuotasPorGenerar` todavia no las emite la institucion.
      const porGenerar = i >= calendario.length - def.cuotasPorGenerar
      const vence = new Date(Date.UTC(cuota.anio, cuota.mes - 1, 28, 12))
      const estado = porGenerar ? 'por_generar' : vence < HOY ? 'atrasada' : 'pendiente'
      await prisma.cuotaObligacion.upsert({
        where: {
          obligacionId_anio_mes: { obligacionId: obligacion.id, anio: cuota.anio, mes: cuota.mes },
        },
        create: { obligacionId: obligacion.id, anio: cuota.anio, mes: cuota.mes, monto: cuota.monto, estado },
        update: { monto: cuota.monto },
      })
    }
  }

  // El pago del 07/09 por 431.398 son las cuotas de septiembre de 100309 y 133768.
  const pagoSept = cargosTgr.find((c) => c.monto === -431_398)
  if (firme && pagoSept) {
    for (const numero of ['100309', '133768']) {
      const ob = await prisma.obligacionFinanciera.findUnique({
        where: { institucion_numero: { institucion: 'TGR', numero } },
      })
      if (!ob) continue
      await prisma.cuotaObligacion.updateMany({
        where: { obligacionId: ob.id, anio: 2026, mes: 9 },
        data: {
          estado: 'pagada',
          movimientoBancarioId: pagoSept.id,
          nota: 'pagada junto con la otra cuota de septiembre en un solo cargo de 431.398',
        },
      })
    }
    // Si una cuota apunta al cargo, el cargo esta explicado y sale de la bandeja.
    await prisma.movimientoBancario.update({
      where: { id: pagoSept.id },
      data: {
        estadoConciliacion: 'conciliado',
        viaConciliacion: 'manual',
        notaConciliacion: 'cuota de septiembre de los convenios TGR 100309 y 133768',
      },
    })
  }
  if (pagoSept) {
    console.log('\nCargo 2026-09-07 de 431.398 → cuota de septiembre de 100309 (320.954) + 133768 (110.444)')
  }

  // Las cuotas de la linea Fogape que la cartola confirma pagadas.
  const fogape = await prisma.obligacionFinanciera.findUnique({
    where: { institucion_numero: { institucion: 'Maxxa', numero: 'Fogape' } },
  })
  if (firme && fogape) {
    const pagosFogape = await prisma.movimientoBancario.findMany({
      where: {
        OR: [
          { descripcion: { contains: 'PENTA HIPOTECARIO' } },
          { descripcion: { contains: 'ERPYME' }, monto: -870_000 },
        ],
      },
    })
    for (const p of pagosFogape) {
      await prisma.cuotaObligacion.updateMany({
        where: { obligacionId: fogape.id, anio: p.anio, mes: p.mes },
        data: { estado: 'pagada', movimientoBancarioId: p.id },
      })
      await prisma.movimientoBancario.update({
        where: { id: p.id },
        data: { estadoConciliacion: 'conciliado' },
      })
    }
    console.log(`Cuotas Fogape confirmadas por la cartola: ${pagosFogape.length}`)
  }

  // ── Cotizaciones ────────────────────────────────────────────────────────────
  console.log('\nCotizaciones previsionales')
  console.log('  período      banco  certificado      resto  estado      pagada el     atraso  cargo')
  for (const c of COTIZACIONES) {
    const cargo = c.estado === 'pagada' ? await cargoDeCotizacion(c.monto, c.fechaPago) : null
    const resto = c.certificado > 0 ? c.monto - c.certificado : 0
    const atraso = diasDeAtraso(c.anio, c.mes, c.fechaPago)
    const enlace = cargo
      ? cargo.fecha.toISOString().slice(0, 10)
      : c.estado !== 'pagada'
        ? '—'
        : c.nota === SIN_CARTOLA
          ? 'sin cartola'
          : 'SIN CARGO'
    console.log(
      `  ${c.anio}-${String(c.mes).padStart(2, '0')}  ${fmt(c.monto).padStart(9)}` +
        `  ${(c.certificado ? fmt(c.certificado) : '—').padStart(11)}  ${(resto ? fmt(resto) : '—').padStart(9)}` +
        `  ${c.estado.padEnd(10)}  ${(c.fechaPago ?? '—').padEnd(11)}` +
        `${(atraso === null ? '—' : atraso === 0 ? 'al día' : `${atraso} d`).padStart(7)}  ${enlace}`,
    )
    if (!firme) continue
    await prisma.cotizacionPrevisional.upsert({
      where: { anioPeriodo_mesPeriodo: { anioPeriodo: c.anio, mesPeriodo: c.mes } },
      create: {
        anioPeriodo: c.anio,
        mesPeriodo: c.mes,
        monto: c.monto,
        montoCertificado: c.certificado,
        estado: c.estado,
        fechaPago: c.fechaPago ? d(c.fechaPago) : null,
        fechaVencimiento: c.fechaVencimiento ? d(c.fechaVencimiento) : null,
        movimientoBancarioId: cargo?.id ?? null,
        nota: c.nota ?? '',
      },
      update: {
        monto: c.monto,
        montoCertificado: c.certificado,
        estado: c.estado,
        fechaPago: c.fechaPago ? d(c.fechaPago) : null,
        fechaVencimiento: c.fechaVencimiento ? d(c.fechaVencimiento) : null,
        movimientoBancarioId: cargo?.id ?? null,
        nota: c.nota ?? '',
      },
    })
    if (cargo) {
      await prisma.movimientoBancario.update({
        where: { id: cargo.id },
        data: {
          estadoConciliacion: 'conciliado',
          viaConciliacion: 'manual',
          notaConciliacion: `cotización previsional del período ${String(c.mes).padStart(2, '0')}/${c.anio}`,
        },
      })
    }
  }

  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito.')
    return
  }
  const quedan = await prisma.movimientoBancario.count({ where: { estadoConciliacion: 'sin_conciliar' } })
  console.log(`\nLISTO. Movimientos sin conciliar: ${quedan}`)
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
