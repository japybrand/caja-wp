import { prisma } from '@/lib/prisma'
import { MESES } from '@/lib/dominio'
import { f29PorMes } from '@/lib/sii/f29'
import { vencimientosHasta } from '@/lib/vencimientos'
import type { Aviso } from '@/lib/correo/plantilla'

/**
 * Las cuatro reglas de aviso.
 *
 * Cada una es una función que recibe la fecha y devuelve el aviso o `null`. Así se
 * prueban sin mandar correo y sin esperar al día 11: `scripts/probar-alertas.ts
 * --fecha 2026-10-11` imprime lo que se enviaría ese día.
 *
 * LA FECHA SE MIRA EN HORARIO DE SANTIAGO
 * El cron de Vercel se programa en UTC y Chile cambia de hora dos veces al año. Con
 * `new Date().getDate()` el aviso del día 11 se dispararía el 10 por la noche la
 * mitad del año, y el aviso de los lunes caería en domingo. Por eso el día del mes
 * y el día de la semana salen de `Intl` sobre `America/Santiago`.
 */

export interface Regla {
  tipo: string
  clave: string
  /** 0 = se avisa una sola vez. >0 = se repite cada tantos días mientras dure. */
  repetirCadaDias: number
  aviso: Aviso
}

const ZONA = 'America/Santiago'

/** El día del mes, el día de la semana (1 = lunes) y el año-mes, en Santiago. */
export function enSantiago(fecha: Date): {
  dia: number
  diaSemana: number
  mes: number
  anio: number
} {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(fecha)
  const de = (t: string): string => partes.find((p) => p.type === t)?.value ?? ''
  const semana = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return {
    dia: Number(de('day')),
    diaSemana: semana.indexOf(de('weekday')) + 1,
    mes: Number(de('month')),
    anio: Number(de('year')),
  }
}

const clp = (n: number): string =>
  '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

const DIA_DEL_AVISO_MENSUAL = 11
const DESFASE_MAXIMO_DIAS = 7
const VENTANA_VENCIMIENTOS_DIAS = 5
const BANDEJA_DIAS = 3

/**
 * 1. El día 11, si falta cargar algo del mes anterior.
 *
 * El día 11 y no el 1 porque el SII publica el registro del período dentro de los
 * primeros diez días, y la cartola del mes cerrado llega en esa misma ventana.
 * Antes del 11 el hueco es normal y avisar sería ruido.
 */
export async function faltaCargarElMesAnterior(hoy: Date): Promise<Regla | null> {
  const { dia, mes, anio } = enSantiago(hoy)
  if (dia !== DIA_DEL_AVISO_MENSUAL) return null
  // En enero el mes anterior es de otro año y el ciclo tributario es distinto.
  if (mes === 1) return null
  const objetivo = mes - 1

  const [cartola, ventas, compras] = await Promise.all([
    prisma.movimientoBancario.count({ where: { anio, mes: objetivo } }),
    prisma.documentoVenta.count({ where: { anio, mes: objetivo } }),
    prisma.documentoCompra.count({ where: { anio, mes: objetivo } }),
  ])

  const falta: string[] = []
  if (cartola === 0) falta.push('la cartola de Santander')
  if (ventas === 0) falta.push('el registro de ventas del SII')
  if (compras === 0) falta.push('el registro de compras del SII')
  if (falta.length === 0) return null

  const nombre = MESES[objetivo - 1]?.toLowerCase() ?? String(objetivo)
  // El registro de compras merece su propia explicación: sin él, el F29 que muestra
  // la app está sobreestimado y nada en la interfaz lo delata.
  const explicacion =
    compras === 0
      ? `Sin el registro de compras, el IVA de ${nombre} se calcula con débito y sin crédito, así que el F29 que muestra la app está sobreestimado.`
      : `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} queda como mes proyectado hasta que estén cargados.`

  return {
    tipo: 'carga_mensual',
    clave: `${anio}-${String(objetivo).padStart(2, '0')}`,
    repetirCadaDias: 0,
    aviso: {
      asunto: `Caja WP · falta cargar ${nombre}`,
      encabezado: `Ya es 11 y de ${nombre} falta ${falta.join(', ')}.`,
      explicacion,
      ruta: '/cargar',
      textoBoton: 'Cargar archivos',
    },
  }
}

/**
 * 2. Los lunes, si la cartola del mes en curso viene atrasada.
 *
 * Un desfase largo no rompe nada visiblemente: el mes sigue apareciendo como real
 * porque tiene cartola, pero incompleta. Todo lo que se cobre después del último
 * movimiento cargado aparece como "falta pagar" aunque ya haya salido de la cuenta.
 */
