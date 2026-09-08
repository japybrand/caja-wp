import 'server-only'
import { prisma } from '@/lib/prisma'
import { leerRemitentes } from '@/lib/dominio'
import { buscarProveedor, nucleoGlosa } from './glosa'
import { evaluarReglas, explicarResultado, type ReglaEvaluable } from '@/lib/reglas'

/**
 * Conciliación entre la cartola y los movimientos del flujo.
 *
 * Orden de emparejamiento, del más confiable al menos:
 *   1. Regla de clasificación (el monto exacto gana sobre el patrón suelto)
 *   2. Alias bancario del proveedor
 *   3. Nombre del proveedor por coincidencia parcial (la glosa viene truncada)
 *   4. Monto y mes contra un Movimiento existente
 *
 * Sin calce en ninguno, queda sin conciliar para que lo resuelva una persona.
 *
 * Conciliar ENLAZA, no crea: un cargo del banco sin Movimiento equivalente no
 * genera uno. El banco trae 132 millones de cargos en nueve meses y la app tiene
 * 86, porque el banco incluye impuestos, deudas, tarjeta y gastos personales.
 */

/** Tolerancia para dar por igual dos montos del mismo proveedor y mes. */
const TOLERANCIA = 0.01

export type ViaConciliacion = 'regla' | 'alias' | 'nombre' | 'monto_mes' | 'ninguna'

export interface PropuestaConciliacion {
  bancarioId: string
  fecha: Date
  mes: number
  monto: number
  descripcion: string
  via: ViaConciliacion
  /** Movimiento del flujo al que se enlazaría, si lo hay. */
  movimientoId: string | null
  movimientoDescripcion: string | null
  movimientoMonto: number | null
  proveedorId: string | null
  proveedorNombre: string | null
  categoriaNombre: string | null
  nota: string
  /** true cuando queda para que lo decida una persona. */
  sinConciliar: boolean
}

export interface ResumenConciliacion {
  total: number
  porVia: Record<ViaConciliacion, number>
  enlazados: number
  sinConciliar: number
  montoEnlazado: number
  montoSinConciliar: number
  propuestas: PropuestaConciliacion[]
}

/**
 * Casos que se dejan sin conciliar a propósito, acordados con Japybrand WP.
 * Cada uno lleva por qué: sin esto, la regla general los mandaría a Retiros y se
 * perdería la separación entre remuneración y retiro.
 */
const DEJAR_SIN_CONCILIAR: { contiene: string; monto: number; motivo: string }[] = [
  {
    contiene: 'MOLINA OVALLE',
    monto: -2_500_000,
    motivo:
      'los dos conceptos en un solo cargo: 1.500.000 de remuneración + 1.000.000 de retiro. Hay que separarlo a mano.',
  },
  {
    contiene: 'MOLINA OVALLE',
    monto: -987_018,
    motivo:
      'retiro del mes por un monto distinto al habitual; el Excel trae 2.487.018 = 1.500.000 + 987.018.',
  },
]

/**
 * El traspaso a Global66 no se concilia contra un movimiento: se reparte entre los
 * colaboradores internacionales según lo efectivamente enviado. Ese reparto no está
 * implementado todavía, así que el cargo queda identificado pero sin enlazar.
 */
const PATRON_GLOBAL66 = 'Transf a Japybrand SPA'

