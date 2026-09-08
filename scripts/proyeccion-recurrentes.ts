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
 * vienen. Para ese caso manda la mediana, que ignora el extremo.
 *
 * Lovable quedó fuera de la mediana a propósito: ahí el mes atípico es el bajo
 * —junio 23.839 contra julio 163.890 y agosto 133.520—, así que la mediana daba
 * 133.520, MÁS alto que el promedio de 107.083. Hacía lo contrario de lo buscado.
 *
 * UN MES DE DEVOLUCIÓN NO ES UN MES DE GASTO
 * SyT Impresores tiene abril en -26.030: es una nota de crédito, no una compra.
 * Promediarla con dos meses de gasto daba 68.310 cuando el gasto típico está entre
 * 66.001 y 169.499. Los meses con monto negativo no entran en la muestra.
 *
 * LOS PROVEEDORES QUE ESTABAN EN CERO
 * Aparte de los valores copiados, había 13 proveedores con gasto real reciente y
 * NADA proyectado en octubre a diciembre. AWS entre ellos, con 1.949.707 al mes.
 * Solo se llenan los que Pipe aprobó como recurrentes; la lista está más abajo con
 * el motivo de cada exclusión.
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
const CON_MEDIANA = new Set(['Envato', 'Adobe'])

/**
 * Proveedores que estaban en cero de octubre a diciembre y sí hay que proyectar.
 *
 * Recurrente = tres o más meses con cargo bancario real y al menos uno entre junio
 * y agosto, o sea que siga vivo hoy y no solo que haya existido. Revisado y
 * aprobado uno por uno; los excluidos van abajo con su razón.
 */
const RECURRENTES_EN_CERO = [
  'AWS',
  'Tarjeta Cred. Santander',
  'SyT Impresores',
  'Read AI',
  'Metricool',
  'Namecheap',
]

/**
 * Los que quedan en cero, y por qué. Se listan para que la próxima revisión no
 * tenga que volver a investigarlos.
 */
const EN_CERO_A_PROPOSITO: Record<string, string> = {
  'Carlos Millán': 'abogado por una causa puntual, no es un gasto recurrente',
  'Eladio Ossa': 'aparece una sola vez, en julio',
  Canva: '7.900 exactos de enero a junio y nada desde julio: suscripción cancelada',
  'Digital Ocean': 'sin cobro en agosto ni septiembre; probablemente cancelado como Canva',
  YITH: 'un solo mes, agosto 78.105; licencia de plugin, seguramente anual',
  CapCut: 'un solo mes, agosto 12.990',
  Entel: 'un solo mes, junio 60.822; si es la cuenta de teléfono no se paga desde esta cuenta',
}

const MC = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

const promedio = (xs: number[]): number => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
const mediana = (xs: number[]): number => {
  const o = [...xs].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 === 1 ? (o[m] ?? 0) : Math.round(((o[m - 1] ?? 0) + (o[m] ?? 0)) / 2)
}

interface Serie {
  categoria: string
  proveedor: string
  montos: number[]
  real: boolean[]
}

interface Propuesta {
  proveedorId: string
  categoria: string
  proveedor: string
  /** Lo que hay hoy en octubre, noviembre y diciembre. Cero si nunca se proyectó. */
  actual: number
  nuevo: number
  estadistico: 'promedio' | 'mediana'
  meses: number[]
  valores: number[]
  /** true cuando hay que crear las filas en vez de actualizarlas. */
  nuevas: boolean
}

/**
 * Los últimos meses con gasto real de un proveedor, y el estadístico que los resume.
 *
 * Retrocede desde el último mes completo hasta juntar la muestra. Salta los meses
 * sin respaldo bancario —son la misma proyección que se quiere reemplazar— y los de
 * monto negativo, que son notas de crédito y no meses de gasto.
 */
