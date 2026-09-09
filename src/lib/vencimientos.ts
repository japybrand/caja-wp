import { prisma } from '@/lib/prisma'
import { MESES, fechaVencimientoCuota, tipoObligacion } from '@/lib/dominio'
import type { F29DelMes } from '@/lib/sii/f29'

/**
 * Lo que hay que pagar de aquí a una fecha: cuotas de convenio, la cuota Fogape,
 * cotizaciones previsionales y el F29.
 *
 * Vive aparte porque lo usan dos cosas con ventanas distintas: el panel mira 15
 * días, que es el plazo en que todavía se puede hacer algo, y el aviso por correo
 * mira 5, que es cuando ya hay que moverse. Con dos implementaciones, una de las
 * dos se habría quedado atrás en el primer cambio y el correo habría dicho algo
 * distinto de la pantalla a la que apunta.
 */

export interface Vencimiento {
  /** Identifica el hecho concreto, para no avisar dos veces de lo mismo. */
  clave: string
  fecha: string
  dias: number
  concepto: string
  /** Qué hacer, en imperativo. */
  accion: string
  monto: number
  vencido: boolean
}

const iso = (d: Date): string => d.toISOString().slice(0, 10)

export async function vencimientosHasta({
  hoy,
  hasta,
  f29,
}: {
  hoy: Date
  hasta: Date
  /** El F29 que se paga en este período, si lo hay. */
  f29: F29DelMes | null
}): Promise<Vencimiento[]> {
  const dias = (f: Date): number => Math.round((f.getTime() - hoy.getTime()) / 86_400_000)
  const todos: Vencimiento[] = []

  const cuotas = await prisma.cuotaObligacion.findMany({
    where: { estado: { in: ['pendiente', 'atrasada'] }, obligacion: { activa: true } },
    include: { obligacion: true },
  })
  for (const c of cuotas) {
    // El día de vencimiento y el nombre salen del tipo, que los centraliza. Ninguna
    // obligación trae la fecha exacta en su calendario: se deduce de cuándo cobra
    // cada acreedor.
    const tipo = tipoObligacion(c.obligacion.tipo)
    const vence = fechaVencimientoCuota(c.obligacion.tipo, c.anio, c.mes)
    if (vence > hasta) continue
    todos.push({
      clave: `cuota:${c.id}`,
      fecha: iso(vence),
      dias: dias(vence),
      concepto: `${tipo.nombre(c.obligacion)}, ${MESES[c.mes - 1]?.toLowerCase()}`,
      accion: 'Paga la cuota',
      monto: c.monto,
      vencido: vence < hoy,
    })
  }

  const cotizaciones = await prisma.cotizacionPrevisional.findMany({
    where: { estado: { in: ['pendiente', 'atrasada'] } },
  })
  for (const c of cotizaciones) {
    const vence = c.fechaVencimiento ?? new Date(Date.UTC(c.anioPeriodo, c.mesPeriodo, 13, 12))
    if (vence > hasta) continue
    todos.push({
      clave: `cotizacion:${c.id}`,
      fecha: iso(vence),
      dias: dias(vence),
      concepto: `Cotización previsional de ${MESES[c.mesPeriodo - 1]?.toLowerCase()}`,
      accion: 'Paga en Previred',
      monto: c.monto,
      vencido: vence < hoy,
    })
  }

  if (f29 && f29.total > 0) {
    const vence = new Date(`${f29.venceEl}T12:00:00Z`)
    if (vence <= hasta) {
      todos.push({
        clave: `f29:${f29.anioPeriodo}-${String(f29.mesPeriodo).padStart(2, '0')}`,
        fecha: f29.venceEl,
        dias: dias(vence),
        concepto: `F29 del período ${MESES[f29.mesPeriodo - 1]?.toLowerCase()}`,
        accion: 'Declara y paga el F29',
        monto: f29.total,
        vencido: vence < hoy,
      })
    }
  }

  todos.sort((a, b) => a.fecha.localeCompare(b.fecha))
  return todos
}
