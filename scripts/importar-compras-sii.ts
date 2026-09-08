/**
 * Importa el Registro de Compras del SII y muestra el IVA resultante.
 *
 *   npm run importar-compras            (simulacion)
 *   npm run importar-compras -- --firme
 *
 * Las compras se importan por el credito fiscal. Con el debito de las ventas ya
 * cargado, el IVA a pagar deja de ser una estimacion.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { parsearCompras } from '../src/lib/sii/compras'
import { ivaPorMes } from '../src/lib/sii/iva'
import { MESES_CORTOS } from '../src/lib/dominio'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

const CARPETA = 'sii/compras'

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  const archivos = readdirSync(CARPETA).filter((f) => f.toLowerCase().endsWith('.csv')).sort()
  let nuevos = 0
  let actualizados = 0

  for (const archivo of archivos) {
    const texto = readFileSync(path.join(CARPETA, archivo)).toString('latin1')
    const { anio, mes, documentos } = parsearCompras(texto, archivo)
    const total = documentos.reduce((a, d) => a + d.montoTotal, 0)
    const iva = documentos.reduce((a, d) => a + d.montoIVARecuperable, 0)
    console.log(
      `  ${MESES_CORTOS[mes - 1]} ${anio}  ${String(documentos.length).padStart(3)} docs  ` +
        `total ${fmt(total).padStart(11)}  IVA ${fmt(iva).padStart(10)}`,
    )
    if (!firme) continue

    for (const d of documentos) {
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
        create: { ...d, archivoOrigen: archivo },
        update: { ...d, archivoOrigen: archivo },
      })
      if (previo) actualizados += 1
      else nuevos += 1
    }
  }

  if (firme) console.log(`\n  ${nuevos} documentos nuevos, ${actualizados} actualizados.`)
  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito. Para ver el IVA resultante corre con --firme.')
    return
  }

  // ── IVA resultante ─────────────────────────────────────────────────────────
  const filas = await ivaPorMes(2026)
  console.log('\nIVA MENSUAL')
  console.log('─'.repeat(92))
  console.log(
    'Período      Débito      Crédito    Remanente     A pagar   Vence el      Sale en',
  )
  console.log('─'.repeat(92))
  for (const f of filas) {
    console.log(
      `${MESES_CORTOS[f.mes - 1]}      ${fmt(f.debito).padStart(11)} ${fmt(f.credito).padStart(12)} ` +
        `${fmt(f.remanenteAnterior).padStart(12)} ${fmt(f.aPagar).padStart(11)}   ${f.venceEl}   ` +
        `${MESES_CORTOS[f.mesDePago.mes - 1]}` +
        (f.remanente > 0 ? `   deja ${fmt(f.remanente)} a favor` : '') +
        (f.completo ? '' : '   ← falta un registro'),
    )
  }
  console.log('─'.repeat(92))
  console.log(`Total a pagar en el año: ${fmt(filas.reduce((a, f) => a + f.aPagar, 0))}`)
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