export async function simularConciliacion(anio: number): Promise<ResumenConciliacion> {
  const [bancarios, proveedores, reglasBD, movimientos] = await Promise.all([
    prisma.movimientoBancario.findMany({
      where: { anio, estadoConciliacion: 'sin_conciliar' },
      orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    }),
    prisma.proveedor.findMany({ include: { categoria: { select: { nombre: true } } } }),
    prisma.reglaClasificacion.findMany({
      include: { categoria: { select: { nombre: true } }, proveedor: { select: { nombre: true } } },
    }),
    prisma.movimiento.findMany({
      where: { anio },
      select: {
        id: true,
        mes: true,
        montoCLP: true,
        descripcion: true,
        proveedorId: true,
        estado: true,
        fuente: true,
      },
    }),
  ])

  const reglas: ReglaEvaluable[] = reglasBD.map((r) => ({
    id: r.id,
    patron: r.patron,
    montoExacto: r.montoExacto,
    categoriaId: r.categoriaId,
    proveedorId: r.proveedorId,
    nota: r.nota,
    activa: r.activa,
  }))

  const conAlias = proveedores.map((p) => ({
    ...p,
    alias: leerRemitentes(p.aliasBancarios),
  }))

  // Un movimiento del flujo se enlaza una sola vez.
  const yaUsados = new Set<string>()

  const buscarMovimiento = (
    proveedorId: string | null,
    mes: number,
    monto: number,
  ): (typeof movimientos)[number] | null => {
    const objetivo = Math.abs(monto)
    const candidatos = movimientos.filter(
      (m) =>
        !yaUsados.has(m.id) &&
        m.mes === mes &&
        (proveedorId === null || m.proveedorId === proveedorId),
    )
    const exacto = candidatos.find((m) => m.montoCLP === objetivo)
    if (exacto) return exacto
    return (
      candidatos.find((m) => {
        const mayor = Math.max(Math.abs(m.montoCLP), objetivo)
        if (mayor === 0) return false
        return Math.abs(m.montoCLP - objetivo) / mayor <= TOLERANCIA
      }) ?? null
    )
  }

  const propuestas: PropuestaConciliacion[] = []

  for (const b of bancarios) {
    const base = {
      bancarioId: b.id,
      fecha: b.fecha,
      mes: b.mes,
      monto: b.monto,
      descripcion: b.descripcion,
    }

    /**
     * Los abonos no se concilian contra movimientos: los Movimiento del flujo son
     * egresos. Sin esto, un pago de cliente cuya glosa menciona por casualidad a un
     * proveedor ("FACT No 646 RANK MA…", que es plata que ENTRA de RC Ingeniería)
     * se enlazaba con el gasto de Rank Math del mismo monto.
     *
     * Los ingresos ya vienen del Registro de Ventas del SII, que es la fuente buena.
     */
    if (b.monto > 0) {
      propuestas.push({
        ...base,
        via: 'ninguna',
        movimientoId: null,
        movimientoDescripcion: null,
        movimientoMonto: null,
        proveedorId: null,
        proveedorNombre: null,
        categoriaNombre: null,
        nota: 'abono: los ingresos salen del Registro de Ventas del SII, no de la cartola',
        sinConciliar: true,
      })
      continue
    }

    // --- Casos que se dejan a mano a propósito -----------------------------
    const excepcion = DEJAR_SIN_CONCILIAR.find(
      (e) => b.descripcion.toUpperCase().includes(e.contiene) && b.monto === e.monto,
    )
    if (excepcion) {
      propuestas.push({
        ...base,
        via: 'ninguna',
        movimientoId: null,
        movimientoDescripcion: null,
        movimientoMonto: null,
        proveedorId: null,
        proveedorNombre: null,
        categoriaNombre: null,
        nota: `se deja a mano: ${excepcion.motivo}`,
        sinConciliar: true,
      })
      continue
    }

    // --- 1. Reglas ---------------------------------------------------------
    const resultado = evaluarReglas(b.descripcion, b.monto, reglas)

    if (resultado.tipo === 'calce') {
      const regla = reglasBD.find((r) => r.id === resultado.regla.id)
      const esGlobal66 = regla?.patron === PATRON_GLOBAL66

      if (esGlobal66) {
        propuestas.push({
          ...base,
          via: 'regla',
          movimientoId: null,
          movimientoDescripcion: null,
          movimientoMonto: null,
          proveedorId: null,
          proveedorNombre: null,
          categoriaNombre: regla?.categoria.nombre ?? null,
          nota:
            'traspaso a Global66: no es un gasto en sí, se reparte entre los colaboradores ' +
            'internacionales según lo efectivamente enviado. El reparto no está implementado.',
          sinConciliar: true,
        })
        continue
      }

      const movimiento = buscarMovimiento(regla?.proveedorId ?? null, b.mes, b.monto)
      if (movimiento) yaUsados.add(movimiento.id)
      propuestas.push({
        ...base,
        via: 'regla',
        movimientoId: movimiento?.id ?? null,
        movimientoDescripcion: movimiento?.descripcion ?? null,
        movimientoMonto: movimiento?.montoCLP ?? null,
        proveedorId: regla?.proveedorId ?? null,
        proveedorNombre: regla?.proveedor?.nombre ?? null,
        categoriaNombre: regla?.categoria.nombre ?? null,
        nota: explicarResultado(resultado),
        sinConciliar: movimiento === null,
      })
      continue
    }

    if (resultado.tipo === 'monto_sin_regla') {
      propuestas.push({
        ...base,
        via: 'ninguna',
        movimientoId: null,
        movimientoDescripcion: null,
        movimientoMonto: null,
        proveedorId: null,
        proveedorNombre: null,
        categoriaNombre: null,
        nota: explicarResultado(resultado),
        sinConciliar: true,
      })
      continue
    }

    // --- 2 y 3. Alias y nombre del proveedor -------------------------------
    const calce = buscarProveedor(b.descripcion, conAlias)
    if (calce) {
      const movimiento = buscarMovimiento(calce.proveedor.id, b.mes, b.monto)
      if (movimiento) yaUsados.add(movimiento.id)
      propuestas.push({
        ...base,
        via: calce.via === 'alias' ? 'alias' : 'nombre',
        movimientoId: movimiento?.id ?? null,
        movimientoDescripcion: movimiento?.descripcion ?? null,
        movimientoMonto: movimiento?.montoCLP ?? null,
        proveedorId: calce.proveedor.id,
        proveedorNombre: calce.proveedor.nombre,
        categoriaNombre: calce.proveedor.categoria.nombre,
        nota:
          calce.via === 'alias'
            ? `alias bancario de ${calce.proveedor.nombre}`
            : `el nombre "${calce.proveedor.nombre}" calza con la glosa "${nucleoGlosa(b.descripcion)}"`,
        sinConciliar: movimiento === null,
      })
      continue
    }

    // --- 4. Sin proveedor identificado -------------------------------------
    propuestas.push({
      ...base,
      via: 'ninguna',
      movimientoId: null,
      movimientoDescripcion: null,
      movimientoMonto: null,
      proveedorId: null,
      proveedorNombre: null,
      categoriaNombre: null,
      nota: 'ningún proveedor calza con la glosa',
      sinConciliar: true,
    })
  }

  const porVia: Record<ViaConciliacion, number> = {
    regla: 0,
    alias: 0,
    nombre: 0,
    monto_mes: 0,
    ninguna: 0,
  }
  for (const p of propuestas) porVia[p.via] += 1

  const enlazadas = propuestas.filter((p) => !p.sinConciliar)
  const sueltas = propuestas.filter((p) => p.sinConciliar)

  return {
    total: propuestas.length,
    porVia,
    enlazados: enlazadas.length,
    sinConciliar: sueltas.length,
    montoEnlazado: enlazadas.reduce((a, p) => a + p.monto, 0),
    montoSinConciliar: sueltas.reduce((a, p) => a + p.monto, 0),
    propuestas,
  }
}

/** Aplica una simulación. Solo cambia MovimientoBancario: no toca los Movimiento. */
export async function aplicarConciliacion(resumen: ResumenConciliacion): Promise<number> {
  let aplicados = 0
  for (const p of resumen.propuestas) {
    if (p.sinConciliar) {
      await prisma.movimientoBancario.update({
        where: { id: p.bancarioId },
        data: {
          estadoConciliacion: 'sin_conciliar',
          proveedorSugerido: p.proveedorNombre,
          viaConciliacion: p.via,
          notaConciliacion: p.nota,
        },
      })
      continue
    }
    await prisma.movimientoBancario.update({
      where: { id: p.bancarioId },
      data: {
        estadoConciliacion: 'conciliado',
        movimientoId: p.movimientoId,
        proveedorSugerido: p.proveedorNombre,
        viaConciliacion: p.via,
        notaConciliacion: p.nota,
      },
    })
    aplicados += 1
  }
  return aplicados
}
