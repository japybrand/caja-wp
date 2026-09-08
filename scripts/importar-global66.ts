/**
 * Importa el export de Global66 y reparte los pagos internacionales.
 *
 *   npm run importar-global66            (simulacion)
 *   npm run importar-global66 -- --firme
 *
 * EL BANCO MANDA, TAMBIEN AQUI
 * La fila "Pago de servicios Internacional" traia los montos de las planillas, que
 * dicen lo facturado y no lo pagado. El export dice lo que realmente salio. En los
 * meses que cubre el export, sus movimientos reemplazan a los del Excel; los meses
 * sin export conservan la proyeccion.
 *
 * Lo que se dejo de pagar no desaparece: vive como compromiso declarado
 * (scripts/compromisos-colaboradores.ts) en el mes en que se espera pagarlo.
 *
 * ENERO 2026 QUEDA PENDIENTE
 * Se transfirieron 1.633.482 a Global66 y no hay ninguna conversion en la cuenta
 * USD ese mes. Probablemente siguen en el monedero en pesos. Hasta confirmarlo, esa
 * transferencia se queda sin conciliar en vez de inventarle destino.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { parsearExportG66, esExportGlobal66 } from '../src/lib/global66/parser'
import { repartirPorMes, hashMovimiento } from '../src/lib/global66/reparto'
import { MESES_CORTOS } from '../src/lib/dominio'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

const CARPETA = 'global66'
const CATEGORIA_INTERNACIONAL = 'Pago de servicios Internacional'
const CATEGORIA_COSTO = 'Global66 - costo y spread'
const GRUPO_COSTO = 'proveedores'
const ANIO = 2026

/** Meses en que la transferencia a Global66 no se explica con el export. */
const SIN_EXPLICAR: number[] = [1]

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  // ── 1. Leer los archivos ───────────────────────────────────────────────────
  const archivos = readdirSync(CARPETA).filter((f) => /\.xlsx?$/i.test(f))
  const movimientos = []
  for (const archivo of archivos) {
    const datos = readFileSync(path.join(CARPETA, archivo))
    if (!esExportGlobal66(datos)) {
      console.log(`  ${archivo}: no es un export de Global66, se omite`)
      continue
    }
    const e = parsearExportG66(datos, archivo)
    console.log(`  ${archivo}: ${e.movimientos.length} movimientos · ${e.periodo}`)
    movimientos.push(...e.movimientos.map((m, i) => ({ ...m, archivo, hash: hashMovimiento(m, archivo, i) })))
  }

  if (firme) {
    for (const m of movimientos) {
      await prisma.movimientoGlobal66.upsert({
        where: { hash: m.hash },
        create: {
          fecha: m.fecha,
          mes: m.mes,
          anio: m.anio,
          tipo: m.tipo,
          tipoOriginal: m.tipoOriginal,
          debitado: m.debitado,
          acreditado: m.acreditado,
          costoCambio: Math.round(m.costoCambio),
          tipoCambio: m.tipoCambio,
          tercero: m.tercero,
          idFees: m.idFees,
          idTransaccion: m.idTransaccion,
          comentario: m.comentario,
          archivoOrigen: m.archivo,
          hash: m.hash,
        },
        update: {},
      })
    }
    console.log(`\n  ${movimientos.length} movimientos guardados.`)
  }

  // ── 2. Repartir ────────────────────────────────────────────────────────────
  const reparto = repartirPorMes(movimientos.filter((m) => m.anio === ANIO))

  const categoria = await prisma.categoria.findFirst({ where: { nombre: CATEGORIA_INTERNACIONAL } })
  if (!categoria) throw new Error(`No existe "${CATEGORIA_INTERNACIONAL}".`)

  let catCosto = await prisma.categoria.findFirst({ where: { nombre: CATEGORIA_COSTO } })
  if (!catCosto) {
    console.log(`\n  Crear categoría "${CATEGORIA_COSTO}" en el grupo ${GRUPO_COSTO}`)
    if (firme) {
      const ultimo = await prisma.categoria.findFirst({
        where: { grupo: GRUPO_COSTO },
        orderBy: { orden: 'desc' },
      })
      catCosto = await prisma.categoria.create({
        data: {
          nombre: CATEGORIA_COSTO,
          grupo: GRUPO_COSTO,
          orden: (ultimo?.orden ?? 0) + 1,
          esManual: false,
          nota: 'Comisiones de envío (5 USD cada uno) y costo del tipo de cambio de Global66.',
        },
      })
    }
  }

  // Transferencias desde Santander, para cuadrar.
  const santander = await prisma.movimientoBancario.findMany({
    where: { anio: ANIO, descripcion: { contains: 'Japybrand SPA' } },
  })
  const porMesSantander = new Map<number, { total: number; ids: string[] }>()
  for (const s of santander) {
    const e = porMesSantander.get(s.mes) ?? { total: 0, ids: [] }
    e.total += -s.monto
    e.ids.push(s.id)
    porMesSantander.set(s.mes, e)
  }

  console.log('\nREPARTO')
  console.log('─'.repeat(84))
  let totalColab = 0
  let totalCosto = 0
  const faltantes = new Set<string>()

  for (const r of reparto) {
    const sant = porMesSantander.get(r.mes)?.total ?? 0
    const repartido = r.envios.reduce((a, e) => a + e.montoCLP, 0)
    const costo = r.comisionCLP + r.costoCambio
    const dif = sant - repartido - costo
    console.log(
      `\n${MESES_CORTOS[r.mes - 1]}  TC ${r.tipoCambio.toFixed(2)}   Santander ${fmt(sant)}   ` +
        `dif ${fmt(dif)}${Math.abs(dif) > 50_000 ? '  ← saldo USD que queda en la cuenta' : ''}`,
    )
    for (const e of r.envios) {
      if (!e.proveedor) faltantes.add(e.tercero)
      console.log(
        `     ${(e.proveedor ?? `SIN PROVEEDOR: ${e.tercero}`).padEnd(22)} USD ${e.usd.toFixed(2).padStart(8)}  ${fmt(e.montoCLP).padStart(11)}`,
      )
      totalColab += e.montoCLP
    }
    console.log(
      `     ${'costo Global66'.padEnd(22)} USD ${r.comisionUSD.toFixed(2).padStart(8)}  ${fmt(costo).padStart(11)}` +
        `   (comisiones ${fmt(r.comisionCLP)} + cambio ${fmt(r.costoCambio)})`,
    )
    totalCosto += costo
  }

  console.log('\n' + '─'.repeat(84))
  console.log(`A colaboradores ${fmt(totalColab)}   ·   costo Global66 ${fmt(totalCosto)}`)
  if (faltantes.size > 0) {
    console.log(`\nSIN PROVEEDOR EN LA APP: ${[...faltantes].join(', ')}`)
  }
  for (const mes of SIN_EXPLICAR) {
    const s = porMesSantander.get(mes)?.total ?? 0
    if (s > 0) {
      console.log(
        `\nPENDIENTE · ${MESES_CORTOS[mes - 1]}: ${fmt(s)} transferidos sin ninguna conversión ` +
          `en la cuenta USD. Probablemente en el monedero en pesos. Queda sin conciliar.`,
      )
    }
  }

  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito.')
    return
  }

  // ── 3. Escribir los movimientos del flujo ──────────────────────────────────
  const mesesConExport = reparto.map((r) => r.mes)

  // El export reemplaza a la planilla en los meses que cubre.
  const borrados = await prisma.movimiento.deleteMany({
    where: { categoriaId: categoria.id, anio: ANIO, mes: { in: mesesConExport }, fuente: 'excel' },
  })
  console.log(`\n  ${borrados.count} movimientos del Excel reemplazados por el export.`)

  let creados = 0
  for (const r of reparto) {
    for (const [i, e] of r.envios.entries()) {
      if (!e.proveedor) continue
      const proveedor = await prisma.proveedor.findFirst({ where: { nombre: e.proveedor } })
      if (!proveedor) continue
      const idExterno = `g66:${ANIO}-${r.mes}:${proveedor.id}:${i}`
      await prisma.movimiento.upsert({
        where: { idExterno },
        create: {
          fecha: new Date(Date.UTC(ANIO, r.mes - 1, 5, 12)),
          mes: r.mes,
          anio: ANIO,
          montoCLP: e.montoCLP,
          monedaOriginal: 'USD',
          montoOriginal: e.usd,
          proveedorId: proveedor.id,
          categoriaId: categoria.id,
          descripcion: `${e.usd} USD vía Global66 a ${r.tipoCambio.toFixed(2)}`,
          fuente: 'global66',
          idExterno,
          estado: 'confirmado',
        },
        update: { montoCLP: e.montoCLP, montoOriginal: e.usd },
      })
      creados += 1
    }

    if (catCosto) {
      const costo = r.comisionCLP + r.costoCambio
      const idExterno = `g66-costo:${ANIO}-${r.mes}`
      if (costo > 0) {
        await prisma.movimiento.upsert({
          where: { idExterno },
          create: {
            fecha: new Date(Date.UTC(ANIO, r.mes - 1, 5, 12)),
            mes: r.mes,
            anio: ANIO,
            montoCLP: costo,
            monedaOriginal: 'CLP',
            proveedorId: null,
            categoriaId: catCosto.id,
            descripcion: `${r.comisionUSD} USD de comisiones y ${fmt(r.costoCambio)} de spread`,
            fuente: 'global66',
            idExterno,
            estado: 'confirmado',
          },
          update: { montoCLP: costo },
        })
        creados += 1
      }
    }
  }
  console.log(`  ${creados} movimientos creados desde el export.`)

  // Las transferencias de Santander quedan explicadas, salvo las de enero.
  for (const [mes, e] of porMesSantander) {
    if (SIN_EXPLICAR.includes(mes)) continue
    await prisma.movimientoBancario.updateMany({
      where: { id: { in: e.ids } },
      data: {
        estadoConciliacion: 'conciliado',
        viaConciliacion: 'manual',
        notaConciliacion: 'transferencia a Global66, repartida entre colaboradores según su export',
      },
    })
  }

  const quedan = await prisma.movimientoBancario.count({
    where: { estadoConciliacion: 'sin_conciliar' },
  })
  console.log(`\nLISTO. Bandeja: ${quedan}`)
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