function resumir(s: Serie): { nuevo: number; meses: number[]; valores: number[] } | null {
  const meses: number[] = []
  for (let mes = ULTIMO_MES_COMPLETO; mes >= 1 && meses.length < MUESTRA; mes -= 1) {
    if (!s.real[mes - 1]) continue
    if ((s.montos[mes - 1] ?? 0) <= 0) continue
    meses.push(mes)
  }
  if (meses.length === 0) return null
  meses.reverse()
  const valores = meses.map((mes) => s.montos[mes - 1] ?? 0)
  const nuevo = CON_MEDIANA.has(s.proveedor) ? mediana(valores) : promedio(valores)
  return { nuevo, meses, valores }
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

  const series = new Map<string, Serie>()
  const categoriaDe = new Map<string, string>()
  for (const c of categorias)
    for (const p of c.proveedores) {
      categoriaDe.set(p.id, c.id)
      series.set(p.id, {
        categoria: c.nombre,
        proveedor: p.nombre,
        montos: Array<number>(12).fill(0),
        real: Array<boolean>(12).fill(false),
      })
    }

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
    const actual = s.montos[9] ?? 0
    const iguales = actual === s.montos[10] && actual === s.montos[11]
    if (!iguales) continue
    // Dos casos: el valor copiado que hay que recalcular, y el cero que hay que
    // llenar. El segundo solo para los proveedores aprobados como recurrentes.
    const enCero = actual === 0
    if (enCero && !RECURRENTES_EN_CERO.includes(s.proveedor)) continue

    const r = resumir(s)
    if (!r) continue
    propuestas.push({
      proveedorId,
      categoria: s.categoria,
      proveedor: s.proveedor,
      actual,
      nuevo: r.nuevo,
      estadistico: CON_MEDIANA.has(s.proveedor) ? 'mediana' : 'promedio',
      meses: r.meses,
      valores: r.valores,
      nuevas: enCero,
    })
  }
  propuestas.sort((a, b) => Math.abs(b.nuevo - b.actual) - Math.abs(a.nuevo - a.actual))

  const encabezado =
    'CATEGORÍA'.padEnd(20) +
    'PROVEEDOR'.padEnd(26) +
    'ACTUAL'.padStart(11) +
    'NUEVO'.padStart(11) +
    'DELTA/MES'.padStart(12) +
    '  CÓMO'
  const linea = (p: Propuesta): string => {
    const d = p.nuevo - p.actual
    return (
      p.categoria.slice(0, 19).padEnd(20) +
      p.proveedor.slice(0, 25).padEnd(26) +
      clp(p.actual).padStart(11) +
      clp(p.nuevo).padStart(11) +
      ((d >= 0 ? '+' : '') + clp(d)).padStart(12) +
      `  ${p.estadistico} de ${p.meses.map((m, i) => `${MC[m - 1]} ${clp(p.valores[i] ?? 0)}`).join(' · ')}` +
      (p.meses.length < MUESTRA ? `  <- solo ${p.meses.length} meses` : '')
    )
  }
  const total = (ps: Propuesta[]): number =>
    ps.reduce((a, p) => a + (p.nuevo - p.actual) * MESES_PROYECTADOS.length, 0)

  const copiados = propuestas.filter((p) => !p.nuevas)
  const enCero = propuestas.filter((p) => p.nuevas)

  console.log('=== VALORES COPIADOS: se recalculan ===')
  console.log(encabezado)
  for (const p of copiados) console.log(linea(p))
  console.log(
    ` ${copiados.length} proveedores, ${copiados.filter((p) => p.nuevo !== p.actual).length} cambian. ` +
      `Efecto oct-dic: ${clp(total(copiados))}`,
  )

  console.log('\n=== EN CERO Y RECURRENTES: se proyectan ===')
  console.log(encabezado)
  for (const p of enCero) console.log(linea(p))
  console.log(` ${enCero.length} proveedores. Efecto oct-dic: ${clp(total(enCero))}`)
  const faltan = RECURRENTES_EN_CERO.filter((n) => !enCero.some((p) => p.proveedor === n))
  if (faltan.length > 0) console.log(` OJO, no calzaron: ${faltan.join(', ')}`)

  console.log('\n=== QUEDAN EN CERO A PROPÓSITO ===')
  for (const [nombre, razon] of Object.entries(EN_CERO_A_PROPOSITO))
    console.log(` ${nombre.padEnd(24)} ${razon}`)

  console.log(`\n Efecto total en el gasto de octubre a diciembre: ${clp(total(propuestas))}`)

  if (!FIRME) {
    console.log('\nSimulación. Repite con --firme para aplicarlo.')
    return
  }

  let actualizadas = 0
  let creadas = 0
  for (const p of propuestas) {
    if (p.nuevo === p.actual) continue
    for (const mes of MESES_PROYECTADOS) {
      // `fuente: 'manual'` marca que el monto ya no sale de la planilla. El
      // importador respeta cualquier fuente distinta de "excel" y la cuadratura
      // deja de comparar esas celdas contra el Excel, que es lo correcto: ya no
      // se espera que coincidan.
      if (p.nuevas) {
        // Estos meses no existían: hay que crearlos. El `idExterno` es estable
        // para que volver a correr el script no los duplique.
        const idExterno = `proyeccion:${p.proveedorId}:${ANIO}-${mes}`
        await prisma.movimiento.upsert({
          where: { idExterno },
          create: {
            fecha: new Date(Date.UTC(ANIO, mes - 1, 1)),
            mes,
            anio: ANIO,
            montoCLP: p.nuevo,
            monedaOriginal: 'CLP',
            proveedorId: p.proveedorId,
            categoriaId: categoriaDe.get(p.proveedorId) ?? '',
            descripcion: p.proveedor,
            fuente: 'manual',
            idExterno,
            estado: 'confirmado',
          },
          update: { montoCLP: p.nuevo },
        })
        creadas += 1
      } else {
        const r = await prisma.movimiento.updateMany({
          where: { anio: ANIO, mes, proveedorId: p.proveedorId, estado: 'confirmado' },
          data: { montoCLP: p.nuevo, fuente: 'manual' },
        })
        actualizadas += r.count
      }
    }
  }
  console.log(`\nAplicado: ${actualizadas} movimientos actualizados, ${creadas} creados.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
