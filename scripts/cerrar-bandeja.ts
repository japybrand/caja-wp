/**
 * Cierra la parte de la bandeja que no necesita memoria ni decision del usuario.
 *
 *   npm run cerrar-bandeja            (simulacion)
 *   npm run cerrar-bandeja -- --firme
 *
 * Hace cuatro cosas:
 *
 *  1. Ignora los cobros de factura. Son plata que entra por ventas que el Registro
 *     de Ventas del SII ya cuenta en la fila "Ventas del mes". Asignarlos al flujo
 *     duplicaria los ingresos. Se ignoran con motivo, no se borran.
 *  2. Resuelve los cargos con glosa "Compra": los operacionales crean proveedor y
 *     movimiento, los personales se ignoran.
 *  3. Asigna el pago del 07/09 a la fila de pie inicial: calza con la activacion
 *     del convenio 257782 el 04/09.
 *  4. Deja anotado el "Pago de giros" huerfano de mayo.
 *
 * Lo que NO toca: Global66, las transferencias a personas y un puñado de glosas
 * sin identificar. Esas las revisa el usuario.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

const MOTIVO_COBRO =
  'cobro de factura: el Registro de Ventas del SII ya lo cuenta en "Ventas del mes"'
const MOTIVO_PERSONAL = 'gasto personal o no operacional, no entra al flujo'

/**
 * Abonos que NO son cobro de factura y por eso quedan fuera del lote.
 *
 *  - "Transf. Japybrand SPA": la cuenta propia en Global66, es plata que vuelve.
 *  - "Reverso Compra WebPay": reversos de compra con tarjeta. Junto con sus
 *    "Anulacion Rev." del 19/08 suman exactamente cero.
 *  - "Transf. Syt Impresores": SyT es proveedor (neto -374.430 en el año), asi que
 *    ese abono es una devolucion suya, no una venta.
 *  - "Transf. Alvaro Ramiro R": 2.500 exactos todos los meses. Demasiado regular
 *    para ser una factura.
 */
const ABONOS_FUERA_DEL_LOTE = [
  'Transf. Japybrand SPA',
  'Reverso Compra WebPay',
  'Transf. Syt Impresores',
  'Alvaro Ramiro',
]

/** Glosas de compra que son gasto personal o no operacional. */
const COMPRAS_PERSONALES = [
  'MERCADOPAGO *ASUS',
  'MERCADOPAGO *COSM',
  'MERCADOPAGO *ARTE',
  'MERCADOPAGO *LAES',
  'MP *MERCADOPAGOPA',
  'FALABELLA LOS DOM',
  'COPEC APP',
  'SHELL PANAMERICA',
  'MC DONALDS',
  'DON ELIAS',
  'STA ISABEL P HURT',
  'AHUM L205 FCO BIL',
  'EASYCANCHA',
  'EL MORDISCON',
  'RedGloba*CAFE LAS',
  'PR GASTRONOMIA LA',
  'PAYU *UBER EATS',
  'PedidosYa*Licorer',
  'LIBRERIA NAC DOM',
  'TOTTUS LOS DOMINI',
  'LAS CONDES 1',
  'DL*GOOGLE YOUTUBE',
  'GOOGLE PLAY YOUTU',
]

/**
 * Compras operacionales. `proveedor` se crea si no existe, con la glosa como alias
 * bancario para que la proxima cartola las clasifique sola.
 *
 * Se crea ademas el Movimiento: estos gastos no estaban en el Excel, asi que sin
 * movimiento no entrarian al flujo y el gasto seguiria invisible.
 */
const COMPRAS_OPERACIONALES: { glosa: string; proveedor: string; categoria: string }[] = [
  { glosa: 'GOOGLE *ADS', proveedor: 'Google ADS', categoria: 'Marketing digital' },
  { glosa: 'FC* FREEPIK PREMI', proveedor: 'Freepik', categoria: 'Sistema comercial' },
  { glosa: 'PAYPAL *YITHEMES', proveedor: 'YITH', categoria: 'Sistema comercial' },
  { glosa: 'FS *dataforseo', proveedor: 'DataForSEO', categoria: 'Marketing digital' },
  { glosa: 'FIGMA', proveedor: 'Figma', categoria: 'Sistema comercial' },
  { glosa: 'ACEPTA COM', proveedor: 'Acepta', categoria: 'Sistema comercial' },
  { glosa: 'A2E AI', proveedor: 'A2E AI', categoria: 'AI apps' },
  { glosa: 'Compra Trae', proveedor: 'Trae', categoria: 'AI apps' },
  { glosa: 'DL *BLUESNAP', proveedor: 'BlueSnap', categoria: 'Sistema comercial' },
  { glosa: 'DP* DODOPAY DRAFT', proveedor: 'Dodo Payments', categoria: 'Sistema comercial' },
  { glosa: 'PAYPAL *CAPCUT', proveedor: 'CapCut', categoria: 'Sistema comercial' },
  { glosa: 'ENTEL TIENDA R MA', proveedor: 'Entel', categoria: 'Proveedores nacional' },
]

