/**
 * Los ultimos nueve cargos de la bandeja.
 *
 *   npm run cerrar-final            (simulacion)
 *   npm run cerrar-final -- --firme
 *
 * SYT SPA Y SYT IMPRESORES SON LA MISMA EMPRESA
 * Con dos RUT registrados: 76.321.799-K y 76.597.741-K. El segundo se suma como
 * alias del proveedor que ya existe en vez de crear uno nuevo, porque partir un
 * proveedor en dos por un cambio administrativo esconderia cuanto se le paga en
 * total.
 *
 * LOS SEIS CARGOS CHICOS SON GASTO OPERACIONAL
 * Pagos con la tarjeta de debito de la empresa. Van a una categoria propia,
 * "Gastos generales", y cada glosa queda como alias para que la proxima cartola los
 * reconozca sola. Sin el alias habria que volver a clasificarlos a mano cada mes.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

const CATEGORIA_GASTOS = 'Gastos generales'
const GRUPO_GASTOS = 'proveedores'

/** Las seis glosas de tarjeta de debito, con el nombre del comercio. */
const GASTOS_GENERALES: { glosa: string; nombre: string }[] = [
  { glosa: 'Compra ELADIO OSSA', nombre: 'Eladio Ossa' },
  { glosa: 'Compra NEXTER-AND-TPAELE', nombre: 'Nexter and Tpaele' },
  { glosa: 'Compra DBS', nombre: 'DBS' },
  { glosa: 'Compra JAVIER PEHOVAZ', nombre: 'Javier Pehovaz' },
  { glosa: 'Compra MANUEL DE LA LAST', nombre: 'Manuel de la Last' },
  { glosa: 'Compra SERVICIOS Y COMER', nombre: 'Servicios y Comer' },
]

async function crearMovimiento(
  cargo: { id: string; hash: string; fecha: Date; mes: number; anio: number; monto: number },
  categoriaId: string,
  proveedorId: string | null,
  descripcion: string,
  nota: string,
): Promise<void> {
  const idExterno = `cartola:${cargo.hash}`
  const movimiento = await prisma.movimiento.upsert({
    where: { idExterno },
    create: {
      fecha: cargo.fecha,
      mes: cargo.mes,
      anio: cargo.anio,
      montoCLP: Math.abs(cargo.monto),
      monedaOriginal: 'CLP',
      proveedorId,
      categoriaId,
      descripcion,
      fuente: 'cartola',
      idExterno,
      estado: 'confirmado',
    },
    update: { montoCLP: Math.abs(cargo.monto) },
  })
  await prisma.movimientoBancario.update({
    where: { id: cargo.id },
    data: {
      estadoConciliacion: 'conciliado',
      viaConciliacion: proveedorId ? 'alias' : 'manual',
      movimientoId: movimiento.id,
      notaConciliacion: nota,
    },
  })
}

