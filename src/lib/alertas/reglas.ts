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
  /**
   * Los hechos concretos que cubre el aviso, cuando son varios.
   *
   * Un correo por obligación se volvía ruido: el 25 de septiembre habrían salido
   * diez, cuatro de ellos los cuatro convenios que vencen el mismo día. Agrupados,
   * el aviso se manda si hay AL MENOS UNO que no se haya avisado antes, y después
   * se registran todos. Así entrar algo nuevo dispara un correo con el panorama
   * completo, y marcar cosas como pagadas no dispara ninguno.
   */
  claves?: string[]
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

/**
 * 3. Todo lo que vence dentro de los próximos cinco días, en UN correo.
 *
 * POR QUÉ AGRUPADO
 * Un correo por obligación no escalaba: el 25 de septiembre habrían salido diez, y
 * cuatro eran los cuatro convenios que vencen el mismo día por 1.966.905 en total.
 * Diez correos en una mañana se archivan sin leer, que es exactamente lo que este
 * sistema tiene que evitar. Uno solo, ordenado por fecha, se lee entero.
 *
 * Cuando hay una sola obligación el correo la nombra en el asunto, igual que antes:
 * agrupar no debe hacer más vago el caso simple.
 */
export async function obligacionesPorVencer(hoy: Date): Promise<Regla | null> {
  const { anio, mes } = enSantiago(hoy)
  const hasta = new Date(hoy.getTime() + VENTANA_VENCIMIENTOS_DIAS * 86_400_000)

  const filas = await f29PorMes(anio)
  const f29 = filas.find((f) => f.mesDePago.anio === anio && f.mesDePago.mes === mes) ?? null
  const vencimientos = await vencimientosHasta({ hoy, hasta, f29 })
  if (vencimientos.length === 0) return null

  const total = vencimientos.reduce((a, v) => a + v.monto, 0)
  const atrasados = vencimientos.filter((v) => v.vencido)
  const proximos = vencimientos.filter((v) => !v.vencido)

  // Ya vienen ordenados por fecha desde `vencimientosHasta`, que es el orden en que
  // hay que actuar: lo más viejo primero.
  const filasAviso = vencimientos.map((v) => ({
    concepto: v.concepto,
    detalle: v.vencido
      ? `venció el ${v.fecha}`
      : v.dias === 0
        ? `vence hoy, ${v.fecha}`
        : `vence el ${v.fecha}, en ${v.dias} ${v.dias === 1 ? 'día' : 'días'}`,
    monto: clp(v.monto),
  }))

  if (vencimientos.length === 1) {
    const v = vencimientos[0]!
    return {
      tipo: 'obligacion',
      clave: v.clave,
      claves: [v.clave],
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
    }
  }

  // La concordancia se arma explícitamente. Un correo que dice "1 obligaciones
  // atrasadas" se lee como generado por una máquina, y lo que se busca acá es que se
  // lea como escrito por alguien que sabe lo que está pasando.
  const obligaciones = (n: number): string => (n === 1 ? '1 obligación' : `${n} obligaciones`)
  const atrasadas = (n: number): string =>
    n === 1 ? '1 obligación atrasada' : `${n} obligaciones atrasadas`

  const asunto =
    atrasados.length === 0
      ? `Caja WP · vencen ${obligaciones(proximos.length)} por ${clp(total)}`
      : proximos.length === 0
        ? `Caja WP · ${atrasadas(atrasados.length)} por ${clp(total)}`
        : `Caja WP · ${obligaciones(vencimientos.length)} por ${clp(total)}: ${atrasados.length} atrasadas`

  const encabezado =
    atrasados.length === 0
      ? `Vencen ${obligaciones(proximos.length)} en los próximos ${VENTANA_VENCIMIENTOS_DIAS} días, ${clp(total)} en total.`
      : proximos.length === 0
        ? `Hay ${atrasadas(atrasados.length)}, ${clp(total)} en total.`
        : `${clp(total)} entre ${atrasadas(atrasados.length)} y ${proximos.length === 1 ? 'una que vence' : `${proximos.length} que vencen`} dentro de ${VENTANA_VENCIMIENTOS_DIAS} días.`

  return {
    tipo: 'obligacion',
    // La clave principal es solo para el registro; el que decide si se manda es
    // `claves`, y basta que una sea nueva.
    clave: `tanda:${vencimientos[0]?.fecha}`,
    claves: vencimientos.map((v) => v.clave),
    repetirCadaDias: 0,
    aviso: {
      asunto,
      encabezado,
      explicacion:
        'En orden de fecha, que es el orden en que hay que pagarlas. Márcalas en ' +
        'Obligaciones apenas pagues, sin esperar a que el cargo llegue a la cartola.',
      filas: filasAviso,
      ruta: '/obligaciones',
      textoBoton: 'Ver obligaciones',
    },
  }
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
  return [carga, cartola, obligaciones, bandeja].filter((r): r is Regla => r !== null)
}