async function ignorar(where: object, motivo: string, titulo: string): Promise<number> {
  const movs = await prisma.movimientoBancario.findMany({ where, orderBy: { fecha: 'asc' } })
  if (movs.length === 0) {
    console.log(`  ${titulo}: nada pendiente`)
    return 0
  }
  const total = movs.reduce((a, m) => a + m.monto, 0)
  console.log(`  ${titulo}: ${movs.length} movimientos, ${fmt(total)}`)
  if (firme) {
    await prisma.movimientoBancario.updateMany({
      where: { id: { in: movs.map((m) => m.id) } },
      data: { estadoConciliacion: 'ignorado', movimientoId: null, notaConciliacion: motivo },
    })
  }
  return movs.length
}

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  // ── 1. Cobros de factura ───────────────────────────────────────────────────
  console.log('1. COBROS DE FACTURA')
  const fuera = await prisma.movimientoBancario.findMany({
    where: {
      estadoConciliacion: 'sin_conciliar',
      monto: { gt: 0 },
      OR: ABONOS_FUERA_DEL_LOTE.map((g) => ({ descripcion: { contains: g } })),
    },
  })
  console.log(`  Fuera del lote por no ser cobros: ${fuera.length}`)
  await ignorar(
    {
      estadoConciliacion: 'sin_conciliar',
      monto: { gt: 0 },
      NOT: ABONOS_FUERA_DEL_LOTE.map((g) => ({ descripcion: { contains: g } })),
    },
    MOTIVO_COBRO,
    'Ignorados como cobro',
  )

  // ── 2. Compras ─────────────────────────────────────────────────────────────
  console.log('\n2. CARGOS CON GLOSA "Compra"')
  let personales = 0
  for (const glosa of COMPRAS_PERSONALES) {
    personales += await ignorar(
      { estadoConciliacion: 'sin_conciliar', descripcion: { contains: glosa } },
      MOTIVO_PERSONAL,
      `personal · ${glosa}`,
    )
  }
  console.log(`  → ${personales} movimientos ignorados como gasto personal`)

  console.log('\n  Operacionales (crean proveedor y movimiento):')
  let creados = 0
  for (const def of COMPRAS_OPERACIONALES) {
    const movs = await prisma.movimientoBancario.findMany({
      where: { estadoConciliacion: 'sin_conciliar', descripcion: { contains: def.glosa } },
      orderBy: { fecha: 'asc' },
    })
    if (movs.length === 0) {
      console.log(`    ${def.proveedor.padEnd(16)} nada pendiente`)
      continue
    }
    const total = movs.reduce((a, m) => a + m.monto, 0)
    console.log(
      `    ${def.proveedor.padEnd(16)} ${String(movs.length).padStart(2)} mov  ${fmt(total).padStart(11)}  → ${def.categoria}`,
    )
    if (!firme) continue

    const categoria = await prisma.categoria.findFirst({ where: { nombre: def.categoria } })
    if (!categoria) throw new Error(`No existe la categoría "${def.categoria}".`)

    let proveedor = await prisma.proveedor.findFirst({ where: { nombre: def.proveedor } })
    if (!proveedor) {
      const ultimo = await prisma.proveedor.findFirst({
        where: { categoriaId: categoria.id },
        orderBy: { orden: 'desc' },
      })
      proveedor = await prisma.proveedor.create({
        data: {
          nombre: def.proveedor,
          categoriaId: categoria.id,
          orden: (ultimo?.orden ?? 0) + 1,
          aliasBancarios: JSON.stringify([def.glosa]),
        },
      })
    } else {
      const alias: string[] = JSON.parse(proveedor.aliasBancarios || '[]')
      if (!alias.includes(def.glosa)) {
        await prisma.proveedor.update({
          where: { id: proveedor.id },
          data: { aliasBancarios: JSON.stringify([...alias, def.glosa]) },
        })
      }
    }

    for (const m of movs) {
      const idExterno = `cartola:${m.hash}`
      const movimiento = await prisma.movimiento.upsert({
        where: { idExterno },
        create: {
          fecha: m.fecha,
          mes: m.mes,
          anio: m.anio,
          montoCLP: Math.abs(m.monto),
          monedaOriginal: 'CLP',
          proveedorId: proveedor.id,
          categoriaId: categoria.id,
          descripcion: def.proveedor,
          fuente: 'cartola',
          idExterno,
          estado: 'confirmado',
        },
        update: { montoCLP: Math.abs(m.monto) },
      })
      await prisma.movimientoBancario.update({
        where: { id: m.id },
        data: {
          estadoConciliacion: 'conciliado',
          viaConciliacion: 'alias',
          movimientoId: movimiento.id,
          proveedorSugerido: proveedor.nombre,
          notaConciliacion: `gasto operacional de ${proveedor.nombre}, creado desde la cartola`,
        },
      })
      creados += 1
    }
  }
  console.log(`  → ${creados} movimientos creados en el flujo`)

  // ── 3. Pie inicial del convenio 257782 ─────────────────────────────────────
  console.log('\n3. T.G.R. DEL 07/09 (257.342)')
  const pie = await prisma.movimientoBancario.findFirst({
    where: { estadoConciliacion: 'sin_conciliar', descripcion: { contains: 'T.G.R.' }, mes: 9 },
  })
  const filaPie = await prisma.categoria.findFirst({ where: { nombre: 'TGR pie inicial' } })
  if (pie && filaPie) {
    const actual = await prisma.valorManual.findUnique({
      where: { categoriaId_anio_mes: { categoriaId: filaPie.id, anio: 2026, mes: 9 } },
    })
    console.log(
      `  ${pie.fecha.toISOString().slice(0, 10)} ${fmt(pie.monto)} → "TGR pie inicial" sep ` +
        `(${fmt(actual?.montoCLP ?? 0)} → ${fmt(-pie.monto)})`,
    )
    if (firme) {
      await prisma.valorManual.upsert({
        where: { categoriaId_anio_mes: { categoriaId: filaPie.id, anio: 2026, mes: 9 } },
        create: { categoriaId: filaPie.id, anio: 2026, mes: 9, montoCLP: -pie.monto, origen: 'banco' },
        update: { montoCLP: -pie.monto, origen: 'banco' },
      })
      await prisma.movimientoBancario.update({
        where: { id: pie.id },
        data: {
          estadoConciliacion: 'conciliado',
          viaConciliacion: 'manual',
          categoriaManualId: filaPie.id,
          notaConciliacion:
            'pie inicial del convenio TGR 257782, activado el 04/09/2026',
        },
      })
    }
  } else {
    console.log('  nada pendiente')
  }

  // ── 4. El "Pago de giros" huerfano ─────────────────────────────────────────
  console.log('\n4. "PAGO DE GIROS" DE MAYO')
  const giros = await prisma.categoria.findFirst({ where: { nombre: 'Pago de giros' } })
  if (giros) {
    const v = await prisma.valorManual.findFirst({ where: { categoriaId: giros.id, anio: 2026, mes: 5 } })
    console.log(
      `  ${fmt(v?.montoCLP ?? 0)} en impuestos, sin cargo del banco que lo explique. Se deja como está.`,
    )
    if (firme) {
      await prisma.categoria.update({
        where: { id: giros.id },
        data: {
          nota:
            'Mayo 2026: 1.519.742 sin respaldo en la cartola. Ningún cargo del mes calza, ' +
            'solo o sumado, y el único T.G.R. de mayo son los 771.640 del pie inicial. ' +
            'Pendiente de revisar con el contador: puede ser la misma deuda contada dos veces.',
        },
      })
    }
  }

  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito.')
    return
  }
  const quedan = await prisma.movimientoBancario.count({
    where: { estadoConciliacion: 'sin_conciliar' },
  })
  console.log(`\nLISTO. Bandeja: ${quedan}`)
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