async function agregarAlias(proveedorId: string, alias: string): Promise<void> {
  const p = await prisma.proveedor.findUnique({ where: { id: proveedorId } })
  if (!p) return
  const lista: string[] = JSON.parse(p.aliasBancarios || '[]')
  if (lista.includes(alias)) return
  await prisma.proveedor.update({
    where: { id: proveedorId },
    data: { aliasBancarios: JSON.stringify([...lista, alias]) },
  })
}

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  // ── 1. SyT SpA ─────────────────────────────────────────────────────────────
  const syt = await prisma.proveedor.findFirst({ where: { nombre: 'SyT Impresores' } })
  if (!syt) throw new Error('No existe el proveedor "SyT Impresores".')
  const cargosSyt = await prisma.movimientoBancario.findMany({
    where: { estadoConciliacion: 'sin_conciliar', descripcion: { contains: 'SyT SpA' } },
    orderBy: { fecha: 'asc' },
  })
  console.log(`1. SyT SpA → SyT Impresores (mismo negocio, otro RUT): ${cargosSyt.length} cargos`)
  for (const c of cargosSyt) {
    console.log(`     ${c.fecha.toISOString().slice(0, 10)} ${fmt(c.monto).padStart(10)}`)
    if (firme) {
      await crearMovimiento(
        c,
        syt.categoriaId,
        syt.id,
        'SyT Impresores',
        'SyT SpA es el mismo negocio que SyT Impresores, con otro RUT registrado',
      )
    }
  }
  if (firme && cargosSyt.length > 0) await agregarAlias(syt.id, 'Transf a SyT SpA')

  // ── 2. Cristián Andrés ─────────────────────────────────────────────────────
  const cristian = await prisma.proveedor.findFirst({ where: { nombre: 'Cristián Andrés' } })
  if (!cristian) throw new Error('No existe el proveedor "Cristián Andrés".')
  const cargosCristian = await prisma.movimientoBancario.findMany({
    where: { estadoConciliacion: 'sin_conciliar', descripcion: { contains: 'CRISTIAN' } },
    orderBy: { fecha: 'asc' },
  })
  console.log(`\n2. Cristián Andrés → remuneración de enero: ${cargosCristian.length} cargos`)
  for (const c of cargosCristian) {
    console.log(`     ${c.fecha.toISOString().slice(0, 10)} ${fmt(c.monto).padStart(10)}`)
    if (firme) {
      await crearMovimiento(
        c,
        cristian.categoriaId,
        cristian.id,
        'Cristián Andrés · remuneración',
        'remuneración de enero, junto con el cargo del día 6',
      )
    }
  }

  // ── 3. Gastos generales ────────────────────────────────────────────────────
  let catGastos = await prisma.categoria.findFirst({ where: { nombre: CATEGORIA_GASTOS } })
  console.log(`\n3. Gastos generales${catGastos ? ' (la categoría ya existe)' : ' (categoría nueva)'}`)
  if (!catGastos && firme) {
    const ultimo = await prisma.categoria.findFirst({
      where: { grupo: GRUPO_GASTOS },
      orderBy: { orden: 'desc' },
    })
    catGastos = await prisma.categoria.create({
      data: {
        nombre: CATEGORIA_GASTOS,
        grupo: GRUPO_GASTOS,
        orden: (ultimo?.orden ?? 0) + 1,
        esManual: false,
        nota: 'Compras con la tarjeta de débito de la empresa que no caen en otra categoría.',
      },
    })
  }

  let creados = 0
  for (const g of GASTOS_GENERALES) {
    const cargos = await prisma.movimientoBancario.findMany({
      where: { estadoConciliacion: 'sin_conciliar', descripcion: { contains: g.glosa } },
      orderBy: { fecha: 'asc' },
    })
    if (cargos.length === 0) {
      console.log(`     ${g.nombre.padEnd(20)} nada pendiente`)
      continue
    }
    const total = cargos.reduce((a, c) => a + c.monto, 0)
    console.log(`     ${g.nombre.padEnd(20)} ${cargos.length} mov ${fmt(total).padStart(10)}`)
    if (!firme || !catGastos) continue

    let proveedor = await prisma.proveedor.findFirst({ where: { nombre: g.nombre } })
    if (!proveedor) {
      const ultimo = await prisma.proveedor.findFirst({
        where: { categoriaId: catGastos.id },
        orderBy: { orden: 'desc' },
      })
      proveedor = await prisma.proveedor.create({
        data: {
          nombre: g.nombre,
          categoriaId: catGastos.id,
          orden: (ultimo?.orden ?? 0) + 1,
          aliasBancarios: JSON.stringify([g.glosa]),
        },
      })
    } else {
      await agregarAlias(proveedor.id, g.glosa)
    }

    for (const c of cargos) {
      await crearMovimiento(
        c,
        catGastos.id,
        proveedor.id,
        g.nombre,
        'gasto con la tarjeta de débito de la empresa',
      )
      creados += 1
    }
  }
  console.log(`     ${creados} movimientos creados`)

  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito.')
    return
  }
  const quedan = await prisma.movimientoBancario.findMany({
    where: { estadoConciliacion: 'sin_conciliar' },
  })
  console.log(`\nLISTO. Bandeja: ${quedan.length}`)
  for (const q of quedan) {
    console.log(`  ${q.fecha.toISOString().slice(0, 10)} ${fmt(q.monto).padStart(11)}  ${q.descripcion}`)
  }
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