export async function cartolaAtrasada(hoy: Date): Promise<Regla | null> {
  const { diaSemana, anio } = enSantiago(hoy)
  if (diaSemana !== 1) return null

  const ultimo = await prisma.movimientoBancario.findFirst({
    where: { anio },
    orderBy: { fecha: 'desc' },
  })
  if (!ultimo) return null

  const dias = Math.floor((hoy.getTime() - ultimo.fecha.getTime()) / 86_400_000)
  if (dias <= DESFASE_MAXIMO_DIAS) return null

  return {
    tipo: 'desfase_cartola',
    clave: `${anio}-${String(enSantiago(hoy).mes).padStart(2, '0')}`,
    repetirCadaDias: 7,
    aviso: {
      asunto: `Caja WP · la cartola tiene ${dias} días de desfase`,
      encabezado: `El último movimiento cargado es del ${ultimo.fecha.toISOString().slice(0, 10)}: ${dias} días de desfase.`,
      explicacion:
        'Todo lo que se haya cobrado después de esa fecha aparece como "falta pagar" aunque ya haya salido de la cuenta, así que la brecha del mes se ve peor de lo que es.',
      ruta: '/cargar',
      textoBoton: 'Cargar la cartola',
    },
  }
}

/** 3. Obligaciones que vencen dentro de los próximos cinco días. */
export async function obligacionesPorVencer(hoy: Date): Promise<Regla[]> {
  const { anio, mes } = enSantiago(hoy)
  const hasta = new Date(hoy.getTime() + VENTANA_VENCIMIENTOS_DIAS * 86_400_000)

  const filas = await f29PorMes(anio)
  const f29 = filas.find((f) => f.mesDePago.anio === anio && f.mesDePago.mes === mes) ?? null
  const vencimientos = await vencimientosHasta({ hoy, hasta, f29 })
  if (vencimientos.length === 0) return []

  // Un aviso por obligación y no uno con todas: cada una se paga por su lado y en
  // su plataforma, así que juntarlas obligaría a releer el mismo correo varias
  // veces para ir tachando. La clave por obligación es además lo que evita que la
  // misma cuota avise cinco días seguidos.
  return vencimientos.map((v) => ({
    tipo: 'obligacion',
    clave: v.clave,
    repetirCadaDias: 0,
    aviso: {
      asunto: `Caja WP · ${v.concepto} ${v.vencido ? 'está atrasado' : `vence en ${v.dias} días`}`,
      encabezado: v.vencido
        ? `${v.concepto} venció el ${v.fecha} y sigue pendiente: ${clp(v.monto)}.`
        : `${v.concepto} vence el ${v.fecha}, en ${v.dias} días: ${clp(v.monto)}.`,
      explicacion: v.accion + '.',
      ruta: '/obligaciones',
      textoBoton: 'Ver obligaciones',
    },
  }))
}

/**
 * 4. Movimientos esperando revisión hace más de tres días.
 *
 * Un movimiento por revisar no entra en ningún total del flujo. Mientras esté ahí,
 * el flujo está incompleto y no lo dice.
 */
export async function bandejaEstancada(hoy: Date): Promise<Regla | null> {
  const corte = new Date(hoy.getTime() - BANDEJA_DIAS * 86_400_000)
  const pendientes = await prisma.movimiento.findMany({
    where: { estado: 'por_revisar', createdAt: { lte: corte } },
    include: { proveedor: true },
    orderBy: { createdAt: 'asc' },
  })
  if (pendientes.length === 0) return null

  const masViejo = pendientes[0]
  const dias = masViejo
    ? Math.floor((hoy.getTime() - masViejo.createdAt.getTime()) / 86_400_000)
    : BANDEJA_DIAS
  const total = pendientes.reduce((a, m) => a + m.montoCLP, 0)

  return {
    tipo: 'bandeja',
    clave: 'bandeja',
    repetirCadaDias: 7,
    aviso: {
      asunto: `Caja WP · ${pendientes.length} movimientos esperando revisión`,
      encabezado: `Hay ${pendientes.length} movimientos en la bandeja, el más viejo de hace ${dias} días, por ${clp(total)} en total.`,
      explicacion:
        'Un movimiento por revisar no entra en ningún total del flujo, así que mientras estén ahí el flujo está incompleto y no lo dice.',
      filas: pendientes.slice(0, 6).map((m) => ({
        concepto: m.proveedor?.nombre ?? m.descripcion.slice(0, 50),
        detalle: `${MESES[m.mes - 1]?.toLowerCase()} · ${m.fuente}`,
        monto: clp(m.montoCLP),
      })),
      ruta: '/movimientos',
      textoBoton: 'Revisar la bandeja',
    },
  }
}

/** Todas las reglas, evaluadas para una fecha. */
export async function evaluarAlertas(hoy: Date): Promise<Regla[]> {
  const [carga, cartola, obligaciones, bandeja] = await Promise.all([
    faltaCargarElMesAnterior(hoy),
    cartolaAtrasada(hoy),
    obligacionesPorVencer(hoy),
    bandejaEstancada(hoy),
  ])
  return [carga, cartola, ...obligaciones, bandeja].filter((r): r is Regla => r !== null)
}
