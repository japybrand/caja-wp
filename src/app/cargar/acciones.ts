'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requerirSesion } from '@/lib/sesion'
import { parsearCartola } from '@/lib/banco/parser'
import { parsearVentas, periodoDelNombre } from '@/lib/sii/ventas'
import { parsearCompras } from '@/lib/sii/compras'
import { parsearExportG66, esExportGlobal66 } from '@/lib/global66/parser'
import { hashMovimiento } from '@/lib/global66/reparto'

/**
 * Carga de archivos por la web: cartola de Santander, ventas del SII y compras del SII.
 *
 * El mes se detecta solo: la cartola lo trae en las fechas de sus movimientos y los
 * archivos del SII en el nombre (RCV_VENTA_76513765-9_202608.csv).
 */

export type TipoFuente = 'cartola' | 'ventas' | 'compras' | 'global66'

export interface ResultadoCarga {
  ok: boolean
  error?: string
  archivo: string
  tipo: TipoFuente
  /** Qué período trae el archivo. */
  periodo?: string
  /** Qué cambió, línea por línea, para mostrarlo al usuario. */
  cambios?: string[]
  nuevos?: number
  yaEstaban?: number
}

/** Como se nombra cada fuente en los mensajes de error. */
const NOMBRE_TIPO: Record<TipoFuente, string> = {
  cartola: 'una cartola de Santander',
  ventas: 'ventas del SII',
  compras: 'compras del SII',
  global66: 'un export de Global66',
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * Reconoce el tipo, para no depender de en qué zona se soltó.
 *
 * El export de Global66 obliga a mirar el contenido y no solo el nombre: se llama
 * "movements-01-2026_09-2026.xls", que no dice qué es, y viene con extensión .xls
 * aunque por dentro sea xlsx, así que por nombre se confundiría con una cartola de
 * Santander. Se decide por el nombre de la hoja y su cabecera.
 */
export async function detectarTipo(nombre: string, datos?: Uint8Array): Promise<TipoFuente | null> {
  const n = nombre.toUpperCase()
  if (n.includes('RCV_VENTA')) return 'ventas'
  if (n.includes('RCV_COMPRA')) return 'compras'
  if (n.includes('MOVEMENTS')) return 'global66'
  if (datos && (n.endsWith('.XLSX') || n.endsWith('.XLS')) && esExportGlobal66(datos)) {
    return 'global66'
  }
  if (n.includes('CARTOLA')) return 'cartola'
  if (n.endsWith('.XLSX') || n.endsWith('.XLS')) return 'cartola'
  if (n.endsWith('.CSV')) return null
  return null
}

export async function cargarArchivo(
  nombre: string,
  contenidoBase64: string,
  tipoPedido: TipoFuente,
): Promise<ResultadoCarga> {
  await requerirSesion()

  const base = { archivo: nombre, tipo: tipoPedido }
  let datos: Buffer
  try {
    datos = Buffer.from(contenidoBase64, 'base64')
  } catch {
    return { ...base, ok: false, error: 'No se pudo leer el archivo.' }
  }
  if (datos.length === 0) return { ...base, ok: false, error: 'El archivo está vacío.' }

  const detectado = await detectarTipo(nombre, new Uint8Array(datos))
  if (detectado && detectado !== tipoPedido) {
    return {
      ...base,
      ok: false,
      error: `"${nombre}" parece ser ${NOMBRE_TIPO[detectado]}, no ${NOMBRE_TIPO[tipoPedido]}. Suéltalo en la zona correcta.`,
    }
  }

  if (tipoPedido === 'cartola') return cargarCartola(nombre, datos)
  if (tipoPedido === 'ventas') return cargarVentas(nombre, datos)
  if (tipoPedido === 'global66') return cargarGlobal66(nombre, datos)
  return cargarCompras(nombre, datos)
}

/**
 * Registro de Compras del SII: es el credito fiscal del F29.
 *
 * Con el debito de las ventas ya cargado, el IVA a pagar deja de ser una
 * estimacion. La planilla lo estimaba y erraba en millones.
 */
async function cargarCompras(nombre: string, datos: Buffer): Promise<ResultadoCarga> {
  const base = { archivo: nombre, tipo: 'compras' as const }
  let archivo
  try {
    archivo = parsearCompras(datos.toString('latin1'), nombre)
  } catch (error: unknown) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : 'No se pudo leer.' }
  }
  if (archivo.documentos.length === 0) {
    return { ...base, ok: false, error: 'El archivo no trae documentos.' }
  }

  let nuevos = 0
  for (const d of archivo.documentos) {
    const clave = {
      tipoDocumento_folio_rutProveedor: {
        tipoDocumento: d.tipoDocumento,
        folio: d.folio,
        rutProveedor: d.rutProveedor,
      },
    }
    const previo = await prisma.documentoCompra.findUnique({ where: clave })
    await prisma.documentoCompra.upsert({
      where: clave,
      create: { ...d, archivoOrigen: nombre },
      update: { ...d, archivoOrigen: nombre },
    })
    if (!previo) nuevos += 1
  }

  const credito = archivo.documentos.reduce((a, d) => a + d.montoIVARecuperable, 0)
  const total = archivo.documentos.reduce((a, d) => a + d.montoTotal, 0)
  const pesos = (n: number): string => new Intl.NumberFormat('es-CL').format(n)
  return {
    ...base,
    ok: true,
    periodo: `${MESES[archivo.mes - 1]} ${archivo.anio}`,
    nuevos,
    yaEstaban: archivo.documentos.length - nuevos,
    cambios: [
      `${archivo.documentos.length} documentos por ${pesos(total)}.`,
      `Crédito fiscal del período: ${pesos(credito)}. Se descuenta del IVA que pagas.`,
    ],
  }
}

