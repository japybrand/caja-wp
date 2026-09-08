/**
 * Importa el Registro de Ventas del SII y compara contra la planilla.
 *
 *   npm run importar-ventas
 *
 * Es idempotente: la clave única (tipoDocumento, folio) hace que recargar el mismo
 * archivo actualice en vez de duplicar.
 *
 * NO toca la fila "Ventas del mes" del flujo: sigue saliendo del ValorManual que
 * cargó el Excel. Ese cambio va aparte, después de revisar este reporte.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { leerCarpetaVentas, TIPO_COMPROBANTE_PAGO } from '../src/lib/sii/ventas'
import { totalesPorMes, rankingClientes, notasCredito } from '../src/lib/sii/totales'
import { MESES_CORTOS } from '../src/lib/dominio'

const prisma = new PrismaClient()
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CARPETA = path.join(RAIZ, 'sii', 'ventas')

const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)
const izq = (t: string, a: number): string => (t.length > a ? t.slice(0, a - 1) + '…' : t.padEnd(a))
const der = (t: string, a: number): string => (t.length > a ? t.slice(0, a) : t.padStart(a))
const raya = (n = 96): string => '─'.repeat(n)
const titulo = (t: string, n = 96): void => {
  console.log('\n' + '═'.repeat(n))
  console.log(t)
  console.log('═'.repeat(n))
}

async function main(): Promise<void> {
  const archivos = await leerCarpetaVentas(CARPETA)
  const documentos = archivos.flatMap((a) => a.documentos)

  // ------------------------------------------------------------------ carga
  let creados = 0
  let actualizados = 0
  for (const d of documentos) {
    const existente = await prisma.documentoVenta.findUnique({
      where: { tipoDocumento_folio: { tipoDocumento: d.tipoDocumento, folio: d.folio } },
    })
    await prisma.documentoVenta.upsert({
      where: { tipoDocumento_folio: { tipoDocumento: d.tipoDocumento, folio: d.folio } },
      create: d,
      update: d,
    })
    if (existente) actualizados += 1
    else creados += 1
  }

  titulo('1. CARGA')
  console.log(
    izq('Archivo', 36) + ' │ ' + der('Docs', 6) + ' │ ' + der('33', 5) + ' │ ' + der('34', 5) +
      ' │ ' + der('61', 5) + ' │ Tipos ignorados',
  )
  console.log(raya(96))
  const ignoradosGlobal = new Map<number, number>()
  for (const a of archivos) {
    const c = (t: number): number => a.documentos.filter((d) => d.tipoDocumento === t).length
    for (const [tipo, n] of a.tiposIgnorados) {
      ignoradosGlobal.set(tipo, (ignoradosGlobal.get(tipo) ?? 0) + n)
    }
    console.log(
      izq(a.archivo, 36) + ' │ ' + der(String(a.documentos.length), 6) + ' │ ' + der(String(c(33)), 5) +
        ' │ ' + der(String(c(34)), 5) + ' │ ' + der(String(c(61)), 5) + ' │ ' +
        ([...a.tiposIgnorados].map(([t, n]) => `${t}×${n}`).join(' ') || '—'),
    )
  }
  console.log(raya(96))
  console.log(
    `  ${documentos.length} documentos · ${creados} nuevos, ${actualizados} actualizados · ` +
      `total en la base: ${await prisma.documentoVenta.count()}`,
  )
  if (ignoradosGlobal.size === 0) {
    console.log(
      `  Ningún documento de otro tipo en el detalle. En particular, el tipo ${TIPO_COMPROBANTE_PAGO} ` +
        `(comprobante de pago\n  electrónico) no viene: el SII lo entrega solo como resumen mensual.`,
    )
  }

  // ------------------------------------------------------------- cuadratura
  const totales = totalesPorMes(documentos)
  const ventasManual = await prisma.valorManual.findMany({
    where: { anio: 2026, categoria: { nombre: 'Ventas del mes' } },
  })
  const planilla = new Map(ventasManual.map((v) => [v.mes, v.montoCLP]))

  titulo('2. CUADRATURA CONTRA LA PLANILLA')
  console.log(
    izq('Mes', 5) + ' │ ' + der('Docs', 5) + ' │ ' + der('SII', 14) + ' │ ' + der('Planilla', 14) +
      ' │ ' + der('Diferencia', 13) + ' │ ' + der('IVA débito', 12),
  )
  console.log(raya(80))
  let sumaSII = 0
  let sumaPlanilla = 0
  const conDatos = totales.filter((t) => t.documentos > 0)
  for (const t of conDatos) {
    const p = planilla.get(t.mes) ?? 0
    sumaSII += t.total
    sumaPlanilla += p
    console.log(
      izq(MESES_CORTOS[t.mes - 1] ?? '', 5) + ' │ ' + der(String(t.documentos), 5) + ' │ ' +
        der(fmt(t.total), 14) + ' │ ' + der(fmt(p), 14) + ' │ ' + der(fmt(t.total - p), 13) +
        ' │ ' + der(fmt(t.iva), 12),
    )
  }
  console.log(raya(80))
  console.log(
    izq('Tot', 5) + ' │ ' + der(String(documentos.length), 5) + ' │ ' + der(fmt(sumaSII), 14) +
      ' │ ' + der(fmt(sumaPlanilla), 14) + ' │ ' + der(fmt(sumaSII - sumaPlanilla), 13) + ' │ ' +
      der(fmt(conDatos.reduce((a, t) => a + t.iva, 0)), 12),
  )

  const sinDocumentos = totales.filter((t) => t.documentos === 0 && (planilla.get(t.mes) ?? 0) > 0)
  if (sinDocumentos.length > 0) {
    console.log(
      `\n  Sin documentos del SII: ${sinDocumentos.map((t) => MESES_CORTOS[t.mes - 1]).join(' ')}. ` +
        `Esos meses seguirán tomando el valor de la planilla.`,
    )
  }
  console.log(
    '\n  Las diferencias chicas son comprobantes de pago electrónico (tipo 48), que el SII\n' +
      '  entrega como resumen mensual y no aparecen en el detalle de ventas.',
  )

  // ---------------------------------------------------------- notas de crédito
  const notas = notasCredito(documentos)
  titulo('3. NOTAS DE CRÉDITO Y EL DOCUMENTO QUE ANULAN')
  if (notas.length === 0) {
    console.log('  No hay notas de crédito en el período.')
  } else {
    console.log(
      izq('Mes', 5) + ' │ ' + der('Folio', 6) + ' │ ' + der('Monto', 13) + ' │ ' +
        izq('Anula', 22) + ' │ Cliente',
    )
    console.log(raya(96))
    for (const n of notas) {
      const ref =
        n.tipoReferencia && n.folioReferencia
          ? `tipo ${n.tipoReferencia} folio ${n.folioReferencia}`
          : 'sin referencia'
      console.log(
        izq(MESES_CORTOS[n.mes - 1] ?? '', 5) + ' │ ' + der(n.folio, 6) + ' │ ' +
          der(fmt(-n.montoTotal), 13) + ' │ ' + izq(ref, 22) + ' │ ' + izq(n.razonSocial, 34),
      )
      if (n.referencia) {
        const r = n.referencia
        console.log(
          '      │        │               │ ' +
            izq(
              `↳ emitida en ${MESES_CORTOS[r.mes - 1]} por ${fmt(r.montoTotal)}` +
                (r.mismoMonto ? ', mismo monto: la anula entera' : ', anulación parcial'),
              70,
            ),
        )
      } else if (n.tipoReferencia) {
        console.log(
          '      │        │               │ ↳ el documento referenciado no está entre los cargados',
        )
      }
    }

    // El caso que importa: una nota de crédito que corrige un mes anterior.
    const cruzadas = notas.filter((n) => n.referencia && n.referencia.mes !== n.mes)
    if (cruzadas.length > 0) {
      console.log('\n  ¡OJO! Notas de crédito que corrigen un mes distinto al que se emitieron:\n')
      for (const n of cruzadas) {
        const r = n.referencia
        if (!r) continue
        console.log(
          `    La nota ${n.folio} de ${MESES_CORTOS[n.mes - 1]} (${fmt(n.montoTotal)}) anula el ` +
            `documento tipo ${n.tipoReferencia} folio ${n.folioReferencia},`,
        )
        console.log(
          `    emitido en ${MESES_CORTOS[r.mes - 1]}. La venta está contada en ${MESES_CORTOS[r.mes - 1]} ` +
            `y la anulación cae en ${MESES_CORTOS[n.mes - 1]}.`,
        )
        // ¿Hay otro documento del mismo cliente, mismo monto, mismo mes que el anulado?
        const gemelos = documentos.filter(
          (d) =>
            d.tipoDocumento === n.tipoReferencia &&
            d.rutCliente === n.rutCliente &&
            d.montoTotal === n.montoTotal &&
            d.mes === r.mes,
        )
        if (gemelos.length > 1) {
          console.log(
            `    En ${MESES_CORTOS[r.mes - 1]} hay ${gemelos.length} documentos idénticos de este cliente ` +
              `por ${fmt(n.montoTotal)}: folios ${gemelos.map((g) => g.folio).join(' y ')}.`,
          )
          console.log(
            `    O sea: se facturó dos veces y la nota corrige el duplicado. La planilla contó las dos`,
          )
          console.log(`    y nunca aplicó la anulación, así que infla el año en ${fmt(n.montoTotal)}.`)
        }
        console.log('')
      }
    }
  }

  // ------------------------------------------------------------------ clientes
  const ranking = rankingClientes(documentos)
  titulo('4. RANKING DE CLIENTES DEL AÑO')
  console.log(
    der('#', 3) + ' │ ' + izq('RUT', 13) + ' │ ' + izq('Razón social', 42) + ' │ ' +
      der('Docs', 5) + ' │ ' + der('Total', 14),
  )
  console.log(raya(88))
  ranking.forEach((c, i) => {
    console.log(
      der(String(i + 1), 3) + ' │ ' + izq(c.rut, 13) + ' │ ' + izq(c.razonSocial, 42) + ' │ ' +
        der(String(c.documentos), 5) + ' │ ' + der(fmt(c.total), 14),
    )
  })
  console.log(raya(88))
  console.log(
    `  ${ranking.length} clientes distintos por RUT. ` +
      `Los tres primeros concentran ${(
        (ranking.slice(0, 3).reduce((a, c) => a + c.total, 0) / sumaSII) * 100
      ).toFixed(1)}% del total.`,
  )

  titulo('LISTO')
  console.log('  La fila "Ventas del mes" del flujo NO se tocó: sigue saliendo de la planilla.')
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
