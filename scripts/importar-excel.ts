/**
 * Importa "Flujo de Caja 2026 - Japybrand WP.xlsx" a la base de datos.
 *
 *   npm run importar
 *
 * Es idempotente: cada movimiento lleva un idExterno derivado de su celda de origen,
 * asi que correrlo dos veces actualiza en vez de duplicar. Al terminar imprime el
 * resumen de carga y la cuadratura mes a mes contra el Excel.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { PrismaClient } from '@prisma/client'
import { CATEGORIAS } from '../src/lib/catalogo'
import { MESES_CORTOS, NUMEROS_MES } from '../src/lib/dominio'

const prisma = new PrismaClient()

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARCHIVO = path.join(RAIZ, 'Flujo_de_Caja_2026_-_Japybrand_WP.xlsx')
const ANIO = 2026

/** Columnas C..N del Excel son enero..diciembre. */
const COLUMNA_ENERO = 3
const columnaDeMes = (mes: number): number => COLUMNA_ENERO + mes - 1

// ---------------------------------------------------------------------------
// Mapa del Excel
// ---------------------------------------------------------------------------

/** Rangos de filas de la hoja Proveedores, tal como los suman las filas 33-38 del flujo. */
const RANGOS_PROVEEDORES: { categoria: string; desde: number; hasta: number }[] = [
  { categoria: 'Cloud', desde: 3, hasta: 11 }, //              flujo!C33 = SUM(Proveedores!C3:C11)
  { categoria: 'Sistema comercial', desde: 12, hasta: 24 }, //  flujo!C34 = SUM(C12:C24)
  { categoria: 'AI apps', desde: 25, hasta: 29 }, //            flujo!C35 = SUM(C25:C29)
  { categoria: 'Proveedores nacional', desde: 30, hasta: 33 }, //flujo!C36 = SUM(C30:C33)
  { categoria: 'Marketing digital', desde: 34, hasta: 40 }, //  flujo!C37 = SUM(C34:C40)
  { categoria: 'Bancos', desde: 41, hasta: 43 }, //             flujo!C38 = SUM(C41:C43)
]

/**
 * Filas que se reclasifican a otra categoria de la que les toca por su rango.
 * Xepelin (Proveedores!16) es la comision por adelanto de facturas: es factoring,
 * no una suscripcion del sistema comercial.
 */
const RECLASIFICACIONES: Record<number, string> = { 16: 'Factoring' }

/** Hojas de colaboradores: nombre de hoja, categoria del flujo y rango de filas. */
const HOJAS_COLABORADORES: {
  hoja: string
  categoria: string
  desde: number
  hasta: number
  filaTotal: number
  omitir: number[]
}[] = [
  {
    hoja: 'Pagos Remuneraciones',
    categoria: 'Pago de nóminas',
    desde: 3,
    hasta: 8,
    filaTotal: 9,
    omitir: [],
  },
  {
    hoja: 'Pagos Honorarios',
    categoria: 'Pago de servicios a honorarios',
    desde: 3,
    hasta: 9,
    filaTotal: 10,
    // La fila 8 no tiene nombre. Sus 328.446 de mayo NO son un error, como se creyo
    // en la fase 1: son el pago a Damian Moreno, colaborador a honorarios que se
    // fue. Se sigue omitiendo aqui porque el mismo monto entra desde la cartola con
    // su nombre; importarla ademas lo contaria dos veces.
    omitir: [8],
  },
  {
    hoja: 'Pagos Internacional',
    categoria: 'Pago de servicios Internacional',
    desde: 3,
    hasta: 8,
    filaTotal: 9,
    omitir: [],
  },
]

/** Hoja Retiros: filas sin nombre, se cargan como movimientos sueltos sin proveedor. */
const HOJA_RETIROS = { hoja: 'Retiros', categoria: 'Retiros', desde: 3, hasta: 10, filaTotal: 11 }

/** Filas manuales del flujo: fila del Excel -> categoria. */
const FILAS_MANUALES: { fila: number; categoria: string }[] = [
  { fila: 11, categoria: 'Ventas del mes' },
  { fila: 18, categoria: 'Línea de crédito Fogape Maxxa' },
  { fila: 19, categoria: 'Xepelin' },
  { fila: 46, categoria: 'Pago de cotizaciones Previred' },
  { fila: 47, categoria: 'Pago de impuestos IVA' },
  { fila: 48, categoria: 'Pago de giros' },
  { fila: 49, categoria: 'Previred pagos postergados' },
  { fila: 50, categoria: 'Santander Pagos TGR' },
  { fila: 60, categoria: 'Inmotion - acuerdo de pago' },
  { fila: 61, categoria: 'Fogape - cuotas' },
  { fila: 62, categoria: 'TGR pie inicial' },
  { fila: 63, categoria: 'TGR convenio' },
  { fila: 64, categoria: 'RC Ingeniería - acuerdo de pago' },
]

