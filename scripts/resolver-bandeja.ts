/**
 * Resuelve automáticamente lo que se puede resolver con criterio, y deja en la
 * bandeja lo que necesita memoria o decisión de una persona.
 *
 *   npm run resolver-bandeja            (simulación)
 *   npm run resolver-bandeja -- --firme
 */

import { PrismaClient } from '@prisma/client'
import { leerRemitentes, escribirRemitentes, MESES_CORTOS } from '../src/lib/dominio'
import { asignarAFilaManual } from '../src/lib/banco/asignar'

const prisma = new PrismaClient()
const firme = process.argv.includes('--firme')
const fmt = (n: number): string => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n)
const izq = (t: string, a: number): string => (t.length > a ? t.slice(0, a - 1) + '…' : t.padEnd(a))
const der = (t: string, a: number): string => t.padStart(a)

/** Glosa (subcadena) -> proveedor que ya existe en la app. */
const A_PROVEEDOR: [string, string][] = [
  ['Compra Amazon web servic', 'AWS'],
  ['Compra VERPEX.COM', 'Verpex'],
  ['Compra ERPYME', 'Maxxa ERP'],
  ['Compra GOOGLE *Workspace', 'Google Workspace'],
  ['Compra Google Workspace_', 'Google Workspace'],
  ['Compra GOOGLE*WORKSPACE', 'Google Workspace'],
  ['Pago Automático T. de Crédito', 'Tarjeta Cred. Santander'],
  ['Transf a Paul Valenzuel', 'Paul Valenzuela'],
  ['Transf a María Soledad', 'Soledad Jhonson'],
  ['Transf a Camilo Espinoz', 'Camilo Espinoza'],
  ['Compra FACEBK', 'Meta Ads / Clientes'],
  ['Compra LOVABLE', 'Lovable'],
  ['Compra CLAUDE.AI SUBSCRI', 'Claude'],
  ['Compra ANTHROPIC', 'Claude'],
  ['Compra MODULAR PRO', 'Modular DS'],
  ['Compra ENVATO', 'Envato'],
  ['Compra PAYPAL *ENVATO MK', 'Envato'],
  ['Compra PAYPAL *JUAN RUIZ', 'Juan Pablo Ruiz'],
  ['Compra READ - MEETING MA', 'Read AI'],
  ['Compra OPENAI', 'Open AI'],
  ['Compra WHMCS', 'WHMCS'],
  ['Compra LITESPEED TECHNOL', 'Litespeed Technologies'],
  ['Compra GOOGLE ADS GOOGLE', 'Google ADS'],
  ['Compra DL*GOOGLE ADS', 'Google ADS'],
  ['Compra SITEGROUND HOSTIN', 'Siteground'],
  ['Compra BANAHOSTING', 'Banahosting VPS'],
  ['Compra Pipedrive OU', 'Pipedrive'],
  ['Compra CANVA', 'Canva'],
  ['Compra CALENDLY', 'Calendly'],
  ['Compra METRICOOL.COM', 'Metricool'],
  ['Compra Mailchimp', 'Mailchimp'],
  ['Compra CABIFY', 'Cabify Envíos'],
  ['Compra FLOW *VOYAPP', 'Voyapp'],
  ['Compra MGF* MAGNIFIC PRE', 'Magnific'],
  ['Compra MAGNIFIC', 'Magnific'],
  ['Compra monday.com', 'Monday'],
  ['Compra Monday.com INC', 'Monday'],
  ['Compra Adobe', 'Adobe'],
  ['Compra DIGITALOCEAN', 'Digital Ocean'],
  // Estas fallaban solo por cómo el banco escribe el nombre.
  ['MICROSOFT', 'Microsoft Office'],
  ['NAME-CHEAP.COM', 'Namecheap'],
  ['Compra HIGGSFIELD INC.', 'Higgsfield Basic'],
  ['Compra WWW.MAKE.COM', 'Make'],
  // Illustrator es un producto de Adobe, que ya existe como proveedor.
  ['Compra Illustrator', 'Adobe'],
]

/**
 * Comisiones y cargos propios del banco. Van todos a la fila Bancos, con el
 * proveedor que les corresponde.
 */
const A_BANCOS: [string, string][] = [
  ['COM.MANTENCION PLAN', 'Mantención Débito Santander'],
  ['RECUP COM PLAN MES ANT', 'Mantención Débito Santander'],
  ['PAC Seg. Fraude', 'PAC Seg. Fraude Santander'],
]

/**
 * Cargos que calzan al peso con una fila manual de impuestos del Excel.
 * Solo se incluyen los que tienen evidencia: mismo monto y mismo mes.
 */
const A_FILA_MANUAL: { glosa: string; categoria: string; motivo: string }[] = [
  {
    glosa: 'Embargo Judicial',
    categoria: 'Santander Pagos TGR',
    motivo: 'ago 1.763.883, calza exacto con la fila del Excel',
  },
  {
    glosa: 'PAGO EN LINEA S.I.I.',
    categoria: 'Pago de impuestos IVA',
    motivo: 'mar 637.943, calza exacto con la fila del Excel',
  },
]

