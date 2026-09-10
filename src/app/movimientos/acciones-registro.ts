'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'

/**
 * Registro rápido de un pago o un cobro que todavía no está en la cartola.
 *
 * POR QUÉ EXISTE
 * Entre pagar y ver el cargo conciliado pasan días: la cartola se descarga a mano.
 * Hasta ahora el único registro manual eran las obligaciones en /obligaciones, y
 * para todo lo demás había que esperar al banco o abrir el formulario largo.
 *
 * QUEDA DECLARADO, NO CONCILIADO
 * `fuente: 'declarado'` dice que alguien afirma que la plata se movió, y que el
 * banco todavía no lo confirma. La diferencia no es cosmética: mientras el cargo no
 * aparezca, esa plata SIGUE en el saldo de la cuenta. Si un declarado contara como
 * pagado, "falta pagar" bajaría sobre una plata que igual va a salir y la brecha del
 * mes quedaría optimista por ese monto. Por eso se muestra aparte y no se descuenta.
 *
 * Cuando la conciliación le engancha un cargo, pasa a contar como pagado sin que
 * haya que tocar nada: el flujo cuenta "tiene cargo enlazado" sin mirar la fuente.
 *
 * SOLO CATEGORÍAS DERIVADAS
 * Las filas manuales del flujo —deudas, impuestos, financiamiento— guardan un solo
 * número por mes en ValorManual, sin proveedor ni fecha. Registrar ahí sumaría al
 * total sin dejar rastro de quién ni cuándo, que es peor que no tenerlo. Para esas
 * está "Pendiente de pago" en /obligaciones.
 */

export interface Resultado {
  ok: boolean
  error?: string
  /** El movimiento que este pago estaría repitiendo, si lo hay. */
  duplicado?: { id: string; descripcion: string; montoCLP: number; fuente: string }
}

export interface DatosRegistro {
  categoriaId: string
  proveedorId: string | null
  /** "2026-09-10" */
  fecha: string
  montoCLP: number
  nota: string
  /**
   * Qué hacer si ya hay un movimiento del mismo proveedor y mes.
   *
   * 'preguntar' devuelve el candidato sin escribir nada. Es el valor por omisión
   * porque el caso normal —pagar algo que la planilla ya proyectaba— duplicaría el
   * gasto en silencio, y un flujo inflado sin señal es peor que un paso extra.
   */
  siDuplica: 'preguntar' | 'reemplazar' | 'agregar'
}

/** Dos montos que difieran menos que esto, del mismo proveedor y mes, son el mismo. */
const TOLERANCIA = 0.15

export async function registrarPago(datos: DatosRegistro): Promise<Resultado> {
  await requerirSesion()

  const fecha = new Date(`${datos.fecha}T12:00:00.000Z`)
  if (Number.isNaN(fecha.getTime())) return { ok: false, error: 'La fecha no es válida.' }
  const monto = Math.round(datos.montoCLP)
  if (!Number.isFinite(monto) || monto <= 0) {
    return { ok: false, error: 'El monto tiene que ser mayor que cero.' }
  }

  const categoria = await prisma.categoria.findUnique({ where: { id: datos.categoriaId } })
  if (!categoria) return { ok: false, error: 'La categoría no existe.' }
  if (categoria.esManual) {
    return {
      ok: false,
      error:
        `"${categoria.nombre}" es una fila manual del flujo: guarda un solo número por mes, ` +
        'sin proveedor ni fecha. Si es una cuota o una cotización, márcala en Obligaciones.',
    }
  }

  let proveedorId: string | null = null
  if (datos.proveedorId) {
    const proveedor = await prisma.proveedor.findUnique({ where: { id: datos.proveedorId } })
    if (!proveedor) return { ok: false, error: 'El proveedor no existe.' }
    if (proveedor.categoriaId !== categoria.id) {
      return { ok: false, error: 'Ese proveedor no pertenece a la categoría elegida.' }
    }
    proveedorId = proveedor.id
  }

  const mes = fecha.getUTCMonth() + 1
  const anio = fecha.getUTCFullYear()

  // ── ¿Ya existe algo parecido? ────────────────────────────────────────────
  // Se busca por proveedor y mes, que es como llega la proyección de la planilla.
  // Sin proveedor no se busca: una categoría entera calzaría con cualquier cosa.
  if (proveedorId && datos.siDuplica === 'preguntar') {
    const candidatos = await prisma.movimiento.findMany({
      where: { anio, mes, proveedorId, estado: 'confirmado' },
    })
    const parecido = candidatos.find((m) => {
      const mayor = Math.max(Math.abs(m.montoCLP), monto)
      return mayor > 0 && Math.abs(m.montoCLP - monto) / mayor <= TOLERANCIA
    })
    if (parecido) {
      return {
        ok: false,
        duplicado: {
          id: parecido.id,
          descripcion: parecido.descripcion,
          montoCLP: parecido.montoCLP,
          fuente: parecido.fuente,
        },
      }
    }
  }

  const descripcion = datos.nota.trim() || 'Registrado a mano'

  if (datos.siDuplica === 'reemplazar' && proveedorId) {
    const previo = await prisma.movimiento.findFirst({
      where: { anio, mes, proveedorId, estado: 'confirmado' },
      orderBy: { montoCLP: 'desc' },
    })
    if (previo) {
      // Reemplazar y no borrar-y-crear: así el movimiento conserva su id y no se
      // rompe nada que apunte a él, como una conciliación bancaria previa.
      await prisma.movimiento.update({
        where: { id: previo.id },
        data: { fecha, mes, anio, montoCLP: monto, descripcion, fuente: 'declarado' },
      })
      revalidatePath('/movimientos')
      revalidatePath('/flujo')
      revalidatePath('/')
      return { ok: true }
    }
  }

  await prisma.movimiento.create({
    data: {
      fecha,
      mes,
      anio,
      montoCLP: monto,
      monedaOriginal: 'CLP',
      proveedorId,
      categoriaId: categoria.id,
      descripcion,
      fuente: 'declarado',
      estado: 'confirmado',
    },
  })

  revalidatePath('/movimientos')
  revalidatePath('/flujo')
  revalidatePath('/')
  return { ok: true }
}