/** Fila 8 del flujo. En el Excel enero es un 0 fijo. */
const FILA_SALDO_INICIAL = 8

/** Filas calculadas del flujo, para la cuadratura. */
const FILAS_CUADRATURA: { clave: string; etiqueta: string; fila: number }[] = [
  { clave: 'total_ingresos', etiqueta: 'Total Ingresos', fila: 14 },
  { clave: 'total_financiamiento', etiqueta: 'Total Financiamiento', fila: 21 },
  { clave: 'cat:Pago de nóminas', etiqueta: 'Pago de nóminas', fila: 25 },
  { clave: 'cat:Pago de servicios a honorarios', etiqueta: 'Pago de servicios a honorarios', fila: 26 },
  { clave: 'cat:Pago de servicios Internacional', etiqueta: 'Pago de servicios Internacional', fila: 27 },
  { clave: 'total_colaboradores', etiqueta: 'Total Egresos (colaboradores)', fila: 29 },
  { clave: 'cat:Cloud', etiqueta: 'Cloud', fila: 33 },
  { clave: 'cat:Sistema comercial', etiqueta: 'Sistema comercial', fila: 34 },
  { clave: 'cat:AI apps', etiqueta: 'AI apps', fila: 35 },
  { clave: 'cat:Proveedores nacional', etiqueta: 'Proveedores nacional', fila: 36 },
  { clave: 'cat:Marketing digital', etiqueta: 'Marketing digital', fila: 37 },
  { clave: 'cat:Bancos', etiqueta: 'Bancos', fila: 38 },
  { clave: 'total_proveedores', etiqueta: 'Total Egresos (proveedores)', fila: 40 },
  { clave: 'resultado', etiqueta: 'Resultado antes de impuestos', fila: 42 },
  { clave: 'total_impuestos', etiqueta: 'Total Impuestos', fila: 52 },
  { clave: 'cat:Retiros', etiqueta: 'Retiros', fila: 54 },
  { clave: 'economico', etiqueta: 'Flujo de caja económico', fila: 56 },
  { clave: 'total_deudas', etiqueta: 'Total Deudas', fila: 66 },
  { clave: 'financiero', etiqueta: 'Flujo de caja financiero', fila: 68 },
]

// ---------------------------------------------------------------------------
// Diferencias acordadas con Japybrand WP
// ---------------------------------------------------------------------------

/**
 * Ajustes que la app aplica a proposito y que por lo tanto el Excel no refleja.
 * `porMes` es el delta que se le suma al valor del Excel para llegar al de la app,
 * expresado en la fila indicada. La cuadratura los descuenta automaticamente.
 */
interface DiferenciaAcordada {
  motivo: string
  /** Clave de fila afectada, o 'cascada' si arrastra el saldo de los meses siguientes. */
  claves: string[]
  /** mes (1-12) -> delta aplicado a la fila. */
  porMes: Record<number, number>
  /** Si es true, el delta arrastra hacia adelante en las filas de resultado y saldo. */
  arrastra: boolean
}

const DIFERENCIAS: DiferenciaAcordada[] = [
  {
    motivo:
      'Honorarios de enero (199.000 de Macarena Paredes): el Excel no los arrastra al flujo, la app sí. Enero queda incompleto hasta que la fase 2 lo complete desde Gmail.',
    claves: ['cat:Pago de servicios a honorarios', 'total_colaboradores'],
    porMes: { 1: 199_000 },
    arrastra: true,
  },
  {
    motivo:
      'Xepelin (193.780 en septiembre) se mueve de "Sistema comercial" a la nueva categoría "Factoring". No cambia ningún total.',
    claves: ['cat:Sistema comercial'],
    porMes: { 9: -193_780 },
    arrastra: false,
  },
]

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Devuelve el numero de una celda, resolviendo formulas por su valor en cache. */
function numeroDe(celda: ExcelJS.Cell | undefined): number {
  if (!celda) return 0
  const valor: unknown = celda.value
  if (valor === null || valor === undefined) return 0
  if (typeof valor === 'number') return Math.round(valor)
  if (typeof valor === 'object') {
    const objeto = valor as { result?: unknown; error?: unknown }
    if (typeof objeto.result === 'number') return Math.round(objeto.result)
  }
  if (typeof valor === 'string') {
    const limpio = valor.replace(/[^\d.-]/g, '')
    const n = Number(limpio)
    return Number.isFinite(n) ? Math.round(n) : 0
  }
  return 0
}

