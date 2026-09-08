/**
 * Reemplaza las proyecciones copiadas de octubre a diciembre por el gasto real.
 *
 *   node --import tsx --conditions=react-server --env-file=.env.local --env-file=.env \
 *     scripts/proyeccion-recurrentes.ts [--firme]
 *
 * Sin --firme solo simula. Es idempotente: una vez aplicado, volver a correrlo no
 * mueve nada, porque los montos ya coinciden con el estadístico.
 *
 * QUÉ CORRIGE
 * El Excel proyectó octubre a diciembre copiando un valor de principios de año.
 * Verpex arrastraba los 233.511 de febrero cuando el gasto real de junio a agosto
 * fue de 612.056 a 643.960. Son suscripciones en dólares con tarjeta chilena: el
 * cargo se mueve con el tipo de cambio y con el uso, y un valor de doce meses atrás
 * no es una proyección, es un residuo.
 *
 * SEPTIEMBRE NO CUENTA COMO MES REAL
 * La cartola llega al día 8 y casi ningún proveedor alcanzó a cobrar: Verpex cobra
 * entre el 9 y el 16. Incluir septiembre bajaría su promedio de 623.925 a 419.842
 * por un mes que todavía no termina. El universo de meses reales es enero a agosto.
 *
 * "LOS ÚLTIMOS TRES MESES REALES" NO ES EL MISMO TRÍO PARA TODOS
 * Siteground no tiene respaldo bancario en junio ni julio, así que sus tres últimos
 * meses reales son marzo, abril y agosto. Tomar junio-julio-agosto a ciegas le
 * habría dado 31.630 en vez de 93.317, un tercio de lo real. Para cada proveedor se
 * retrocede desde agosto hasta juntar tres meses con cargo bancario detrás.
 *
 * MEDIANA PARA LOS QUE TIENEN UN CARGO ANUAL
 * Envato cobró 212.314 en agosto contra 36.806 y 37.921 en junio y julio: es una
 * renovación anual, y el promedio la repartiría en cada uno de los tres meses que
 * vienen. Para esos casos manda la mediana, que ignora el extremo.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const FIRME = process.argv.includes('--firme')
const ANIO = 2026

/** Último mes con cartola completa. Septiembre llega al día 8. */
const ULTIMO_MES_COMPLETO = 8
const MESES_PROYECTADOS = [10, 11, 12]
const MUESTRA = 3

/** Proveedores con un cargo anual que distorsiona el promedio. */
const CON_MEDIANA = new Set(['Envato', 'Lovable', 'Adobe'])

const MC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

const promedio = (xs: number[]): number => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
const mediana = (xs: number[]): number => {
  const o = [...xs].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 === 1 ? (o[m] ?? 0) : Math.round(((o[m - 1] ?? 0) + (o[m] ?? 0)) / 2)
}

interface Propuesta {
  proveedorId: string
  categoria: string
  proveedor: string
  copiado: number
  nuevo: number
  estadistico: 'promedio' | 'mediana'
  meses: number[]
  valores: number[]
}

async function main(): Promise<void> {
  const categorias = await prisma.categoria.findMany({
    where: { grupo: 'proveedores' },
    include: { proveedores: true },
  })
  const movimientos = await prisma.movimiento.findMany({
    where: { anio: ANIO, estado: 'confirmado', proveedorId: { not: null } },
    include: { bancarios: { select: { id: true } } },
  })

  interface Serie {
    categoria: string
    proveedor: string
    montos: number[]
    real: boolean[]
  }
  const series = new Map<string, Serie>()
  for (const c of categorias)
    for (const p of c.proveedores)
      series.set(p.id, {
        categoria: c.nombre,
        proveedor: p.nombre,
        montos: Array<number>(12).fill(0),
        real: Array<boolean>(12).fill(false),
      })

  for (const m of movimientos) {
    const s = m.proveedorId ? series.get(m.proveedorId) : undefined
    if (!s) continue
    s.montos[m.mes - 1] = (s.montos[m.mes - 1] ?? 0) + m.montoCLP
    // Un monto respaldado por la cartola o por el export de Global66 es un hecho;
    // uno que solo viene del Excel es la misma proyección que se quiere reemplazar.
    if (m.fuente === 'cartola' || m.fuente === 'global66' || m.bancarios.length > 0)
      s.real[m.mes - 1] = true
  }

  const propuestas: Propuesta[] = []
  for (const [proveedorId, s] of series) {
    const copiado = s.montos[9] ?? 0
    const esCopia = copiado !== 0 && copiado === s.montos[10] && copiado === s.montos[11]
    if (!esCopia) continue

    const meses: number[] = []
    for (let mes = ULTIMO_MES_COMPLETO; mes >= 1 && meses.length < MUESTRA; mes -= 1)
      if (s.real[mes - 1]) meses.push(mes)
    if (meses.length === 0) continue
    meses.reverse()

    const valores = meses.map((mes) => s.montos[mes - 1] ?? 0)
    const estadistico = CON_MEDIANA.has(s.proveedor) ? 'mediana' : 'promedio'
    propuestas.push({
      proveedorId,
      categoria: s.categoria,
      proveedor: s.proveedor,
      copiado,
      nuevo: estadistico === 'mediana' ? mediana(valores) : promedio(valores),
      estadistico,
      meses,
      valores,
    })
  }
  propuestas.sort((a, b) => Math.abs(b.nuevo - b.copiado) - Math.abs(a.nuevo - a.copiado))

  console.log(
    'CATEGORÍA'.padEnd(20) +
      'PROVEEDOR'.padEnd(26) +
      'COPIADO'.padStart(11) +
      'NUEVO'.padStart(11) +
      'DELTA/MES'.padStart(12) +
      '  CÓMO',
  )
  let delta = 0
  let cambian = 0
  for (const p of propuestas) {
    const d = p.nuevo - p.copiado
    if (d !== 0) cambian += 1
    delta += d * MESES_PROYECTADOS.length
    console.log(
      p.categoria.slice(0, 19).padEnd(20) +
        p.proveedor.slice(0, 25).padEnd(26) +
        clp(p.copiado).padStart(11) +
        clp(p.nuevo).padStart(11) +
        ((d >= 0 ? '+' : '') + clp(d)).padStart(12) +
        `  ${p.estadistico} de ${p.meses.map((m, i) => `${MC[m - 1]} ${clp(p.valores[i] ?? 0)}`).join(' · ')}`,
    )
  }
  console.log(
    `\n ${propuestas.length} proveedores con valor copiado, ${cambian} cambian. ` +
      `Efecto en el gasto de octubre a diciembre: ${clp(delta)}`,
  )

  if (!FIRME) {
    console.log('\nSimulación. Repite con --firme para aplicarlo.')
    return
  }

  let filas = 0
  for (const p of propuestas) {
    if (p.nuevo === p.copiado) continue
    for (const mes of MESES_PROYECTADOS) {
      // `fuente: 'manual'` marca que el monto ya no sale de la planilla. El
      // importador respeta cualquier fuente distinta de "excel" y la cuadratura
      // deja de comparar esas celdas contra el Excel, que es lo correcto: ya no
      // se espera que coincidan.
      const r = await prisma.movimiento.updateMany({
        where: { anio: ANIO, mes, proveedorId: p.proveedorId, estado: 'confirmado' },
        data: { montoCLP: p.nuevo, fuente: 'manual' },
      })
      filas += r.count
    }
  }
  console.log(`\nAplicado: ${filas} movimientos actualizados.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
