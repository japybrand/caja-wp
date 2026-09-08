/**
 * Reporte de diferencias entre la cartola de Banco Santander y lo que la app tiene hoy.
 *
 *   npm run reporte-banco
 *
 * NO ESCRIBE NADA EN LA BASE. Solo lee las cartolas de cartolas/, las compara contra
 * los movimientos existentes y deja el detalle completo en un archivo aparte.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { leerCarpeta, type Cartola, type MovimientoCartola } from '../src/lib/banco/parser'
import { nucleoGlosa, buscarProveedor, normalizarTexto } from '../src/lib/banco/glosa'
import { MESES_CORTOS, NUMEROS_MES } from '../src/lib/dominio'

const prisma = new PrismaClient()
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARPETA = path.join(RAIZ, 'cartolas')
const SALIDA = path.join(RAIZ, 'cartolas', 'reporte-detalle.txt')
const ANIO = 2026

const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)
const izq = (t: string, a: number): string => (t.length > a ? t.slice(0, a - 1) + '…' : t.padEnd(a))
const der = (t: string, a: number): string => (t.length > a ? t.slice(0, a) : t.padStart(a))
const linea = (n = 100): string => '─'.repeat(n)
const titulo = (t: string, n = 100): void => {
  console.log('\n' + '═'.repeat(n))
  console.log(t)
  console.log('═'.repeat(n))
}

/** Suma por mes, en un arreglo de 12 posiciones. */
const cero = (): number[] => Array<number>(12).fill(0)
const sumarEn = (a: number[], i: number, v: number): void => {
  if (i >= 0 && i < 12) a[i] = (a[i] ?? 0) + v
}