function textoDe(celda: ExcelJS.Cell | undefined): string {
  if (!celda) return ''
  const valor: unknown = celda.value
  if (typeof valor === 'string') return valor.trim()
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'object') {
    const objeto = valor as { result?: unknown; richText?: { text: string }[] }
    if (Array.isArray(objeto.richText)) return objeto.richText.map((t) => t.text).join('').trim()
    if (typeof objeto.result === 'string') return objeto.result.trim()
  }
  return String(valor).trim()
}

const alinear = (texto: string, ancho: number): string =>
  texto.length > ancho ? texto.slice(0, ancho - 1) + '…' : texto.padEnd(ancho)

const fmt = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)

const derecha = (texto: string, ancho: number): string =>
  texto.length > ancho ? texto.slice(0, ancho) : texto.padStart(ancho)

/** Suma en sitio sobre un arreglo de 12 posiciones, tolerando el indice fuera de rango. */
const sumarEn = (arreglo: number[], indice: number, delta: number): void => {
  if (indice < 0 || indice >= arreglo.length) return
  arreglo[indice] = (arreglo[indice] ?? 0) + delta
}

// ---------------------------------------------------------------------------
// Importacion
// ---------------------------------------------------------------------------

interface Resumen {
  categorias: number
  proveedoresCreados: number
  proveedoresExistentes: number
  movimientosCreados: number
  movimientosActualizados: number
  /** Movimientos que ya traen el monto real de la cartola y no se pisan. */
  protegidos: number
  valoresManuales: number
  /** Filas manuales que vienen de la cartola y el Excel no debe pisar. */
  valoresProtegidos: number
  omitidos: string[]
}