async function cargarCartola(nombre: string, datos: Buffer): Promise<ResultadoCarga> {
  const base = { archivo: nombre, tipo: 'cartola' as const }
  let cartola
  try {
    cartola = parsearCartola(new Uint8Array(datos), nombre)
  } catch (error: unknown) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : 'No se pudo leer.' }
  }

  if (!cartola.cuadra) {
    return {
      ...base,
      ok: false,
      error:
        `La cartola no cuadra con su propia cabecera de saldos: cargos ${cartola.difCargos}, ` +
        `abonos ${cartola.difAbonos}. No se importa hasta resolverlo.`,
    }
  }
  if (cartola.movimientos.length === 0) {
    return { ...base, ok: false, error: 'La cartola no trae movimientos.' }
  }

  const meses = [...new Set(cartola.movimientos.map((m) => `${MESES[m.mes - 1]} ${m.anio}`))]
  const existentes = new Set(
    (
      await prisma.movimientoBancario.findMany({
        where: { hash: { in: cartola.movimientos.map((m) => m.hash) } },
        select: { hash: true },
      })
    ).map((x) => x.hash),
  )
  const nuevos = cartola.movimientos.filter((m) => !existentes.has(m.hash))

  for (let i = 0; i < nuevos.length; i += 100) {
    await prisma.$transaction(
      nuevos.slice(i, i + 100).map((m) =>
        prisma.movimientoBancario.create({
          data: {
            fecha: m.fecha,
            mes: m.mes,
            anio: m.anio,
            monto: m.monto,
            descripcion: m.descripcion,
            nDocumento: m.nDocumento,
            sucursal: m.sucursal,
            tipo: m.tipo,
            banco: cartola.banco,
            cuenta: cartola.cuenta,
            archivoOrigen: cartola.archivo,
            hash: m.hash,
          },
        }),
      ),
    )
  }

  revalidatePath('/banco')
  revalidatePath('/flujo')

  const cargos = cartola.movimientos.filter((m) => m.monto < 0).length
  return {
    ...base,
    ok: true,
    periodo: meses.join(', '),
    nuevos: nuevos.length,
    yaEstaban: cartola.movimientos.length - nuevos.length,
    cambios: [
      `${cartola.movimientos.length} movimientos leídos: ${cargos} cargos y ${cartola.movimientos.length - cargos} abonos.`,
      `Cargos ${cartola.cargos.toLocaleString('es-CL')} y abonos ${cartola.abonos.toLocaleString('es-CL')}: cuadran con la cabecera del archivo.`,
      `${nuevos.length} nuevos, ${cartola.movimientos.length - nuevos.length} ya estaban.`,
      nuevos.length > 0
        ? 'Quedan sin conciliar en la bandeja de /banco. No se creó ningún movimiento del flujo.'
        : 'Nada nuevo: el archivo ya estaba cargado.',
    ],
  }
}

