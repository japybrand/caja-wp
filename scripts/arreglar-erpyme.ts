/**
 * Corrige el cargo de 870.000 con glosa "Compra ERPYME" y deja las reglas que
 * evitan que vuelva a pasar.
 *
 *   npm run arreglar-erpyme            (simulacion)
 *   npm run arreglar-erpyme -- --firme
 *
 * ERPyme es la plataforma de Maxxa, y por ahi pasan dos cobros distintos: la
 * suscripcion mensual del ERP, entre 42.500 y 43.800, y la cuota de la linea
 * Fogape. La resolucion en lote del 2026-08-06 los junto a los dos en el
 * proveedor Maxxa ERP, y agosto quedo con 913.744 en Sistema comercial mas los
 * 870.000 que ya trae "Fogape - cuotas": la cuota contada dos veces.
 *
 * Las reglas van de a dos y eso no es opcional. El motor evalua reglas ANTES que
 * los alias, y un patron que calza sin regla que cubra el monto deja el cargo sin
 * conciliar. Con solo la regla de 870.000, los nueve cobros de la suscripcion
 * dejarian de resolverse por alias y caerian a la bandeja.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(n)

const PATRON = 'Compra ERPYME'
/** Cuota mensual de la linea Fogape segun la tabla de desarrollo de Maxxa. */
const CUOTA_FOGAPE = 870_000

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  const fogape = await prisma.categoria.findFirst({ where: { nombre: 'Fogape - cuotas' } })
  const sistema = await prisma.categoria.findFirst({ where: { nombre: 'Sistema comercial' } })
  const maxxaErp = await prisma.proveedor.findFirst({ where: { nombre: 'Maxxa ERP' } })
  if (!fogape || !sistema || !maxxaErp) throw new Error('Faltan la categoría o el proveedor.')

  // 1. Las dos reglas.
  const aCrear = [
    {
      montoExacto: CUOTA_FOGAPE,
      categoriaId: fogape.id,
      proveedorId: null,
      nota: 'Cuota de la línea Fogape Maxxa cobrada por ERPyme, no la suscripción del ERP.',
    },
    {
      montoExacto: null,
      categoriaId: sistema.id,
      proveedorId: maxxaErp.id,
      nota: 'Suscripción mensual del ERP de Maxxa, entre 42.500 y 43.800.',
    },
  ]

  console.log('Reglas:')
  for (const r of aCrear) {
    // Prisma no acepta null en el where de un indice compuesto, asi que la regla
    // general se busca con findFirst y no con findUnique.
    const existe =
      r.montoExacto === null
        ? await prisma.reglaClasificacion.findFirst({ where: { patron: PATRON, montoExacto: null } })
        : await prisma.reglaClasificacion.findUnique({
            where: { patron_montoExacto: { patron: PATRON, montoExacto: r.montoExacto } },
          })
    const destino = r.montoExacto === null ? 'Sistema comercial / Maxxa ERP' : 'Fogape - cuotas'
    const monto = r.montoExacto === null ? 'cualquier monto' : fmt(r.montoExacto)
    console.log(`  "${PATRON}" (${monto}) → ${destino}${existe ? '   [ya existía]' : '   [nueva]'}`)
    if (firme && !existe) {
      await prisma.reglaClasificacion.create({ data: { patron: PATRON, ...r } })
    }
  }

  // 2. El cargo mal asignado.
  const cargo = await prisma.movimientoBancario.findFirst({
    where: { descripcion: { contains: 'ERPYME' }, monto: -CUOTA_FOGAPE },
  })
  if (!cargo) {
    console.log('\nEl cargo de 870.000 ya no está donde estaba. Nada que mover.')
    return
  }

  console.log(`\nCargo ${cargo.fecha.toISOString().slice(0, 10)} ${fmt(cargo.monto)} "${cargo.descripcion}"`)

  // El movimiento del flujo agrupaba los dos cargos del mes. Se le resta la cuota
  // y queda solo con la suscripcion.
  if (cargo.movimientoId) {
    const mov = await prisma.movimiento.findUnique({ where: { id: cargo.movimientoId } })
    if (mov) {
      const nuevo = mov.montoCLP - CUOTA_FOGAPE
      console.log(`  "${mov.descripcion}"  ${fmt(mov.montoCLP)} → ${fmt(nuevo)}`)
      if (firme) {
        await prisma.movimiento.update({
          where: { id: mov.id },
          data: { montoCLP: nuevo, descripcion: 'Maxxa ERP · 1 cargo del banco' },
        })
      }
    }
  }

  // La fila "Fogape - cuotas" NO se toca: ya trae los 870.000 de agosto desde la
  // tabla de desarrollo. Sumarlos aqui seria volver a contar la cuota.
  const valor = await prisma.valorManual.findUnique({
    where: { categoriaId_anio_mes: { categoriaId: fogape.id, anio: cargo.anio, mes: cargo.mes } },
  })
  console.log(`  "Fogape - cuotas" mes ${cargo.mes}: ${fmt(valor?.montoCLP ?? 0)} (sin cambios, viene de la tabla)`)

  if (firme) {
    await prisma.movimientoBancario.update({
      where: { id: cargo.id },
      data: {
        estadoConciliacion: 'conciliado',
        viaConciliacion: 'regla',
        movimientoId: null,
        categoriaManualId: fogape.id,
        esReversa: false,
        notaConciliacion: 'cuota Fogape Maxxa cobrada por ERPyme; el valor del mes viene de la tabla de desarrollo',
      },
    })
  }

  if (!firme) console.log('\nSIMULACIÓN: nada escrito.')
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