async function importar(): Promise<{ resumen: Resumen; libro: ExcelJS.Workbook }> {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.readFile(ARCHIVO)

  const resumen: Resumen = {
    categorias: 0,
    proveedoresCreados: 0,
    proveedoresExistentes: 0,
    movimientosCreados: 0,
    movimientosActualizados: 0,
    protegidos: 0,
    valoresManuales: 0,
    valoresProtegidos: 0,
    omitidos: [],
  }

  // --- 1. Categorias -------------------------------------------------------
  const categoriaPorNombre = new Map<string, string>()
  for (const definicion of CATEGORIAS) {
    const categoria = await prisma.categoria.upsert({
      where: { grupo_nombre: { grupo: definicion.grupo, nombre: definicion.nombre } },
      create: definicion,
      update: { orden: definicion.orden, esManual: definicion.esManual },
    })
    categoriaPorNombre.set(definicion.nombre, categoria.id)
    resumen.categorias += 1
  }

  const idCategoria = (nombre: string): string => {
    const id = categoriaPorNombre.get(nombre)
    if (!id) throw new Error(`Categoría no encontrada en el catálogo: ${nombre}`)
    return id
  }

  // --- 2. Proveedor + movimientos de una hoja con filas nombradas ----------
  const cargarHojaConNombres = async (opciones: {
    hoja: string
    categoriaPorFila: (fila: number) => string
    desde: number
    hasta: number
    omitir: number[]
  }): Promise<void> => {
    const hoja = libro.getWorksheet(opciones.hoja)
    if (!hoja) throw new Error(`No existe la hoja "${opciones.hoja}" en el archivo.`)

    for (let fila = opciones.desde; fila <= opciones.hasta; fila += 1) {
      const nombre = textoDe(hoja.getCell(fila, 2))
      if (opciones.omitir.includes(fila)) {
        if (nombre !== '' || NUMEROS_MES.some((m) => numeroDe(hoja.getCell(fila, columnaDeMes(m))) > 0)) {
          resumen.omitidos.push(`${opciones.hoja}!${fila} (omitida por acuerdo)`)
        }
        continue
      }
      if (nombre === '') {
        const tieneMontos = NUMEROS_MES.some((m) => numeroDe(hoja.getCell(fila, columnaDeMes(m))) > 0)
        if (tieneMontos) resumen.omitidos.push(`${opciones.hoja}!${fila} (sin nombre, con montos)`)
        continue
      }

      const nombreCategoria = opciones.categoriaPorFila(fila)
      const categoriaId = idCategoria(nombreCategoria)

      const existente = await prisma.proveedor.findUnique({
        where: { categoriaId_nombre: { categoriaId, nombre } },
      })
      const proveedor = await prisma.proveedor.upsert({
        where: { categoriaId_nombre: { categoriaId, nombre } },
        create: { nombre, categoriaId, orden: fila },
        update: { orden: fila },
      })
      if (existente) resumen.proveedoresExistentes += 1
      else resumen.proveedoresCreados += 1

      for (const mes of NUMEROS_MES) {
        const monto = numeroDe(hoja.getCell(fila, columnaDeMes(mes)))
        const idExterno = `excel:${opciones.hoja}:${fila}:${ANIO}-${String(mes).padStart(2, '0')}`

        if (monto <= 0) {
          // Si antes existia y ahora quedo en cero o negativo, se limpia.
          await prisma.movimiento.deleteMany({ where: { idExterno } })
          continue
        }

        const previo = await prisma.movimiento.findUnique({ where: { idExterno } })

        // Un movimiento que ya se reemplazo por el monto real de la cartola NO se
        // pisa con la proyeccion del Excel. Los montos del Excel eran una proyeccion
        // anual; la cartola es lo que efectivamente paso por la cuenta.
        if (previo?.fuente === 'cartola') {
          resumen.protegidos += 1
          continue
        }

        // Cuando el export de Global66 cubre un mes, ese mes le pertenece ENTERO:
        // el export es el registro completo de los pagos internacionales, asi que si
        // un colaborador no aparece es porque no cobro, no porque falte el dato.
        //
        // Por eso el guardia mira la categoria y el mes, no el proveedor. Protegiendo
        // solo por proveedor, junio y julio volvian a traer del Excel a Juan Pablo y
        // a Fernando Vela, a quienes justamente no se les pago esos meses.
        //
        // No se generaliza a la cartola: ahi un cargo identificado no dice nada sobre
        // los demas proveedores del mes, y bloquear la celda entera borraria gastos
        // reales que solo estan en la planilla.
        const delExport = await prisma.movimiento.findFirst({
          where: { categoriaId, anio: ANIO, mes, fuente: 'global66' },
        })
        if (delExport) {
          resumen.protegidos += 1
          continue
        }

        await prisma.movimiento.upsert({
          where: { idExterno },
          create: {
            fecha: new Date(Date.UTC(ANIO, mes - 1, 1)),
            mes,
            anio: ANIO,
            montoCLP: monto,
            monedaOriginal: 'CLP',
            proveedorId: proveedor.id,
            categoriaId,
            descripcion: nombre,
            fuente: 'excel',
            idExterno,
            estado: 'confirmado',
          },
          update: { montoCLP: monto, categoriaId, proveedorId: proveedor.id, descripcion: nombre },
        })
        if (previo) resumen.movimientosActualizados += 1
        else resumen.movimientosCreados += 1
      }
    }
  }

  // Hoja Proveedores
  await cargarHojaConNombres({
    hoja: 'Proveedores',
    desde: 3,
    hasta: 43,
    omitir: [],
    categoriaPorFila: (fila) => {
      const reclasificada = RECLASIFICACIONES[fila]
      if (reclasificada) return reclasificada
      const rango = RANGOS_PROVEEDORES.find((r) => fila >= r.desde && fila <= r.hasta)
      if (!rango) throw new Error(`La fila Proveedores!${fila} no cae en ningún rango conocido.`)
      return rango.categoria
    },
  })

  // Hojas de colaboradores
  for (const hoja of HOJAS_COLABORADORES) {
    await cargarHojaConNombres({
      hoja: hoja.hoja,
      desde: hoja.desde,
      hasta: hoja.hasta,
      omitir: hoja.omitir,
      categoriaPorFila: () => hoja.categoria,
    })
  }

  // --- 3. Retiros: filas sin nombre, sin proveedor -------------------------
  const hojaRetiros = libro.getWorksheet(HOJA_RETIROS.hoja)
  if (!hojaRetiros) throw new Error('No existe la hoja "Retiros".')
  const categoriaRetiros = idCategoria(HOJA_RETIROS.categoria)

  for (let fila = HOJA_RETIROS.desde; fila <= HOJA_RETIROS.hasta; fila += 1) {
    const etiqueta = textoDe(hojaRetiros.getCell(fila, 2))
    for (const mes of NUMEROS_MES) {
      const monto = numeroDe(hojaRetiros.getCell(fila, columnaDeMes(mes)))
      const idExterno = `excel:Retiros:${fila}:${ANIO}-${String(mes).padStart(2, '0')}`

      if (monto <= 0) {
        await prisma.movimiento.deleteMany({ where: { idExterno } })
        continue
      }

      const descripcion = etiqueta === '' ? `Retiro (fila ${fila} del Excel)` : etiqueta
      const previo = await prisma.movimiento.findUnique({ where: { idExterno } })
      await prisma.movimiento.upsert({
        where: { idExterno },
        create: {
          fecha: new Date(Date.UTC(ANIO, mes - 1, 1)),
          mes,
          anio: ANIO,
          montoCLP: monto,
          monedaOriginal: 'CLP',
          proveedorId: null,
          categoriaId: categoriaRetiros,
          descripcion,
          fuente: 'excel',
          idExterno,
          estado: 'confirmado',
        },
        update: { montoCLP: monto, categoriaId: categoriaRetiros },
      })
      if (previo) resumen.movimientosActualizados += 1
      else resumen.movimientosCreados += 1
    }
  }

  // --- 4. Filas manuales del flujo ----------------------------------------
  const hojaFlujo = libro.getWorksheet('Flujo de Caja')
  if (!hojaFlujo) throw new Error('No existe la hoja "Flujo de Caja".')

  const manuales = [
    { fila: FILA_SALDO_INICIAL, categoria: 'Saldo Inicial', soloEnero: true },
    ...FILAS_MANUALES.map((f) => ({ ...f, soloEnero: false })),
  ]

  for (const manual of manuales) {
    const categoriaId = idCategoria(manual.categoria)
    for (const mes of NUMEROS_MES) {
      // El saldo inicial solo es dato de entrada en enero; el resto lo encadena la app.
      if (manual.soloEnero && mes !== 1) continue

      // Lo que vino del banco no se pisa. La planilla era una proyeccion; la cartola
      // es un hecho. Sin este guardia, reimportar el Excel deshace en silencio todo
      // lo corregido con la cartola.
      const existente = await prisma.valorManual.findUnique({
        where: { categoriaId_anio_mes: { categoriaId, anio: ANIO, mes } },
      })
      if (existente && existente.origen !== 'excel') {
        resumen.valoresProtegidos += 1
        continue
      }

      const monto = numeroDe(hojaFlujo.getCell(manual.fila, columnaDeMes(mes)))
      await prisma.valorManual.upsert({
        where: { categoriaId_anio_mes: { categoriaId, anio: ANIO, mes } },
        create: { categoriaId, anio: ANIO, mes, montoCLP: monto, origen: 'excel' },
        update: { montoCLP: monto },
      })
      resumen.valoresManuales += 1
    }
  }

  return { resumen, libro }
}

