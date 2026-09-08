/**
 * Reparte las transferencias a Global66 entre los colaboradores internacionales.
 *
 *   npm run repartir-global66            (simulacion)
 *   npm run repartir-global66 -- --firme
 *
 * Los pagos internacionales no salen uno a uno de la cuenta: se manda un monto a
 * la cuenta propia en Global66 y desde ahi se paga a cada colaborador. La cartola
 * solo ve la transferencia total, asi que hay que repartirla.
 *
 * EL REPARTO SALE DE LO ENVIADO, NO DE LO QUE DECIA LA PLANILLA
 * En junio y julio no alcanzo para todos: solo se pago a Jimena y a Juan Pablo se
 * le quedo debiendo. Repartir a prorrata habria mostrado a todos parcialmente
 * pagados, que es falso, y habria escondido la deuda.
 *
 * COMO SE DECIDE QUIEN COBRO CADA MES
 * Se busca el subconjunto de colaboradores con deuda ese mes cuya suma quepa en lo
 * transferido, prefiriendo el mas grande. Con cuatro colaboradores son 16
 * combinaciones: se prueban todas. El sobrante es el costo y spread de Global66.
 *
 * El metodo se valida solo: para junio elige {Jimena} y deja 36.593 de costo, que
 * es exactamente lo que el usuario describe de memoria.
 */

import { PrismaClient } from '@prisma/client'
import { MESES_CORTOS } from '../src/lib/dominio'
import { contiene } from '../src/lib/consulta'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL').format(Math.round(n))

const CATEGORIA_INTERNACIONAL = 'Pago de servicios Internacional'
const CATEGORIA_COSTO = 'Global66 - costo y spread'
const GLOSA = 'Japybrand SPA'

/**
 * Meses cuyo reparto no se puede deducir de los datos y quedan marcados.
 *
 * Enero: se enviaron 1.633.482 y la planilla de 2026 solo registra 161.676 de Juan
 * Pablo. El resto paga trabajo de diciembre de 2025, que la app no tiene cargado.
 * Atribuirlo a costo de Global66 diria que la comision fue del 90%.
 */
const MESES_SIN_DATOS = [1]

interface Reparto {
  mes: number
  enviado: number
  pagados: { nombre: string; monto: number }[]
  /** Deuda del mes que quedo sin pagar. */
  impago: { nombre: string; monto: number }[]
  costo: number
  /** true si el sobrante es demasiado grande para ser solo comision. */
  sobranteDudoso: boolean
}