async function cargarVentas(nombre: string, datos: Buffer): Promise<ResultadoCarga> {
  const base = { archivo: nombre, tipo: 'ventas' as const }
  let archivo
  try {
    archivo = parsearVentas(datos.toString('latin1'), nombre)
  } catch (error: unknown) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : 'No se pudo leer.' }
  }
  if (archivo.documentos.length === 0) {
    return { ...base, ok: false, error: 'El archivo no trae documentos de tipo 33, 34 ni 61.' }
  }

  const antes = await prisma.valorManual.findFirst({
    where: {
      anio: archivo.anio,
      mes: archivo.mes,
      categoria: { nombre: 'Ventas del mes' },
    },
  })

  let nuevos = 0
  for (const d of archivo.documentos) {
    const existe = await prisma.documentoVenta.findUnique({
      where: { tipoDocumento_folio: { tipoDocumento: d.tipoDocumento, folio: d.folio } },
    })
    await prisma.documentoVenta.upsert({
      where: { tipoDocumento_folio: { tipoDocumento: d.tipoDocumento, folio: d.folio } },
      create: d,
      update: d,
    })
    if (!existe) nuevos += 1
  }

  const total = archivo.documentos.reduce(
    (a, d) => a + (d.tipoDocumento === 61 ? -1 : 1) * d.montoTotal,
    0,
  )

  revalidatePath('/ventas')
  revalidatePath('/flujo')

  const cambios = [
    `${archivo.documentos.length} documentos: ` +
      `${archivo.documentos.filter((d) => d.tipoDocumento === 33).length} facturas afectas, ` +
      `${archivo.documentos.filter((d) => d.tipoDocumento === 34).length} exentas, ` +
      `${archivo.documentos.filter((d) => d.tipoDocumento === 61).length} notas de crédito.`,
    `Total facturado del mes: ${total.toLocaleString('es-CL')}.`,
    `${nuevos} nuevos, ${archivo.documentos.length - nuevos} actualizados.`,
  ]
  if (antes) {
    cambios.push(
      `La fila "Ventas del mes" de ${MESES[archivo.mes - 1]} pasa de ${antes.montoCLP.toLocaleString('es-CL')} ` +
        `(proyección) a ${total.toLocaleString('es-CL')} (SII): ${(total - antes.montoCLP).toLocaleString('es-CL')}.`,
    )
  }
  if (archivo.tiposIgnorados.size > 0) {
    cambios.push(
      `Tipos ignorados: ${[...archivo.tiposIgnorados].map(([t, n]) => `${t}×${n}`).join(', ')}.`,
    )
  }

  return {
    ...base,
    ok: true,
    periodo: `${MESES[archivo.mes - 1]} ${archivo.anio}`,
    nuevos,
    yaEstaban: archivo.documentos.length - nuevos,
    cambios,
  }
}

/**
 * Guarda las filas del export de Global66.
 *
 * Solo persiste: el reparto entre colaboradores lo hace `importar-global66`, que
 * decide sobre el flujo y conviene poder simular antes de escribir.
 */
async function cargarGlobal66(nombre: string, datos: Buffer): Promise<ResultadoCarga> {
  const base = { archivo: nombre, tipo: 'global66' as const }
  let exportado
  try {
    exportado = parsearExportG66(new Uint8Array(datos), nombre)
  } catch (error: unknown) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : 'No se pudo leer.' }
  }
  if (exportado.movimientos.length === 0) {
    return { ...base, ok: false, error: 'El export no trae movimientos.' }
  }

  const conHash = exportado.movimientos.map((m, i) => ({ m, hash: hashMovimiento(m, nombre, i) }))
  const existentes = new Set(
    (
      await prisma.movimientoGlobal66.findMany({
        where: { hash: { in: conHash.map((x) => x.hash) } },
        select: { hash: true },
      })
    ).map((x) => x.hash),
  )
  const nuevos = conHash.filter((x) => !existentes.has(x.hash))

  for (const { m, hash } of nuevos) {
    await prisma.movimientoGlobal66.create({
      data: {
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
        archivoOrigen: nombre,
        hash,
      },
    })
  }

  const meses = [...new Set(exportado.movimientos.map((m) => `${MESES[m.mes - 1]} ${m.anio}`))]
  const envios = nuevos.filter((x) => x.m.tipo === 'envio').length
  return {
    ...base,
    ok: true,
    periodo: exportado.periodo.replace('Periodo consultado:', '').trim() || meses.join(', '),
    nuevos: nuevos.length,
    yaEstaban: exportado.movimientos.length - nuevos.length,
    cambios:
      nuevos.length === 0
        ? ['Ya estaba todo cargado.']
        : [
            `${nuevos.length} movimientos nuevos, ${envios} de ellos envíos a colaboradores.`,
            'Falta repartirlos en el flujo con el script de Global66.',
          ],
  }
}

export interface EstadoMes {
  mes: number
  cartola: boolean
  ventas: boolean
  global66: boolean
  movimientosBanco: number
  documentosVenta: number
  movimientosGlobal66: number
}

/** Qué meses tienen cada fuente cargada, para la tabla de estado. */
export async function estadoDeCarga(anio: number): Promise<EstadoMes[]> {
  await requerirSesion()

  const [banco, ventas, g66] = await Promise.all([
    prisma.movimientoBancario.groupBy({ by: ['mes'], where: { anio }, _count: { _all: true } }),
    prisma.documentoVenta.groupBy({ by: ['mes'], where: { anio }, _count: { _all: true } }),
    prisma.movimientoGlobal66.groupBy({ by: ['mes'], where: { anio }, _count: { _all: true } }),
  ])
  const b = new Map(banco.map((x) => [x.mes, x._count._all]))
  const v = new Map(ventas.map((x) => [x.mes, x._count._all]))
  const g = new Map(g66.map((x) => [x.mes, x._count._all]))

  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1
    return {
      mes,
      cartola: (b.get(mes) ?? 0) > 0,
      ventas: (v.get(mes) ?? 0) > 0,
      global66: (g.get(mes) ?? 0) > 0,
      movimientosBanco: b.get(mes) ?? 0,
      documentosVenta: v.get(mes) ?? 0,
      movimientosGlobal66: g.get(mes) ?? 0,
    }
  })
}