// ---------------------------------------------------------------------------
// Cuadratura
// ---------------------------------------------------------------------------

interface FilaApp {
  montos: number[]
}

/** Recalcula el flujo desde la base, con la misma logica que usa la pantalla /flujo. */
async function calcularDesdeBase(): Promise<Map<string, FilaApp>> {
  const categorias = await prisma.categoria.findMany()
  const valores = await prisma.valorManual.findMany({ where: { anio: ANIO } })
  const sumas = await prisma.movimiento.groupBy({
    by: ['categoriaId', 'mes'],
    where: { anio: ANIO },
    _sum: { montoCLP: true },
  })

  const cero = (): number[] => Array<number>(12).fill(0)
  const porCategoria = new Map<string, number[]>()
  const monto = (id: string): number[] => {
    let m = porCategoria.get(id)
    if (!m) {
      m = cero()
      porCategoria.set(id, m)
    }
    return m
  }

  for (const v of valores) sumarEn(monto(v.categoriaId), v.mes - 1, v.montoCLP)
  for (const s of sumas) sumarEn(monto(s.categoriaId), s.mes - 1, s._sum.montoCLP ?? 0)

  const grupoDe = (grupo: string): typeof categorias => categorias.filter((c) => c.grupo === grupo)
  const sumaGrupo = (grupo: string, i: number): number =>
    grupoDe(grupo).reduce((acc, c) => acc + (porCategoria.get(c.id)?.[i] ?? 0), 0)

  const filas = new Map<string, FilaApp>()
  const nuevo = (clave: string): number[] => {
    const m = cero()
    filas.set(clave, { montos: m })
    return m
  }

  const saldo = nuevo('saldo_inicial')
  const ingresos = nuevo('total_ingresos')
  const financiamiento = nuevo('total_financiamiento')
  const colaboradores = nuevo('total_colaboradores')
  const proveedores = nuevo('total_proveedores')
  const resultado = nuevo('resultado')
  const impuestos = nuevo('total_impuestos')
  const economico = nuevo('economico')
  const deudas = nuevo('total_deudas')
  const financiero = nuevo('financiero')

  for (const categoria of categorias) {
    const m = nuevo(`cat:${categoria.nombre}`)
    const origen = porCategoria.get(categoria.id) ?? cero()
    for (let i = 0; i < 12; i += 1) m[i] = origen[i] ?? 0
  }

  const categoriaSaldo = grupoDe('saldo_inicial')[0]
  const saldoEnero = categoriaSaldo ? (porCategoria.get(categoriaSaldo.id)?.[0] ?? 0) : 0

  for (let i = 0; i < 12; i += 1) {
    saldo[i] = i === 0 ? saldoEnero : (financiero[i - 1] ?? 0)
    ingresos[i] = sumaGrupo('ingresos', i)
    financiamiento[i] = sumaGrupo('financiamiento', i)
    colaboradores[i] = sumaGrupo('colaboradores', i)
    proveedores[i] = sumaGrupo('proveedores', i)
    resultado[i] =
      (saldo[i] ?? 0) + (ingresos[i] ?? 0) + (financiamiento[i] ?? 0) - (colaboradores[i] ?? 0) - (proveedores[i] ?? 0)
    impuestos[i] = sumaGrupo('impuestos', i)
    economico[i] = (resultado[i] ?? 0) - (impuestos[i] ?? 0) - sumaGrupo('retiros', i)
    deudas[i] = sumaGrupo('deudas', i)
    financiero[i] = (economico[i] ?? 0) - (deudas[i] ?? 0)
  }

  return filas
}

