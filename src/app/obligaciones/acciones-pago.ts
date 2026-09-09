'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'

/**
 * Marcar una cuota o una cotización como pagada, sin esperar a la cartola.
 *
 * POR QUÉ HACE FALTA
 * Entre que se paga y que el cargo aparece en la cartola pueden pasar días: la
 * cartola de Santander se descarga a mano y llega cuando llega. En ese hueco la
 * obligación figuraba como pendiente y el aviso por correo la reportaba como
 * atrasada, avisando por algo ya resuelto. Un aviso así, repetido, es el camino más
 * corto a que se dejen de leer todos.
 *
 * LO DECLARADO NO SE CONFUNDE CON LO CONCILIADO
 * `fechaPago` puesta y `movimientoBancario` en null significa "pagada por
 * declaración": alguien dice que salió, pero el banco todavía no lo muestra. Cuando
 * el cargo llegue, la conciliación lo enlaza y quedan las dos cosas. La distinción
 * importa porque el "ya pagado" del panel sigue saliendo de la cartola, no de esta
 * marca: una declaración no es evidencia de que la plata salió de la cuenta.
 *
 * TODO ES REVERSIBLE
 * Las dos acciones son interruptores. Marcar por error no obliga a pedir ayuda:
 * se desmarca y vuelve al estado anterior.
 */

export interface Resultado {
  ok: boolean
  error?: string
}

/**
 * Una cuota con cargo bancario enlazado no se desmarca desde aquí.
 *
 * Si el banco muestra el cargo, la cuota está pagada y punto: desmarcarla dejaría
 * la app diciendo algo que la cartola contradice. Para deshacer eso hay que romper
 * la conciliación en /banco, que es donde se ve el cargo y su enlace.
 */
export async function marcarCuotaPagada(id: string, pagada: boolean): Promise<Resultado> {
  await requerirSesion()

  const cuota = await prisma.cuotaObligacion.findUnique({ where: { id } })
  if (!cuota) return { ok: false, error: 'La cuota ya no existe.' }

  if (!pagada && cuota.movimientoBancarioId) {
    return {
      ok: false,
      error:
        'Esta cuota tiene un cargo del banco enlazado, así que está pagada según la cartola. ' +
        'Para deshacerlo hay que romper la conciliación en Banco.',
    }
  }

  await prisma.cuotaObligacion.update({
    where: { id },
    data: pagada
      ? { estado: 'pagada', fechaPago: new Date() }
      : // Vuelve a 'pendiente' y no a 'atrasada': el estado de atraso lo recalcula
        // quien lo muestra, a partir de la fecha. Guardarlo aquí lo dejaría viejo.
        { estado: 'pendiente', fechaPago: null },
  })

  revalidatePath('/obligaciones')
  revalidatePath('/')
  return { ok: true }
}

export async function marcarCotizacionPagada(id: string, pagada: boolean): Promise<Resultado> {
  await requerirSesion()

  const cotizacion = await prisma.cotizacionPrevisional.findUnique({ where: { id } })
  if (!cotizacion) return { ok: false, error: 'La cotización ya no existe.' }

  if (!pagada && cotizacion.movimientoBancarioId) {
    return {
      ok: false,
      error:
        'Esta cotización tiene un cargo del banco enlazado, así que está pagada según la ' +
        'cartola. Para deshacerlo hay que romper la conciliación en Banco.',
    }
  }

  await prisma.cotizacionPrevisional.update({
    where: { id },
    data: pagada
      ? { estado: 'pagada', fechaPago: new Date() }
      : { estado: 'pendiente', fechaPago: null },
  })

  revalidatePath('/obligaciones')
  revalidatePath('/')
  return { ok: true }
}
