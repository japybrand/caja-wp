/**
 * Carga declaraciones del F29.
 *
 *   npm run cargar-f29            (simulacion)
 *   npm run cargar-f29 -- --firme
 *
 * El desglose es opcional a proposito: el contador suele mandar primero el monto a
 * pagar y despues el formulario. Mientras solo haya total, la app muestra cuanto
 * falta por desglosar en vez de fingir que el IVA es todo.
 */

import { PrismaClient } from '@prisma/client'
import { f29PorMes } from '../src/lib/sii/f29'
import { MESES_CORTOS } from '../src/lib/dominio'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

interface Declaracion {
  anioPeriodo: number
  mesPeriodo: number
  ppm?: number
  retencionesHonorarios?: number
  otros?: number
  totalDeclarado?: number
  estado?: string
  nota?: string
}

/**
 * Periodo agosto de 2026: el contador informo 2.429.918 a pagar en septiembre.
 * Todavia sin desglose, asi que solo va el total.
 */
const DECLARACIONES: Declaracion[] = [
  {
    anioPeriodo: 2026,
    mesPeriodo: 8,
    totalDeclarado: 2_429_918,
    estado: 'declarado',
    nota: 'Total informado por el contador. Falta el desglose de PPM, retenciones y otros.',
  },
]

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  for (const d of DECLARACIONES) {
    console.log(
      `${MESES_CORTOS[d.mesPeriodo - 1]} ${d.anioPeriodo}  total ${fmt(d.totalDeclarado ?? 0)}  ` +
        `(${d.estado ?? 'pendiente'})`,
    )
    if (!firme) continue
    await prisma.declaracionF29.upsert({
      where: { anioPeriodo_mesPeriodo: { anioPeriodo: d.anioPeriodo, mesPeriodo: d.mesPeriodo } },
      create: {
        anioPeriodo: d.anioPeriodo,
        mesPeriodo: d.mesPeriodo,
        ppm: d.ppm ?? 0,
        retencionesHonorarios: d.retencionesHonorarios ?? 0,
        otros: d.otros ?? 0,
        totalDeclarado: d.totalDeclarado ?? null,
        estado: d.estado ?? 'pendiente',
        nota: d.nota ?? '',
      },
      update: {
        ppm: d.ppm ?? 0,
        retencionesHonorarios: d.retencionesHonorarios ?? 0,
        otros: d.otros ?? 0,
        totalDeclarado: d.totalDeclarado ?? null,
        estado: d.estado ?? 'pendiente',
        nota: d.nota ?? '',
      },
    })
  }

  const filas = await f29PorMes(2026)
  console.log('\nF29 POR PERÍODO')
  console.log('─'.repeat(104))
  console.log(
    'Período       IVA        PPM   Retenc.      Otros      TOTAL  Sin desglosar  Vence el     Sale en',
  )
  console.log('─'.repeat(104))
  for (const f of filas) {
    console.log(
      `${MESES_CORTOS[f.mesPeriodo - 1]}    ${fmt(f.iva?.aPagar ?? 0).padStart(10)} ` +
        `${fmt(f.ppm).padStart(10)} ${fmt(f.retencionesHonorarios).padStart(9)} ${fmt(f.otros).padStart(10)} ` +
        `${fmt(f.total).padStart(10)} ${(f.sinDesglosar > 0 ? fmt(f.sinDesglosar) : '—').padStart(14)}  ` +
        `${f.venceEl}   ${MESES_CORTOS[f.mesDePago.mes - 1]}` +
        (f.completo ? '' : '   ← solo IVA, falta el formulario'),
    )
  }
  console.log('─'.repeat(104))
  console.log(`Total del año: ${fmt(filas.reduce((a, f) => a + f.total, 0))}`)

  if (!firme) console.log('\nSIMULACIÓN: nada escrito.')
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