/** El subconjunto de mayor suma que no pase del tope. Empata por cantidad de pagados. */
function mejorSubconjunto(
  deudas: { nombre: string; monto: number }[],
  tope: number,
): { nombre: string; monto: number }[] {
  let mejor: { nombre: string; monto: number }[] = []
  let mejorSuma = -1
  for (let mascara = 0; mascara < 1 << deudas.length; mascara += 1) {
    const elegidos = deudas.filter((_, i) => (mascara & (1 << i)) !== 0)
    const suma = elegidos.reduce((a, d) => a + d.monto, 0)
    if (suma > tope) continue
    if (suma > mejorSuma || (suma === mejorSuma && elegidos.length > mejor.length)) {
      mejor = elegidos
      mejorSuma = suma
    }
  }
  return mejor
}

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'SIMULACIÓN: nada se escribe. Usa --firme para aplicar.\n')

  const categoria = await prisma.categoria.findFirst({ where: { nombre: CATEGORIA_INTERNACIONAL } })
  if (!categoria) throw new Error(`No existe "${CATEGORIA_INTERNACIONAL}".`)

  const proveedores = await prisma.proveedor.findMany({
    where: { categoriaId: categoria.id },
    orderBy: { nombre: 'asc' },
  })

  // Lo que cada planilla dice que se debia cada mes.
  const debido = new Map<string, Map<number, number>>()
  for (const p of proveedores) {
    const movs = await prisma.movimiento.findMany({
      where: { proveedorId: p.id, anio: 2026, estado: 'confirmado' },
    })
    const porMes = new Map<number, number>()
    for (const m of movs) porMes.set(m.mes, (porMes.get(m.mes) ?? 0) + m.montoCLP)
    debido.set(p.nombre, porMes)
  }

  // Lo efectivamente enviado a Global66 cada mes. Los abonos restan: son plata que volvio.
  const transferencias = await prisma.movimientoBancario.findMany({
    where: { anio: 2026, descripcion: contiene(GLOSA) },
    orderBy: { fecha: 'asc' },
  })
  const enviadoPorMes = new Map<number, { total: number; ids: string[] }>()
  for (const t of transferencias) {
    const e = enviadoPorMes.get(t.mes) ?? { total: 0, ids: [] }
    e.total += -t.monto
    e.ids.push(t.id)
    enviadoPorMes.set(t.mes, e)
  }

  // Deuda arrastrada de cada colaborador.
  const arrastre = new Map<string, number>(proveedores.map((p) => [p.nombre, 0]))
  const repartos: Reparto[] = []

  for (let mes = 1; mes <= 12; mes += 1) {
    const enviado = enviadoPorMes.get(mes)?.total ?? 0
    const delMes = proveedores
      .map((p) => ({ nombre: p.nombre, monto: debido.get(p.nombre)?.get(mes) ?? 0 }))
      .filter((d) => d.monto > 0)
    if (enviado === 0 && delMes.length === 0) continue

    if (MESES_SIN_DATOS.includes(mes)) {
      for (const d of delMes) arrastre.set(d.nombre, (arrastre.get(d.nombre) ?? 0) + d.monto)
      repartos.push({ mes, enviado, pagados: [], impago: delMes, costo: 0, sobranteDudoso: true })
      continue
    }

    const pagados = mejorSubconjunto(delMes, enviado)
    const pagadosNombres = new Set(pagados.map((p) => p.nombre))
    const impago = delMes.filter((d) => !pagadosNombres.has(d.nombre))
    const sobrante = enviado - pagados.reduce((a, p) => a + p.monto, 0)

    // Un sobrante grande no es comision: es un abono a la deuda vieja. Se aplica al
    // colaborador con mas arrastre, que es a quien se le venia debiendo.
    const dudoso = enviado > 0 && sobrante > enviado * 0.15
    let costo = sobrante
    if (dudoso && sobrante > 0) {
      const conDeuda = [...arrastre.entries()]
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
      const acreedor = conDeuda[0]
      if (acreedor) {
        const abono = Math.min(sobrante, acreedor[1])
        pagados.push({ nombre: acreedor[0], monto: abono })
        arrastre.set(acreedor[0], acreedor[1] - abono)
        costo = sobrante - abono
      }
    }

    for (const d of impago) arrastre.set(d.nombre, (arrastre.get(d.nombre) ?? 0) + d.monto)

    repartos.push({ mes, enviado, pagados, impago, costo, sobranteDudoso: dudoso })
  }

  // ── Informe ────────────────────────────────────────────────────────────────
  console.log('REPARTO MES A MES')
  console.log('─'.repeat(96))
  let totalCosto = 0
  let totalRepartido = 0
  for (const r of repartos) {
    const pagado = r.pagados.reduce((a, p) => a + p.monto, 0)
    totalCosto += r.costo
    totalRepartido += pagado
    console.log(
      `\n${MESES_CORTOS[r.mes - 1]}  enviado ${fmt(r.enviado).padStart(11)}   repartido ${fmt(pagado).padStart(11)}   costo ${fmt(r.costo).padStart(9)}` +
        (r.enviado > 0 ? `  (${((r.costo / r.enviado) * 100).toFixed(1)}%)` : ''),
    )
    for (const p of r.pagados) console.log(`      paga     ${p.nombre.padEnd(18)} ${fmt(p.monto).padStart(11)}`)
    for (const d of r.impago) console.log(`      QUEDA DEBIENDO ${d.nombre.padEnd(13)} ${fmt(d.monto).padStart(11)}`)
    if (r.sobranteDudoso && MESES_SIN_DATOS.includes(r.mes)) {
      console.log(`      SIN DATOS: la planilla de 2026 no explica lo enviado`)
    }
  }

  console.log('\n' + '─'.repeat(96))
  console.log(`Repartido a colaboradores  ${fmt(totalRepartido).padStart(12)}`)
  console.log(`Costo y spread Global66    ${fmt(totalCosto).padStart(12)}`)
  const enviadoTotal = [...enviadoPorMes.values()].reduce((a, e) => a + e.total, 0)
  const sinExplicar = enviadoTotal - totalRepartido - totalCosto
  console.log(`Enviado total              ${fmt(enviadoTotal).padStart(12)}`)
  console.log(`Sin explicar (enero)       ${fmt(sinExplicar).padStart(12)}`)

  console.log('\n\nSALDO PENDIENTE POR COLABORADOR')
  console.log('─'.repeat(60))
  console.log('Colaborador           Planillas      Pagado     Pendiente')
  for (const p of proveedores) {
    const totalDebido = [...(debido.get(p.nombre)?.values() ?? [])].reduce((a, b) => a + b, 0)
    const totalPagado = repartos
      .flatMap((r) => r.pagados)
      .filter((x) => x.nombre === p.nombre)
      .reduce((a, x) => a + x.monto, 0)
    console.log(
      `${p.nombre.padEnd(20)} ${fmt(totalDebido).padStart(11)} ${fmt(totalPagado).padStart(11)} ` +
        `${fmt(totalDebido - totalPagado).padStart(12)}`,
    )
  }

  if (!firme) {
    console.log('\nSIMULACIÓN: nada escrito.')
    return
  }
  console.log('\n(la escritura va en el siguiente paso, una vez confirmado el reparto)')
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