/**
 * Delta esperado app - Excel para cada fila y mes, derivado de DIFERENCIAS.
 * Las diferencias marcadas como `arrastra` corren hacia adelante en las filas
 * de resultado, flujo economico, flujo financiero y saldo inicial.
 */
function deltasEsperados(): Map<string, number[]> {
  const mapa = new Map<string, number[]>()
  const obtener = (clave: string): number[] => {
    let m = mapa.get(clave)
    if (!m) {
      m = Array<number>(12).fill(0)
      mapa.set(clave, m)
    }
    return m
  }

  for (const diferencia of DIFERENCIAS) {
    for (const [mesTexto, delta] of Object.entries(diferencia.porMes)) {
      const mes = Number(mesTexto)
      for (const clave of diferencia.claves) sumarEn(obtener(clave), mes - 1, delta)
      if (!diferencia.arrastra) continue

      // Un egreso mayor baja el resultado y el flujo del mes, y de todos los siguientes.
      // El saldo inicial recoge el arrastre recien desde el mes siguiente.
      for (let i = mes - 1; i < 12; i += 1) {
        if (i > mes - 1) sumarEn(obtener('saldo_inicial'), i, -delta)
        sumarEn(obtener('resultado'), i, -delta)
        sumarEn(obtener('economico'), i, -delta)
        sumarEn(obtener('financiero'), i, -delta)
      }
    }
  }
  return mapa
}

/**
 * Celdas (fila del flujo, mes) que ya no vienen del Excel y quedan fuera de la
 * comparación.
 *
 * La cuadratura nació en la fase 1, cuando la app debía replicar la planilla al
 * peso. Hoy la app incorpora a propósito lo que el Excel omitía: la cartola, el
 * Registro de Ventas y los calendarios de convenio. Comparar esas celdas contra el
 * Excel no detecta un error, solo repite una diferencia buscada, y esa señal
 * constante tapa los descuadres de verdad.
 *
 * Una celda sale de la comparación cuando su fila tiene, en ese mes, un ValorManual
 * con origen distinto de "excel" o algún Movimiento cuya fuente no sea el Excel. En
 * los subtotales basta con que una sola de sus categorías esté fuera: el total ya
 * no es comparable.
 */
async function celdasFueraDeComparacion(): Promise<Map<string, Set<number>>> {
  const fuera = new Map<string, Set<number>>()
  const marcar = (clave: string, mes: number): void => {
    const s = fuera.get(clave) ?? new Set<number>()
    s.add(mes)
    fuera.set(clave, s)
  }

  const categorias = await prisma.categoria.findMany()
  const porId = new Map(categorias.map((c) => [c.id, c]))

  /** Qué filas de la cuadratura se ven afectadas cuando cambia una categoría. */
  const clavesDe = (grupo: string, nombre: string): string[] => {
    const subtotal: Record<string, string[]> = {
      saldo_inicial: ['saldo_inicial'],
      ingresos: ['total_ingresos', 'resultado', 'economico', 'financiero'],
      financiamiento: ['total_financiamiento', 'resultado', 'economico', 'financiero'],
      colaboradores: ['total_colaboradores', 'resultado', 'economico', 'financiero'],
      proveedores: ['total_proveedores', 'resultado', 'economico', 'financiero'],
      impuestos: ['total_impuestos', 'economico', 'financiero'],
      retiros: ['economico', 'financiero'],
      deudas: ['total_deudas', 'financiero'],
    }
    return [`cat:${nombre}`, ...(subtotal[grupo] ?? [])]
  }

  for (const v of await prisma.valorManual.findMany({
    where: { anio: ANIO, origen: { not: 'excel' } },
  })) {
    const c = porId.get(v.categoriaId)
    if (!c) continue
    for (const clave of clavesDe(c.grupo, c.nombre)) marcar(clave, v.mes)
  }

  for (const m of await prisma.movimiento.groupBy({
    by: ['categoriaId', 'mes'],
    where: { anio: ANIO, fuente: { not: 'excel' } },
  })) {
    const c = porId.get(m.categoriaId)
    if (!c) continue
    for (const clave of clavesDe(c.grupo, c.nombre)) marcar(clave, m.mes)
  }

  // El saldo encadena: si un mes queda fuera, todos los siguientes lo arrastran.
  for (const clave of ['saldo_inicial', 'resultado', 'economico', 'financiero']) {
    const s = fuera.get(clave)
    if (!s || s.size === 0) continue
    const primero = Math.min(...s)
    for (let mes = primero; mes <= 12; mes += 1) marcar(clave, mes)
  }

  return fuera
}