/** Transferencias a MOLINA OVALLE que se dejan a mano, ya acordado. */
const MOLINA_A_MANO = [-2_500_000, -987_018]
const REMUNERACION = -1_500_000

interface Cambio {
  tipo: string
  glosa: string
  detalle: string
  monto: number
}

async function main(): Promise<void> {
  console.log(firme ? 'MODO FIRME\n' : 'MODO SIMULACIÓN: usa --firme para aplicar.\n')

  const cambios: Cambio[] = []
  const proveedores = await prisma.proveedor.findMany({ include: { categoria: true } })
  const buscarProv = (n: string) => proveedores.find((p) => p.nombre === n)

  // ---------------------------------------------------- 1. proveedores existentes
  for (const [glosa, nombre] of [...A_PROVEEDOR, ...A_BANCOS]) {
    const prov = buscarProv(nombre)
    if (!prov) {
      console.error(`  !! no existe el proveedor "${nombre}"`)
      continue
    }
    const cargos = await prisma.movimientoBancario.findMany({
      where: {
        anio: 2026,
        estadoConciliacion: 'sin_conciliar',
        monto: { lt: 0 },
        descripcion: { contains: glosa },
      },
    })
    if (cargos.length === 0) continue

    // El monto real del banco por mes reemplaza a la proyección del Excel.
    const porMes = new Map<number, { suma: number; ids: string[] }>()
    for (const c of cargos) {
      const e = porMes.get(c.mes) ?? { suma: 0, ids: [] }
      e.suma += Math.abs(c.monto)
      e.ids.push(c.id)
      porMes.set(c.mes, e)
    }

    for (const [mes, e] of porMes) {
      const existente = await prisma.movimiento.findFirst({
        where: { proveedorId: prov.id, anio: 2026, mes },
      })
      const idExterno = `banco:${prov.id}:2026-${String(mes).padStart(2, '0')}`
      const descripcion = `${prov.nombre} · ${e.ids.length} ${e.ids.length === 1 ? 'cargo' : 'cargos'} del banco`

      if (firme) {
        let movimientoId: string
        if (existente) {
          // Ya hay movimiento del mes: se le suma lo que aporta esta glosa, porque
          // un proveedor puede tener varias glosas distintas en el mismo mes.
          const yaDelBanco = existente.fuente === 'cartola'
          await prisma.movimiento.update({
            where: { id: existente.id },
            data: {
              montoCLP: yaDelBanco ? existente.montoCLP + e.suma : e.suma,
              fuente: 'cartola',
              descripcion: yaDelBanco ? existente.descripcion : descripcion,
            },
          })
          movimientoId = existente.id
        } else {
          const creado = await prisma.movimiento.create({
            data: {
              fecha: new Date(Date.UTC(2026, mes - 1, 1)),
              mes,
              anio: 2026,
              montoCLP: e.suma,
              monedaOriginal: 'CLP',
              proveedorId: prov.id,
              categoriaId: prov.categoriaId,
              descripcion,
              fuente: 'cartola',
              idExterno,
              estado: 'confirmado',
            },
          })
          movimientoId = creado.id
        }
        await prisma.movimientoBancario.updateMany({
          where: { id: { in: e.ids } },
          data: {
            estadoConciliacion: 'conciliado',
            movimientoId,
            proveedorSugerido: prov.nombre,
            viaConciliacion: 'alias',
            notaConciliacion: `${prov.nombre} · resuelto en lote`,
          },
        })
      }
      cambios.push({
        tipo: 'proveedor',
        glosa,
        detalle: `${prov.nombre} (${prov.categoria.nombre}) ${MESES_CORTOS[mes - 1]}${existente ? ' · actualiza' : ' · crea'}`,
        monto: -e.suma,
      })
    }

    if (firme) {
      await prisma.proveedor.update({
        where: { id: prov.id },
        data: { aliasBancarios: escribirRemitentes([...leerRemitentes(prov.aliasBancarios), glosa]) },
      })
    }
  }

  // ------------------------------------------------------ 2. filas manuales
  for (const item of A_FILA_MANUAL) {
    const cat = await prisma.categoria.findFirst({ where: { nombre: item.categoria } })
    if (!cat) continue
    const cargos = await prisma.movimientoBancario.findMany({
      where: { anio: 2026, estadoConciliacion: 'sin_conciliar', descripcion: { contains: item.glosa } },
    })
    if (cargos.length === 0) continue
    if (firme) await asignarAFilaManual(cargos[0]!.descripcion, cat.id, 'reemplazar')
    cambios.push({
      tipo: 'fila manual',
      glosa: item.glosa,
      detalle: `${item.categoria} · ${item.motivo}`,
      monto: cargos.reduce((a, c) => a + c.monto, 0),
    })
  }

  // ------------------------------------------------------ 3. MOLINA OVALLE
  const felipe = buscarProv('Felipe Molina')
  const catNominas = await prisma.categoria.findFirst({ where: { nombre: 'Pago de nóminas' } })
  const catRetiros = await prisma.categoria.findFirst({ where: { nombre: 'Retiros' } })
  const molina = await prisma.movimientoBancario.findMany({
    where: { anio: 2026, estadoConciliacion: 'sin_conciliar', descripcion: { contains: 'MOLINA OVALLE' } },
    orderBy: { fecha: 'asc' },
  })

  for (const c of molina) {
    if (MOLINA_A_MANO.includes(c.monto)) continue

    if (c.monto === REMUNERACION && felipe && catNominas) {
      // El Excel traía 2.500.000, que eran 1.500.000 de remuneración más
      // 1.000.000 de retiro. Se REEMPLAZA por la remuneración real: sumar
      // dejaría el sueldo en 4 millones.
      const existente = await prisma.movimiento.findFirst({
        where: { proveedorId: felipe.id, anio: 2026, mes: c.mes },
      })
      if (firme) {
        let movimientoId: string
        if (existente) {
          await prisma.movimiento.update({
            where: { id: existente.id },
            data: {
              montoCLP: 1_500_000,
              fuente: 'cartola',
              descripcion: 'Felipe Molina · remuneración según liquidación',
            },
          })
          movimientoId = existente.id
        } else {
          const creado = await prisma.movimiento.create({
            data: {
              fecha: c.fecha, mes: c.mes, anio: c.anio, montoCLP: 1_500_000, monedaOriginal: 'CLP',
              proveedorId: felipe.id, categoriaId: catNominas.id,
              descripcion: 'Felipe Molina · remuneración según liquidación',
              fuente: 'cartola', idExterno: `cartola:${c.hash}`, estado: 'confirmado',
            },
          })
          movimientoId = creado.id
        }
        await prisma.movimientoBancario.update({
          where: { id: c.id },
          data: {
            estadoConciliacion: 'conciliado', movimientoId, proveedorSugerido: 'Felipe Molina',
            viaConciliacion: 'regla', notaConciliacion: 'remuneración mensual (regla por monto exacto)',
          },
        })
      }
      cambios.push({
        tipo: 'MOLINA',
        glosa: 'Transf a MOLINA OVALLE',
        detalle: `nóminas Felipe Molina ${MESES_CORTOS[c.mes - 1]}${existente ? ` · reemplaza ${fmt(existente.montoCLP)}` : ' · crea'}`,
        monto: c.monto,
      })
      continue
    }

    if (catRetiros) {
      if (firme) {
        const mov = await prisma.movimiento.upsert({
          where: { idExterno: `cartola:${c.hash}` },
          create: {
            fecha: c.fecha, mes: c.mes, anio: c.anio, montoCLP: Math.abs(c.monto), monedaOriginal: 'CLP',
            proveedorId: null, categoriaId: catRetiros.id,
            descripcion: `Retiro · transferencia a MOLINA OVALLE`,
            fuente: 'cartola', idExterno: `cartola:${c.hash}`, estado: 'confirmado',
          },
          update: { montoCLP: Math.abs(c.monto) },
        })
        await prisma.movimientoBancario.update({
          where: { id: c.id },
          data: {
            estadoConciliacion: 'conciliado', movimientoId: mov.id,
            viaConciliacion: 'regla', notaConciliacion: 'retiro (regla general de MOLINA OVALLE)',
          },
        })
      }
      cambios.push({
        tipo: 'MOLINA',
        glosa: 'Transf a MOLINA OVALLE',
        detalle: `Retiros ${MESES_CORTOS[c.mes - 1]} · crea`,
        monto: c.monto,
      })
    }
  }

  // ---------------------------------------------------------------- reporte
  const porTipo = new Map<string, { n: number; monto: number }>()
  for (const c of cambios) {
    const e = porTipo.get(c.tipo) ?? { n: 0, monto: 0 }
    e.n += 1
    e.monto += c.monto
    porTipo.set(c.tipo, e)
  }
  console.log('═'.repeat(92))
  console.log('RESUELTO')
  console.log('═'.repeat(92))
  console.log(izq('Glosa', 34) + izq('Qué se hizo', 44) + der('Monto', 13))
  console.log('─'.repeat(92))
  for (const c of cambios) console.log(izq(c.glosa, 34) + izq(c.detalle, 44) + der(fmt(c.monto), 13))
  console.log('─'.repeat(92))
  for (const [tipo, e] of porTipo) console.log(`  ${izq(tipo, 14)} ${e.n} operaciones · ${fmt(e.monto)}`)

  if (!firme) {
    console.log(`\nSIMULACIÓN: ${cambios.length} operaciones. Nada escrito.`)
    return
  }
  console.log(`\nLISTO: ${cambios.length} operaciones aplicadas.`)
  console.log(`  Sin conciliar: ${await prisma.movimientoBancario.count({ where: { anio: 2026, estadoConciliacion: 'sin_conciliar' } })}`)
}

main()
  .catch((e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
