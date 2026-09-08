/**
 * Clasifica los cargos que quedaban en la bandeja esperando la memoria del usuario.
 *
 *   npm run clasificar-bandeja            (simulacion)
 *   npm run clasificar-bandeja -- --firme
 *
 * DAMIAN MORENO Y LA FILA QUE BORRAMOS EN LA FASE 1
 * Los 328.446 de mayo son el mismo monto que la fila sin nombre de "Pagos
 * Honorarios" que la fase 1 descarto por considerarla un error. No era un error:
 * era este cargo, y va a Retiros y no a honorarios. Como esa fila nunca se importo,
 * crear el movimiento ahora lo cuenta una sola vez. El script lo verifica antes de
 * escribir y aborta si encuentra otro movimiento por el mismo monto.
 *
 * UN CARGO, DOS DESTINOS
 * El cargo del 06/02 por 2.500.000 a MOLINA OVALLE son 1.500.000 de remuneracion y
 * 1.000.000 de retiro en una sola transferencia. Se crean dos movimientos con
 * idExterno distinto sobre el mismo hash, y el movimiento bancario queda conciliado
 * sin enlazar a ninguno: enlazarlo a uno solo daria a entender que el otro no
 * existe.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

/** Monto de la fila 8 de Pagos Honorarios que la fase 1 descarto. */
const MONTO_DAMIAN = 328_446

interface Destino {
  /** Fragmento de la glosa que identifica al cargo. */
  glosa: string
  /** Monto exacto, para cuando la glosa se repite con montos distintos. */
  monto?: number
  categoria: string
  proveedor?: string
  descripcion: string
  /** Alias bancario a guardar en el proveedor. */
  alias?: string
  /** Colaboradores que ya no trabajan con la agencia. */
  inactivo?: boolean
}

const DESTINOS: Destino[] = [
  // ── Retiros ────────────────────────────────────────────────────────────────
  { glosa: 'Aracely Rodrig', categoria: 'Retiros', descripcion: 'Retiro · Aracely Rodríguez' },
  { glosa: 'Analia Melina', categoria: 'Retiros', descripcion: 'Retiro · Analia Melina' },
  { glosa: 'Jeannette Oval', categoria: 'Retiros', descripcion: 'Retiro · Jeannette Oval' },
  // No era un retiro ni un error: Damian Moreno fue colaborador a honorarios y se
  // fue. La planilla tenia razon en la categoria, solo le faltaba el nombre.
  {
    glosa: 'Damián moreno',
    categoria: 'Pago de servicios a honorarios',
    proveedor: 'Damián Moreno',
    alias: 'Transf a Damián moreno',
    inactivo: true,
    descripcion: 'Honorarios · Damián Moreno',
  },
  {
    glosa: 'Transf a MOLINA OVALLE',
    monto: -987_018,
    categoria: 'Retiros',
    descripcion: 'Retiro · Felipe Molina',
  },

  // ── Servicios legales ──────────────────────────────────────────────────────
  {
    glosa: 'Transf a Carlos Millán',
    categoria: 'Proveedores nacional',
    proveedor: 'Carlos Millán',
    alias: 'Transf a Carlos Millán',
    descripcion: 'Servicios legales · Carlos Millán',
  },
  {
    glosa: 'Transf a ABOGADOS CHILE',
    categoria: 'Proveedores nacional',
    proveedor: 'Carlos Millán',
    alias: 'Transf a ABOGADOS CHILE',
    descripcion: 'Servicios legales · Carlos Millán (Abogados Chile)',
  },
]

/** El cargo que se parte en dos. */
const PARTIDO = {
  glosa: 'Transf a MOLINA OVALLE',
  monto: -2_500_000,
  partes: [
    {
      categoria: 'Pago de nóminas',
      proveedor: 'Felipe Molina',
      montoCLP: 1_500_000,
      descripcion: 'Remuneración · Felipe Molina',
      sufijo: 'remuneracion',
    },
    {
      categoria: 'Retiros',
      montoCLP: 1_000_000,
      descripcion: 'Retiro · Felipe Molina',
      sufijo: 'retiro',
    },
  ],
}

async function categoriaPorNombre(nombre: string) {
  const c = await prisma.categoria.findFirst({ where: { nombre } })
  if (!c) throw new Error(`No existe la categoría "${nombre}".`)
  return c
}