async function cuadratura(libro: ExcelJS.Workbook, app: Map<string, FilaApp>): Promise<boolean> {
  const hoja = libro.getWorksheet('Flujo de Caja')
  if (!hoja) throw new Error('No existe la hoja "Flujo de Caja".')

  const deltas = deltasEsperados()
  const fuera = await celdasFueraDeComparacion()
  const todas = [{ clave: 'saldo_inicial', etiqueta: 'Saldo Inicial', fila: FILA_SALDO_INICIAL }, ...FILAS_CUADRATURA]
  let hayDescuadre = false
  let celdasFuera = 0

  console.log('\n' + '═'.repeat(112))
  console.log('CUADRATURA CONTRA EL EXCEL — solo las celdas que todavía vienen de la planilla')
  console.log('═'.repeat(112))
  console.log(
    'Las celdas alimentadas por la cartola, el Registro de Ventas o el calendario de convenios\n' +
      'quedan fuera de la comparación a propósito: ahí la app corrige al Excel, así que una\n' +
      'diferencia es lo esperado y no un error.',
  )
  console.log('─'.repeat(112))
  console.log(
    alinear('Fila', 32) +
      ' │ ' +
      derecha('Excel', 16) +
      ' │ ' +
      derecha('App', 16) +
      ' │ ' +
      derecha('Dif. explicada', 16) +
      ' │ ' +
      derecha('No explicada', 14),
  )
  console.log('─'.repeat(112))

  for (const definicion of todas) {
    const filaApp = app.get(definicion.clave)
    if (!filaApp) {
      console.log(`  (sin datos en la app para ${definicion.clave})`)
      hayDescuadre = true
      continue
    }
    const delta = deltas.get(definicion.clave) ?? Array<number>(12).fill(0)

    const excelAnio: number[] = []
    const appAnio: number[] = []
    const explicadaAnio: number[] = []
    const noExplicadaAnio: number[] = []

    const fueraDeLaFila = fuera.get(definicion.clave) ?? new Set<number>()

    for (const mes of NUMEROS_MES) {
      const i = mes - 1
      if (fueraDeLaFila.has(mes)) {
        celdasFuera += 1
        continue
      }
      const valorExcel = numeroDe(hoja.getCell(definicion.fila, columnaDeMes(mes)))
      const valorApp = filaApp.montos[i] ?? 0
      const explicada = delta[i] ?? 0
      const noExplicada = valorApp - valorExcel - explicada
      excelAnio.push(valorExcel)
      appAnio.push(valorApp)
      explicadaAnio.push(explicada)
      noExplicadaAnio.push(noExplicada)
      if (noExplicada !== 0) hayDescuadre = true
    }

    if (noExplicadaAnio.length === 0) {
      console.log(
        `BANCO ${alinear(definicion.etiqueta, 26)} │ los 12 meses vienen de la cartola: fuera de comparación`,
      )
      continue
    }

    const totalNoExplicada = noExplicadaAnio.reduce((a, b) => a + b, 0)
    const marca = noExplicadaAnio.every((n) => n === 0) ? 'OK  ' : 'FALLA'

    console.log(
      `${marca} ${alinear(definicion.etiqueta, 26)} │ ` +
        derecha(fmt(excelAnio.reduce((a, b) => a + b, 0)), 16) +
        ' │ ' +
        derecha(fmt(appAnio.reduce((a, b) => a + b, 0)), 16) +
        ' │ ' +
        derecha(fmt(explicadaAnio.reduce((a, b) => a + b, 0)), 16) +
        ' │ ' +
        derecha(fmt(totalNoExplicada), 14),
    )

    if (!noExplicadaAnio.every((n) => n === 0)) {
      for (const mes of NUMEROS_MES) {
        const i = mes - 1
        if ((noExplicadaAnio[i] ?? 0) === 0) continue
        console.log(
          `      ${MESES_CORTOS[i]}: Excel ${fmt(excelAnio[i] ?? 0)} · App ${fmt(appAnio[i] ?? 0)}` +
            ` · explicada ${fmt(explicadaAnio[i] ?? 0)} · NO EXPLICADA ${fmt(noExplicadaAnio[i] ?? 0)}`,
        )
      }
    }
  }

  console.log('─'.repeat(112))
  console.log(
    `  ${celdasFuera} celdas fuera de comparación: ahí el valor lo manda el banco, no la planilla.`,
  )

  // --- Detalle mes a mes de la fila que resume todo -------------------------
  const financiero = app.get('financiero')
  const deltaFinanciero = deltas.get('financiero') ?? Array<number>(12).fill(0)

  console.log('\n' + '═'.repeat(96))
  console.log('FLUJO DE CAJA FINANCIERO, MES A MES')
  console.log('═'.repeat(96))
  console.log(
    alinear('Mes', 12) +
      ' │ ' +
      derecha('Total Excel', 16) +
      ' │ ' +
      derecha('Total app', 16) +
      ' │ ' +
      derecha('Dif. explicada', 16) +
      ' │ ' +
      derecha('No explicada', 14),
  )
  console.log('─'.repeat(96))

  // El flujo financiero se muestra siempre, pero solo cuenta como descuadre en los
  // meses que todavía se comparan: en los demás la diferencia contra el Excel es
  // justamente lo que la app vino a corregir.
  const financieroFuera = fuera.get('financiero') ?? new Set<number>()

  for (const mes of NUMEROS_MES) {
    const i = mes - 1
    const valorExcel = numeroDe(hoja.getCell(68, columnaDeMes(mes)))
    const valorApp = financiero?.montos[i] ?? 0
    const explicada = deltaFinanciero[i] ?? 0
    const noExplicada = valorApp - valorExcel - explicada
    if (noExplicada !== 0 && !financieroFuera.has(mes)) hayDescuadre = true
    console.log(
      alinear(MESES_CORTOS[i] ?? '', 12) +
        ' │ ' +
        derecha(fmt(valorExcel), 16) +
        ' │ ' +
        derecha(fmt(valorApp), 16) +
        ' │ ' +
        derecha(fmt(explicada), 16) +
        ' │ ' +
        derecha(fmt(noExplicada), 14),
    )
  }

  console.log('\nDiferencias explicadas:')
  for (const diferencia of DIFERENCIAS) console.log(`  · ${diferencia.motivo}`)

  return !hayDescuadre
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`Leyendo ${path.basename(ARCHIVO)} …\n`)
  const { resumen, libro } = await importar()

  const totales = await Promise.all([
    prisma.categoria.count(),
    prisma.proveedor.count(),
    prisma.movimiento.count(),
    prisma.valorManual.count(),
  ])

  console.log('═'.repeat(60))
  console.log('RESUMEN DE CARGA')
  console.log('═'.repeat(60))
  console.log(`  Categorías          ${derecha(String(totales[0]), 6)}`)
  console.log(
    `  Proveedores         ${derecha(String(totales[1]), 6)}   (${resumen.proveedoresCreados} nuevos, ${resumen.proveedoresExistentes} ya existían)`,
  )
  console.log(
    `  Movimientos         ${derecha(String(totales[2]), 6)}   (${resumen.movimientosCreados} nuevos, ${resumen.movimientosActualizados} actualizados)`,
  )
  if (resumen.valoresProtegidos > 0) {
    console.log(
      `  Filas protegidas    ${derecha(String(resumen.valoresProtegidos), 6)}   valores manuales que vienen de la cartola: el Excel no los pisa`,
    )
  }
  if (resumen.protegidos > 0) {
    console.log(
      `  Protegidos          ${derecha(String(resumen.protegidos), 6)}   ya tienen el monto real de la cartola: no se pisan con la proyección`,
    )
  }
  console.log(`  Valores manuales    ${derecha(String(totales[3]), 6)}`)
  if (resumen.omitidos.length > 0) {
    console.log(`\n  Filas omitidas:`)
    for (const omitida of resumen.omitidos) console.log(`    · ${omitida}`)
  }

  const porCategoria = await prisma.categoria.findMany({
    orderBy: [{ grupo: 'asc' }, { orden: 'asc' }],
    include: { _count: { select: { proveedores: true, movimientos: true } } },
  })
  console.log('\n  Proveedores por categoría:')
  for (const categoria of porCategoria) {
    if (categoria._count.proveedores === 0 && categoria._count.movimientos === 0) continue
    console.log(
      `    ${alinear(categoria.nombre, 34)} ${derecha(String(categoria._count.proveedores), 3)} prov. ` +
        `${derecha(String(categoria._count.movimientos), 4)} mov.`,
    )
  }

  const app = await calcularDesdeBase()
  const cuadra = await cuadratura(libro, app)

  console.log('\n' + '═'.repeat(96))
  if (cuadra) {
    console.log('✔  CUADRA. En las celdas que todavía vienen de la planilla, la diferencia no explicada es 0.')
  } else {
    console.log('✘  HAY DIFERENCIAS NO EXPLICADAS. Revisa las filas marcadas FALLA más arriba.')
    process.exitCode = 1
  }
  console.log('═'.repeat(96))
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