async function main(): Promise<void> {
  const cartolas = await leerCarpeta(CARPETA)
  const movimientos: MovimientoCartola[] = cartolas.flatMap((c) => c.movimientos)

  // ---------------------------------------------------------------- 1. cuadratura
  titulo('1. LAS CARTOLAS CUADRAN CONSIGO MISMAS')
  console.log(
    izq('Archivo', 30) + ' │ ' + izq('Hoja', 24) + ' │ ' + der('Mov.', 5) + ' │ ' +
      der('Cargos', 14) + ' │ ' + der('Abonos', 14) + ' │ ' + der('Δ', 6),
  )
  console.log(linea(108))
  let hayDescuadre = false
  for (const c of cartolas) {
    if (!c.cuadra) hayDescuadre = true
    console.log(
      izq(c.archivo.replace(/-\d+-\d+\.xlsx$/, ''), 30) + ' │ ' + izq(c.hoja, 24) + ' │ ' +
        der(String(c.movimientos.length), 5) + ' │ ' + der(fmt(c.cargos), 14) + ' │ ' +
        der(fmt(c.abonos), 14) + ' │ ' + der(c.cuadra ? 'OK' : `${fmt(c.difCargos)}/${fmt(c.difAbonos)}`, 6),
    )
  }
  const primera = cartolas[0]
  const ultima = cartolas[cartolas.length - 1]
  console.log(linea(108))
  console.log(
    `  ${movimientos.length} movimientos · saldo inicial ${fmt(primera?.saldoInicial ?? 0)} → saldo final ${fmt(ultima?.saldoFinal ?? 0)}`,
  )
  // La cadena de saldos: el final de un mes tiene que ser el inicial del siguiente.
  const saltos: string[] = []
  for (let i = 1; i < cartolas.length; i += 1) {
    const anterior = cartolas[i - 1]
    const actual = cartolas[i]
    if (anterior && actual && anterior.saldoFinal !== actual.saldoInicial) {
      saltos.push(`${anterior.archivo.slice(0, 12)} → ${actual.archivo.slice(0, 12)}`)
    }
  }
  console.log(
    saltos.length === 0
      ? '  La cadena de saldos encadena sin saltos en los nueve meses.'
      : `  ¡OJO! La cadena de saldos se corta en: ${saltos.join(', ')}`,
  )
  if (hayDescuadre) console.log('  ¡OJO! Hay meses cuyos movimientos no cuadran con la cabecera.')

  const comisiones = cartolas.flatMap((c) => c.comisiones)
  console.log(
    `  Excluidas ${comisiones.length} filas del bloque "Resumen comisiones" (${fmt(
      comisiones.reduce((a, x) => a + x.monto, 0),
    )} en total): son de centavos y no están en el resumen de saldos.`,
  )

  // ------------------------------------------------------- 2. banco contra la app
  const [categorias, movsApp, ventas] = await Promise.all([
    prisma.categoria.findMany(),
    prisma.movimiento.findMany({
      where: { anio: ANIO },
      include: { categoria: { select: { nombre: true, grupo: true } }, proveedor: { select: { nombre: true } } },
    }),
    prisma.valorManual.findMany({
      where: { anio: ANIO, categoria: { nombre: 'Ventas del mes' } },
    }),
  ])

  const cargosBanco = cero()
  const abonosBanco = cero()
  /** Meses que la cartola realmente cubre: comparar contra los demás no dice nada. */
  const mesesConCartola = new Set<number>()
  for (const m of movimientos) {
    if (m.anio !== ANIO) continue
    mesesConCartola.add(m.mes)
    if (m.monto < 0) sumarEn(cargosBanco, m.mes - 1, m.monto)
    else sumarEn(abonosBanco, m.mes - 1, m.monto)
  }

  // Egresos de la app: colaboradores + proveedores + retiros (lo que sale por banco).
  const GRUPOS_EGRESO = ['colaboradores', 'proveedores', 'retiros']
  const egresosApp = cero()
  for (const m of movsApp) {
    if (!GRUPOS_EGRESO.includes(m.categoria.grupo)) continue
    if (m.estado !== 'confirmado') continue
    sumarEn(egresosApp, m.mes - 1, m.montoCLP)
  }

  const ventasApp = cero()
  for (const v of ventas) sumarEn(ventasApp, v.mes - 1, v.montoCLP)

  titulo('2. CARGOS DEL BANCO CONTRA LOS EGRESOS DE LA APP')
  console.log(
    `Meses cubiertos por la cartola: ${[...mesesConCartola]
      .sort((a, b) => a - b)
      .map((m) => MESES_CORTOS[m - 1])
      .join(' ')}. Los demás no se comparan.
`,
  )
  console.log(
    izq('Mes', 6) + ' │ ' + der('Cargos banco', 14) + ' │ ' + der('Egresos app', 14) + ' │ ' +
      der('Brecha', 14) + ' │ ' + der('%', 7),
  )
  console.log(linea(66))
  for (const mes of NUMEROS_MES) {
    const i = mes - 1
    if (!mesesConCartola.has(mes)) continue
    const banco = Math.abs(cargosBanco[i] ?? 0)
    const app = egresosApp[i] ?? 0
    const brecha = banco - app
    const pct = banco === 0 ? 0 : (brecha / banco) * 100
    console.log(
      izq(MESES_CORTOS[i] ?? '', 6) + ' │ ' + der(fmt(banco), 14) + ' │ ' + der(fmt(app), 14) +
        ' │ ' + der(fmt(brecha), 14) + ' │ ' + der(pct.toFixed(1) + '%', 7),
    )
  }
  console.log(linea(66))
  const totBanco = cargosBanco.reduce((a, b) => a + Math.abs(b), 0)
  const totApp = NUMEROS_MES.filter((m) => mesesConCartola.has(m)).reduce(
    (a, m) => a + (egresosApp[m - 1] ?? 0),
    0,
  )
  console.log(
    izq('Total', 6) + ' │ ' + der(fmt(totBanco), 14) + ' │ ' + der(fmt(totApp), 14) + ' │ ' +
      der(fmt(totBanco - totApp), 14) + ' │ ' + der(((totBanco - totApp) / totBanco * 100).toFixed(1) + '%', 7),
  )
  console.log(
    '\n  La app solo tiene lo que el Excel cargó como proveedores, colaboradores y retiros.\n' +
      '  El banco además trae impuestos, deudas, tarjeta de crédito y gastos personales.',
  )

  // ------------------------------------------------------------ 3. abonos vs ventas
  titulo('3. ABONOS DEL BANCO CONTRA LAS VENTAS DE LA PLANILLA')
  console.log(
    izq('Mes', 6) + ' │ ' + der('Abonos banco', 14) + ' │ ' + der('Ventas planilla', 15) + ' │ ' +
      der('Diferencia', 14) + ' │ ' + der('%', 7),
  )
  console.log(linea(68))
  for (const mes of NUMEROS_MES) {
    const i = mes - 1
    if (!mesesConCartola.has(mes)) continue
    const banco = abonosBanco[i] ?? 0
    const app = ventasApp[i] ?? 0
    const dif = banco - app
    const pct = app === 0 ? 0 : (dif / app) * 100
    console.log(
      izq(MESES_CORTOS[i] ?? '', 6) + ' │ ' + der(fmt(banco), 14) + ' │ ' + der(fmt(app), 15) +
        ' │ ' + der(fmt(dif), 14) + ' │ ' + der(pct.toFixed(1) + '%', 7),
    )
  }

  // ----------------------------------------------- 4. nóminas vs retiros (MOLINA OVALLE)
  titulo('4. NÓMINAS CONTRA RETIROS: LA SEPARACIÓN DE MOLINA OVALLE')

  const molina = movimientos.filter((m) => normalizarTexto(m.descripcion).includes('MOLINA OVALLE'))
  const REMUNERACION = -1_500_000
  const RETIRO = -1_000_000

  const catNominas = categorias.find((c) => c.nombre === 'Pago de nóminas')
  const catRetiros = categorias.find((c) => c.nombre === 'Retiros')
  const nominasHoy = cero()
  const retirosHoy = cero()
  for (const m of movsApp) {
    if (m.categoriaId === catNominas?.id) sumarEn(nominasHoy, m.mes - 1, m.montoCLP)
    if (m.categoriaId === catRetiros?.id) sumarEn(retirosHoy, m.mes - 1, m.montoCLP)
  }

  // Lo que dice el banco, aplicando la regla: 1.500.000 -> nóminas, el resto -> retiros.
  const nominasBanco = cero()
  const retirosBanco = cero()
  const sinRegla: MovimientoCartola[] = []
  for (const m of molina) {
    const i = m.mes - 1
    if (m.monto === REMUNERACION) sumarEn(nominasBanco, i, Math.abs(m.monto))
    else if (m.monto === RETIRO) sumarEn(retirosBanco, i, Math.abs(m.monto))
    else {
      sumarEn(retirosBanco, i, Math.abs(m.monto))
      sinRegla.push(m)
    }
  }

  console.log(
    izq('Mes', 6) + ' │ ' + der('Nóminas hoy', 13) + ' │ ' + der('Nóminas banco', 14) + ' │ ' +
      der('Retiros hoy', 13) + ' │ ' + der('Retiros banco', 14) + ' │ ' + der('MOLINA', 8),
  )
  console.log(linea(88))
  for (const mes of NUMEROS_MES) {
    const i = mes - 1
    if (!mesesConCartola.has(mes)) continue
    const nh = nominasHoy[i] ?? 0
    const nb = nominasBanco[i] ?? 0
    const rh = retirosHoy[i] ?? 0
    const rb = retirosBanco[i] ?? 0
    const cuantos = molina.filter((m) => m.mes === mes).length
    console.log(
      izq(MESES_CORTOS[i] ?? '', 6) + ' │ ' + der(fmt(nh), 13) + ' │ ' + der(fmt(nb), 14) + ' │ ' +
        der(fmt(rh), 13) + ' │ ' + der(fmt(rb), 14) + ' │ ' + der(`${cuantos} mov`, 8),
    )
  }
  console.log(linea(88))
  const soloConCartola = (a: number[]): number =>
    NUMEROS_MES.filter((m) => mesesConCartola.has(m)).reduce((s2, m) => s2 + (a[m - 1] ?? 0), 0)
  console.log(
    izq('Total', 6) + ' │ ' + der(fmt(soloConCartola(nominasHoy)), 13) + ' │ ' +
      der(fmt(soloConCartola(nominasBanco)), 14) + ' │ ' +
      der(fmt(soloConCartola(retirosHoy)), 13) + ' │ ' +
      der(fmt(soloConCartola(retirosBanco)), 14) + ' │ ' + der(`${molina.length} mov`, 8),
  )

  console.log(`\n  Transferencias a MOLINA OVALLE que NO calzan con 1.500.000 ni 1.000.000 (${sinRegla.length}):`)
  console.log('  Quedarían sin conciliar para que las resuelvas a mano.\n')
  console.log('    ' + izq('Fecha', 12) + der('Monto', 13) + '   Comentario')
  console.log('    ' + linea(70))
  for (const m of sinRegla.sort((a, b) => a.fecha.getTime() - b.fecha.getTime())) {
    let nota = ''
    if (m.monto === -2_500_000) nota = 'los dos conceptos en un solo cargo: 1.500.000 + 1.000.000'
    else if (m.monto === -987_018) nota = 'retiro del mes; el Excel trae 2.487.018 = 1.500.000 + 987.018'
    else if (Math.abs(m.monto) >= 300_000) nota = 'monto grande, revisar'
    console.log(
      '    ' + izq(m.fecha.toISOString().slice(0, 10), 12) + der(fmt(m.monto), 13) + '   ' + nota,
    )
  }

  // ------------------------------------------------------------- 5. Global66
  titulo('5. TRANSFERENCIAS A GLOBAL66')
  const CLAVES_G66 = ['GLOBAL66', 'GLOBAL 66', 'GLOBAL']
  const g66 = movimientos.filter((m) => {
    const t = normalizarTexto(m.descripcion)
    return CLAVES_G66.some((k) => t.includes(k))
  })
  if (g66.length === 0) {
    console.log('  Ninguna glosa menciona Global66.')
    console.log('  Las transferencias al exterior deben estar bajo otra glosa: revisar los cargos')
    console.log('  grandes sin proveedor de la sección 6, o buscar por el monto de los pagos previstos.')
    // Pista: cargos que se parezcan a los pagos internacionales del Excel.
    const catIntl = categorias.find((c) => c.nombre === 'Pago de servicios Internacional')
    const intl = movsApp.filter((m) => m.categoriaId === catIntl?.id && m.estado === 'confirmado')
    const porMesIntl = cero()
    for (const m of intl) sumarEn(porMesIntl, m.mes - 1, m.montoCLP)
    console.log('\n  Referencia: lo que el Excel dice que se pagó al exterior cada mes,')
    console.log('  para que puedas buscar el cargo equivalente en la cartola.\n')
    console.log('    ' + izq('Mes', 6) + der('Internacional app', 18) + '   Cargos del banco de monto parecido (±3%)')
    console.log('    ' + linea(90))
    for (const mes of NUMEROS_MES) {
      const objetivo = porMesIntl[mes - 1] ?? 0
      if (objetivo === 0) continue
      const parecidos = movimientos.filter(
        (m) => m.mes === mes && m.monto < 0 && Math.abs(Math.abs(m.monto) - objetivo) / objetivo <= 0.03,
      )
      console.log(
        '    ' + izq(MESES_CORTOS[mes - 1] ?? '', 6) + der(fmt(objetivo), 18) + '   ' +
          (parecidos.map((p) => `${fmt(p.monto)} ${nucleoGlosa(p.descripcion).slice(0, 22)}`).join(' · ') || '—'),
      )
    }
  } else {
    console.log(`  ${g66.length} movimientos, ${fmt(g66.reduce((a, m) => a + m.monto, 0))} en total.`)
    for (const m of g66) {
      console.log(`    ${m.fecha.toISOString().slice(0, 10)} ${der(fmt(m.monto), 13)}  ${m.descripcion}`)
    }
  }

  // -------------------------------------- 6. cargos agrupados por glosa, sin proveedor
  const proveedores = await prisma.proveedor.findMany({ include: { categoria: true } })
  const conAlias = proveedores.map((p) => ({ ...p, alias: [] as string[] }))

  interface Grupo {
    glosa: string
    nucleo: string
    veces: number
    total: number
    meses: Set<number>
    proveedor: string | null
    via: string
  }
  const grupos = new Map<string, Grupo>()
  for (const m of movimientos) {
    if (m.monto >= 0) continue
    const clave = m.descripcion
    let g = grupos.get(clave)
    if (!g) {
      const calce = buscarProveedor(m.descripcion, conAlias)
      g = {
        glosa: m.descripcion,
        nucleo: nucleoGlosa(m.descripcion),
        veces: 0,
        total: 0,
        meses: new Set(),
        proveedor: calce?.proveedor.nombre ?? null,
        via: calce?.via ?? '',
      }
      grupos.set(clave, g)
    }
    g.veces += 1
    g.total += m.monto
    g.meses.add(m.mes)
  }

  const todos = [...grupos.values()].sort((a, b) => a.total - b.total)
  const identificados = todos.filter((g) => g.proveedor !== null)
  const sinProveedor = todos.filter((g) => g.proveedor === null)

  titulo('6. CARGOS AGRUPADOS POR GLOSA')
  console.log(
    `  ${todos.length} glosas distintas · ${identificados.length} calzan con un proveedor de la app · ` +
      `${sinProveedor.length} no calzan con ninguno`,
  )
  console.log(
    `  Identificados: ${fmt(identificados.reduce((a, g) => a + g.total, 0))} · ` +
      `sin proveedor: ${fmt(sinProveedor.reduce((a, g) => a + g.total, 0))}`,
  )

  console.log('\n  CANDIDATOS A PROVEEDOR NUEVO — recurrentes (3+ meses) y sin proveedor en la app:\n')
  console.log(
    '    ' + izq('Glosa del banco', 34) + der('Veces', 6) + der('Meses', 6) + der('Total', 14) + '  Núcleo',
  )
  console.log('    ' + linea(96))
  const candidatos = sinProveedor.filter((g) => g.meses.size >= 3)
  for (const g of candidatos) {
    console.log(
      '    ' + izq(g.glosa, 34) + der(String(g.veces), 6) + der(String(g.meses.size), 6) +
        der(fmt(g.total), 14) + '  ' + g.nucleo.slice(0, 24),
    )
  }
  console.log(
    `\n  ${candidatos.length} candidatos, ${fmt(candidatos.reduce((a, g) => a + g.total, 0))} en total.`,
  )

  console.log('\n  Los 20 cargos sueltos más grandes sin proveedor (menos de 3 meses):\n')
  console.log('    ' + izq('Glosa del banco', 40) + der('Veces', 6) + der('Total', 14))
  console.log('    ' + linea(62))
  for (const g of sinProveedor.filter((x) => x.meses.size < 3).slice(0, 20)) {
    console.log('    ' + izq(g.glosa, 40) + der(String(g.veces), 6) + der(fmt(g.total), 14))
  }

  console.log('\n  Glosas que SÍ calzan con un proveedor de la app:\n')
  console.log('    ' + izq('Glosa del banco', 34) + izq('→ Proveedor', 26) + der('Veces', 6) + der('Total', 14))
  console.log('    ' + linea(82))
  for (const g of identificados) {
    console.log(
      '    ' + izq(g.glosa, 34) + izq('→ ' + (g.proveedor ?? ''), 26) + der(String(g.veces), 6) + der(fmt(g.total), 14),
    )
  }

  // ------------------------------------------------------------ detalle a archivo
  const lineas: string[] = []
  lineas.push('DETALLE COMPLETO DE LOS MOVIMIENTOS DE LA CARTOLA')
  lineas.push(`Cuenta ${primera?.cuenta ?? ''} · Banco Santander · ${movimientos.length} movimientos`)
  lineas.push(`Generado el ${new Date().toISOString()}`)
  lineas.push('')
  lineas.push(
    ['FECHA', 'TIPO', 'MONTO', 'DESCRIPCION', 'NUCLEO', 'PROVEEDOR APP', 'N_DOCUMENTO', 'SUCURSAL', 'ARCHIVO'].join('\t'),
  )
  for (const c of cartolas) {
    for (const m of c.movimientos) {
      const calce = buscarProveedor(m.descripcion, conAlias)
      lineas.push(
        [
          m.fecha.toISOString().slice(0, 10),
          m.tipo,
          String(m.monto),
          m.descripcion,
          nucleoGlosa(m.descripcion),
          calce?.proveedor.nombre ?? '',
          m.nDocumento,
          m.sucursal,
          c.archivo,
        ].join('\t'),
      )
    }
  }
  writeFileSync(SALIDA, lineas.join('\n'), 'utf8')

  titulo('LISTO')
  console.log(`  Detalle completo (${movimientos.length} filas, separado por tabulaciones) en:`)
  console.log(`    ${path.relative(RAIZ, SALIDA)}`)
  console.log('\n  No se escribió nada en la base de datos.')
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