async function proveedorPorNombre(
  nombre: string,
  categoriaId: string,
  alias?: string,
  inactivo?: boolean,
) {
  let p = await prisma.proveedor.findFirst({ where: { nombre } })
  if (!p) {
    const ultimo = await prisma.proveedor.findFirst({
      where: { categoriaId },
      orderBy: { orden: 'desc' },
    })
    p = await prisma.proveedor.create({
      data: {
        nombre,
        categoriaId,
        orden: (ultimo?.orden ?? 0) + 1,
        aliasBancarios: JSON.stringify(alias ? [alias] : []),
        activo: !inactivo,
      },
    })
  } else if (alias) {
    const lista: string[] = JSON.parse(p.aliasBancarios || '[]')
    if (!lista.includes(alias)) {
      p = await prisma.proveedor.update({
        where: { id: p.id },
        data: { aliasBancarios: JSON.stringify([...lista, alias]) },
      })
    }
  }
  return p
}

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  // --- Guardia del doble conteo de Damián Moreno ----------------------------
  //
  // Solo cuentan los movimientos por ese monto que NO vengan de la cartola: los de
  // la cartola son los que crea este mismo script, y bloquear por ellos haría que
  // no se pudiera volver a correr.
  const otros = await prisma.movimiento.findMany({
    where: { montoCLP: MONTO_DAMIAN, fuente: { not: 'cartola' } },
    include: { categoria: true },
  })
  if (otros.length > 0) {
    throw new Error(
      `Hay ${otros.length} movimiento(s) por ${fmt(MONTO_DAMIAN)} fuera de la cartola ` +
        `(${otros.map((m) => `${m.fuente} en ${m.categoria.nombre}`).join(', ')}). ` +
        'Se abortó para no contar dos veces el pago a Damián Moreno.',
    )
  }
  const deCartola = await prisma.movimiento.count({
    where: { montoCLP: MONTO_DAMIAN, fuente: 'cartola' },
  })
  console.log(
    `Guardia: ${deCartola} movimiento(s) por ${fmt(MONTO_DAMIAN)}, todos de la cartola. Sin doble conteo.\n`,
  )

  let creados = 0
  for (const d of DESTINOS) {
    const cargos = await prisma.movimientoBancario.findMany({
      where: {
        estadoConciliacion: 'sin_conciliar',
        descripcion: { contains: d.glosa },
        ...(d.monto === undefined ? {} : { monto: d.monto }),
      },
      orderBy: { fecha: 'asc' },
    })
    if (cargos.length === 0) {
      console.log(`  ${d.glosa.padEnd(26)} nada pendiente`)
      continue
    }
    const total = cargos.reduce((a, c) => a + c.monto, 0)
    console.log(
      `  ${d.glosa.padEnd(26)} ${String(cargos.length).padStart(2)} mov ${fmt(total).padStart(11)} → ` +
        `${d.categoria}${d.proveedor ? ` / ${d.proveedor}` : ''}`,
    )
    if (!firme) continue

    const categoria = await categoriaPorNombre(d.categoria)
    const proveedor = d.proveedor
      ? await proveedorPorNombre(d.proveedor, categoria.id, d.alias, d.inactivo)
      : null

    for (const c of cargos) {
      const idExterno = `cartola:${c.hash}`
      const movimiento = await prisma.movimiento.upsert({
        where: { idExterno },
        create: {
          fecha: c.fecha,
          mes: c.mes,
          anio: c.anio,
          montoCLP: Math.abs(c.monto),
          monedaOriginal: 'CLP',
          proveedorId: proveedor?.id ?? null,
          categoriaId: categoria.id,
          descripcion: d.descripcion,
          fuente: 'cartola',
          idExterno,
          estado: 'confirmado',
        },
        update: { montoCLP: Math.abs(c.monto) },
      })
      await prisma.movimientoBancario.update({
        where: { id: c.id },
        data: {
          estadoConciliacion: 'conciliado',
          viaConciliacion: proveedor ? 'alias' : 'manual',
          movimientoId: movimiento.id,
          proveedorSugerido: proveedor?.nombre ?? null,
          notaConciliacion: d.descripcion,
        },
      })
      creados += 1
    }
  }

  // --- El cargo que se parte en dos -----------------------------------------
  const partido = await prisma.movimientoBancario.findFirst({
    where: {
      estadoConciliacion: 'sin_conciliar',
      descripcion: { contains: PARTIDO.glosa },
      monto: PARTIDO.monto,
    },
  })
  if (partido) {
    console.log(`\n  ${partido.fecha.toISOString().slice(0, 10)} ${fmt(partido.monto)} se parte en:`)
    for (const parte of PARTIDO.partes) {
      console.log(
        `     ${fmt(parte.montoCLP).padStart(11)} → ${parte.categoria}${parte.proveedor ? ` / ${parte.proveedor}` : ''}`,
      )
    }
    if (firme) {
      for (const parte of PARTIDO.partes) {
        const categoria = await categoriaPorNombre(parte.categoria)
        const proveedor = parte.proveedor
          ? await proveedorPorNombre(parte.proveedor, categoria.id)
          : null
        const idExterno = `cartola:${partido.hash}:${parte.sufijo}`
        await prisma.movimiento.upsert({
          where: { idExterno },
          create: {
            fecha: partido.fecha,
            mes: partido.mes,
            anio: partido.anio,
            montoCLP: parte.montoCLP,
            monedaOriginal: 'CLP',
            proveedorId: proveedor?.id ?? null,
            categoriaId: categoria.id,
            descripcion: parte.descripcion,
            fuente: 'cartola',
            idExterno,
            estado: 'confirmado',
          },
          update: { montoCLP: parte.montoCLP },
        })
        creados += 1
      }
      await prisma.movimientoBancario.update({
        where: { id: partido.id },
        data: {
          estadoConciliacion: 'conciliado',
          viaConciliacion: 'manual',
          // A propósito sin enlazar: son dos movimientos y apuntar a uno solo
          // haría parecer que el otro no existe.
          movimientoId: null,
          notaConciliacion:
            'un solo cargo con dos destinos: 1.500.000 de remuneración y 1.000.000 de retiro',
        },
      })
    }
  } else {
    console.log('\n  El cargo de 2.500.000 ya no está pendiente.')
  }

  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito.')
    return
  }
  const quedan = await prisma.movimientoBancario.findMany({
    where: { estadoConciliacion: 'sin_conciliar' },
  })
  console.log(`\n${creados} movimientos creados. Bandeja: ${quedan.length}`)
  for (const q of quedan) {
    console.log(`  ${q.fecha.toISOString().slice(0, 10)} ${fmt(q.monto).padStart(12)}  ${q.descripcion}`)
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
