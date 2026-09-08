/**
 * Carga los alias bancarios evidentes, aprobados por Japybrand WP.
 *
 *   npm run cargar-alias -- --firme
 *
 * Un alias es un patrón, no un texto exacto: el emparejamiento compara por
 * subcadena. Por eso "FACEBK" cubre las 10 glosas distintas que el banco emite
 * con su código de transacción ("Compra FACEBK *JTJ4CGR6J").
 */
import { PrismaClient } from '@prisma/client'
import { leerRemitentes, escribirRemitentes } from '../src/lib/dominio'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)

const ALIAS: { alias: string; proveedor: string }[] = [
  { alias: 'Amazon web servic', proveedor: 'AWS' },
  { alias: 'María Soledad', proveedor: 'Soledad Jhonson' },
  { alias: 'T. de Crédito', proveedor: 'Tarjeta Cred. Santander' },
  { alias: 'FACEBK', proveedor: 'Meta Ads / Clientes' },
  { alias: 'ERPYME', proveedor: 'Maxxa ERP' },
  { alias: 'Triztan Zamora', proveedor: 'Trizrán Zamora' },
  { alias: 'ELEMENTOR.COM', proveedor: 'Elementor One' },
  { alias: 'FS *rankmath', proveedor: 'Rank Math' },
  { alias: 'MODULAR PRO', proveedor: 'Modular DS' },
  { alias: 'PAYPAL *JUAN RUIZ', proveedor: 'Juan Pablo Ruiz' },
  { alias: 'READ - MEETING MA', proveedor: 'Read AI' },
  { alias: 'OPENAI', proveedor: 'Open AI' },
  { alias: 'ANTHROPIC', proveedor: 'Claude' },
  { alias: 'DIGITALOCEAN', proveedor: 'Digital Ocean' },
]

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'MODO SIMULACIÓN: usa --firme para aplicar.\n')
  const proveedores = await prisma.proveedor.findMany({ include: { categoria: true } })
  const bancarios = await prisma.movimientoBancario.findMany({ where: { monto: { lt: 0 } } })

  console.log('Alias'.padEnd(22) + 'Proveedor'.padEnd(26) + 'Categoría'.padEnd(24) + 'Cargos'.padStart(7) + 'Total'.padStart(14))
  console.log('─'.repeat(93))
  let faltan = 0
  for (const a of ALIAS) {
    const p = proveedores.find((x) => x.nombre === a.proveedor)
    if (!p) { console.log(`${a.alias.padEnd(22)}** no existe el proveedor "${a.proveedor}" **`); faltan++; continue }
    const calzan = bancarios.filter((b) =>
      b.descripcion.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
        .includes(a.alias.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()),
    )
    console.log(
      a.alias.padEnd(22) + p.nombre.padEnd(26) + p.categoria.nombre.padEnd(24) +
        String(calzan.length).padStart(7) + fmt(calzan.reduce((s, b) => s + b.monto, 0)).padStart(14),
    )
    if (firme) {
      await prisma.proveedor.update({
        where: { id: p.id },
        data: { aliasBancarios: escribirRemitentes([...leerRemitentes(p.aliasBancarios), a.alias]) },
      })
    }
  }
  console.log('─'.repeat(93))
  if (faltan > 0) { console.error(`\n${faltan} proveedores no existen. No se aplicó nada.`); process.exitCode = 1; return }
  console.log(firme ? `\nLISTO: ${ALIAS.length} alias cargados.` : `\nSIMULACIÓN: se cargarían ${ALIAS.length} alias.`)
}

main().catch((e: unknown) => { console.error(e); process.exitCode = 1 }).finally(() => { void prisma.$disconnect() })
