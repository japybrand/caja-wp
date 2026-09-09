import 'server-only'
import { prisma } from '@/lib/prisma'
import { compromisoQueDuplica } from '@/lib/duplicados'
import { leerRemitentes } from '@/lib/dominio'
import { clienteGmail, cabecera, partirRemitente, conReintento, enTandas } from '@/lib/gmail/cliente'
import { extraerContenido } from '@/lib/gmail/contenido'
import { extraerRecibo } from '@/lib/extraccion/extraer'
import { aPesos } from '@/lib/cambio'

/**
 * Ingesta: correos de Gmail -> movimientos.
 *
 * Busca correos de remitentes ya aprobados en algún proveedor activo, extrae el
 * recibo con el modelo y crea el Movimiento. Cada correo queda registrado en
 * CorreoProcesado con su gmailId, así que la siguiente corrida no lo vuelve a mirar.
 */

/** Confianza mínima para dar un movimiento por confirmado sin que lo mire nadie. */
const CONFIANZA_PARA_CONFIRMAR = 0.85
/** Dos montos del mismo proveedor y mes que difieran menos que esto son sospechosos. */
const TOLERANCIA_DUPLICADO = 0.01
/** Correos por tanda. El cuello de botella es el modelo, no Gmail. */
const CORREOS_EN_PARALELO = 3
const PAUSA_ENTRE_CORREOS_MS = 400
/** Techo por corrida, para que una primera sincronización no se dispare sola. */
const MAX_CORREOS_POR_CORRIDA = 200

/**
 * Categorías cuyos proveedores emiten a fin de mes y cobran a principios del
 * siguiente. Para ellas, una factura recibida ya cuenta como pago previsto.
 */
const CATEGORIAS_CON_FACTURA_POR_PAGAR = [
  'Pago de servicios Internacional',
  'Pago de servicios a honorarios',
]

/** Confianza mínima para aceptar la elección de proveedor entre varios candidatos. */
const CONFIANZA_PARA_ELEGIR_PROVEEDOR = 0.7
/** Día en que se pagan esas facturas. */
const DIA_DE_PAGO = 5
/**
 * Una factura que llega hasta este día del mes corresponde al mes anterior y se
 * paga el 5 de ESE mismo mes; la que llega después se paga el 5 del siguiente.
 * Las facturas llegan alrededor del 31, así que el corte tiene harto margen.
 */
const DIA_CORTE_FACTURA = 10

/** El 5 del mes que corresponde, según cuándo llegó la factura. */
function fechaDePagoPrevisto(llegada: Date): Date {
  const anio = llegada.getUTCFullYear()
  const mes = llegada.getUTCMonth()
  return llegada.getUTCDate() <= DIA_CORTE_FACTURA
    ? new Date(Date.UTC(anio, mes, DIA_DE_PAGO))
    : new Date(Date.UTC(anio, mes + 1, DIA_DE_PAGO))
}

export interface OpcionesIngesta {
  origen: 'cron' | 'manual'
  /** Ventana hacia atrás. La ingesta normal mira 7 días. */
  dias?: number
  /** Rango explícito, para rellenar un mes concreto. Gana sobre `dias`. */
  desde?: Date
  hasta?: Date
  /** Primera corrida: nada se confirma solo, todo queda por revisar. */
  forzarRevision?: boolean
}

export interface ResultadoIngesta {
  sincronizacionId: string
  correosVistos: number
  yaProcesados: number
  creados: number
  porRevisar: number
  confirmados: number
  sinMonto: number
  errores: number
  detalle: {
    gmailId: string
    remitente: string
    proveedor: string
    asunto: string
    fecha: string
    resultado: string
    montoCLP?: number
    moneda?: string
    montoOriginal?: number
    confianza?: number
    nota?: string
  }[]
}

/** `after:AAAA/MM/DD` es el formato que entiende la búsqueda de Gmail. */
function comoConsulta(fecha: Date): string {
  return `${fecha.getUTCFullYear()}/${String(fecha.getUTCMonth() + 1).padStart(2, '0')}/${String(
    fecha.getUTCDate(),
  ).padStart(2, '0')}`
}

export async function ejecutarIngesta(opciones: OpcionesIngesta): Promise<ResultadoIngesta> {
  const { gmail } = await clienteGmail()

  const sincronizacion = await prisma.sincronizacion.create({
    data: { origen: opciones.origen },
  })

  const resultado: ResultadoIngesta = {
    sincronizacionId: sincronizacion.id,
    correosVistos: 0,
    yaProcesados: 0,
    creados: 0,
    porRevisar: 0,
    confirmados: 0,
    sinMonto: 0,
    errores: 0,
    detalle: [],
  }

  try {
    // --- 1. Remitente -> proveedor -------------------------------------------
    const proveedores = await prisma.proveedor.findMany({
      where: { activo: true },
      // El orden importa: define de forma estable a qué proveedor se asigna un
      // remitente compartido. Sin orderBy, Prisma no garantiza el mismo resultado
      // entre corridas y el mismo correo podría caer en un proveedor distinto.
      orderBy: { nombre: 'asc' },
      include: { categoria: { select: { id: true, nombre: true, esManual: true } } },
    })

    /**
     * Un remitente puede estar aprobado en más de un proveedor: los procesadores de
     * pago como PayPal facturan por cuenta de varias empresas. En ese caso se asigna
     * el primero por orden alfabético, pero el movimiento va SIEMPRE a revisión con
     * la lista de candidatos, porque el remitente por sí solo no alcanza para saber
     * de cuál es el cobro. El campo productoMencionado del modelo dice cuál era.
     */
    const porRemitente = new Map<string, (typeof proveedores)[number][]>()
    for (const proveedor of proveedores) {
      // Una fila manual del flujo no admite movimientos: se contaría dos veces.
      if (proveedor.categoria.esManual) continue
      for (const remitente of leerRemitentes(proveedor.remitentesEmail)) {
        const lista = porRemitente.get(remitente)
        if (lista) lista.push(proveedor)
        else porRemitente.set(remitente, [proveedor])
      }
    }

    if (porRemitente.size === 0) {
      await cerrar(sincronizacion.id, resultado, 'Ningún proveedor activo tiene remitentes aprobados.')
      return resultado
    }

    // --- 2. Búsqueda en Gmail -------------------------------------------------
    const desde =
      opciones.desde ??
      (() => {
        const d = new Date()
        d.setUTCDate(d.getUTCDate() - (opciones.dias ?? 7))
        return d
      })()

    const remitentes = [...porRemitente.keys()]
    const filtroFrom = remitentes.map((r) => `from:${r}`).join(' OR ')
    const partesConsulta = [`(${filtroFrom})`, `after:${comoConsulta(desde)}`]
    if (opciones.hasta) partesConsulta.push(`before:${comoConsulta(opciones.hasta)}`)

    const ids: string[] = []
    let pagina: string | undefined
    do {
      const listado = await conReintento(() =>
        gmail.users.messages.list({
          userId: 'me',
          q: partesConsulta.join(' '),
          maxResults: 100,
          pageToken: pagina,
        }),
      )
      for (const m of listado.data.messages ?? []) if (m.id) ids.push(m.id)
      pagina = listado.data.nextPageToken ?? undefined
    } while (pagina && ids.length < MAX_CORREOS_POR_CORRIDA)

    const aProcesar = ids.slice(0, MAX_CORREOS_POR_CORRIDA)
    resultado.correosVistos = aProcesar.length

    // --- 3. Uno por uno -------------------------------------------------------
    await enTandas(
      aProcesar,
      CORREOS_EN_PARALELO,
      async (gmailId) => {
        try {
          const yaVisto = await prisma.correoProcesado.findUnique({ where: { gmailId } })
          if (yaVisto) {
            resultado.yaProcesados += 1
            return
          }

          const mensaje = await conReintento(() =>
            gmail.users.messages.get({ userId: 'me', id: gmailId, format: 'full' }),
          )
          const datosMensaje = mensaje.data

          const from = cabecera(datosMensaje, 'From')
          const { email: remitente } = partirRemitente(from)
          const asunto = cabecera(datosMensaje, 'Subject')
          const fechaCorreo = datosMensaje.internalDate
            ? new Date(Number(datosMensaje.internalDate))
            : new Date()

          const candidatos = porRemitente.get(remitente) ?? []
          const primero = candidatos[0]
          const remitenteCompartido = candidatos.length > 1
          if (!primero) {
            // Gmail hace match laxo en from:; si el remitente no está aprobado, se ignora.
            await prisma.correoProcesado.create({
              data: {
                gmailId,
                threadId: datosMensaje.threadId ?? null,
                remitente,
                asunto,
                fecha: fechaCorreo,
                estado: 'ignorado',
                detalleError: 'El remitente no está aprobado en ningún proveedor activo.',
              },
            })
            resultado.detalle.push({
              gmailId,
              remitente,
              proveedor: '—',
              asunto,
              fecha: fechaCorreo.toISOString().slice(0, 10),
              resultado: 'ignorado (remitente no aprobado)',
            })
            return
          }

          const contenido = await extraerContenido(gmail, datosMensaje)

          const extraccion = await extraerRecibo({
            proveedores: candidatos.map((c) => ({
              nombre: c.nombre,
              categoria: c.categoria.nombre,
              monedaDefecto: c.monedaDefecto,
            })),
            // Si alguno de los candidatos admite facturas por pagar, se permite:
            // que el correo caiga en el proveedor correcto lo decide la elección.
            aceptaFacturaPorPagar: candidatos.some((c) =>
              CATEGORIAS_CON_FACTURA_POR_PAGAR.includes(c.categoria.nombre),
            ),
            remitente: from,
            asunto,
            fecha: fechaCorreo.toISOString().slice(0, 10),
            texto: contenido.texto,
            pdf: contenido.pdf,
          })

          // Antes de la elección solo se conoce el primer candidato; después se usa
          // `conProveedor` para que el correo quede colgado del proveedor definitivo.
          const base = {
            gmailId,
            threadId: datosMensaje.threadId ?? null,
            remitente,
            asunto,
            fecha: fechaCorreo,
            proveedorId: primero.id,
            respuestaModelo: extraccion.crudo || null,
          }

          if (!extraccion.ok || !extraccion.datos) {
            await prisma.correoProcesado.create({
              data: { ...base, estado: 'error', detalleError: extraccion.error ?? 'Falló la extracción.' },
            })
            resultado.errores += 1
            resultado.detalle.push({
              gmailId,
              remitente,
              proveedor: primero.nombre,
              asunto,
              fecha: fechaCorreo.toISOString().slice(0, 10),
              resultado: 'error',
              nota: extraccion.error,
            })
            return
          }

          const d = extraccion.datos

          /**
           * Con un solo candidato, ese es. Con varios, manda la elección del modelo
           * siempre que venga con confianza: es una elección dentro de un conjunto
           * cerrado y ya aprobado, no una adivinanza. Si no logra decidir, se usa el
           * primero por orden alfabético y el movimiento va a revisión.
           */
          const elegido = remitenteCompartido
            ? candidatos.find(
                (c) => c.nombre.toLowerCase() === d.proveedorElegido.trim().toLowerCase(),
              )
            : primero
          const eleccionFirme =
            !remitenteCompartido ||
            (elegido !== undefined && d.confianzaProveedor >= CONFIANZA_PARA_ELEGIR_PROVEEDOR)
          const proveedor = eleccionFirme && elegido ? elegido : primero
          const conProveedor = { ...base, proveedorId: proveedor.id }

          if (!d.esRecibo || d.monto <= 0) {
            await prisma.correoProcesado.create({
              data: {
                ...conProveedor,
                estado: 'sin_monto',
                detalleError: d.esRecibo ? 'Recibo sin monto.' : 'No es un cobro efectuado.',
              },
            })
            resultado.sinMonto += 1
            resultado.detalle.push({
              gmailId,
              remitente,
              proveedor: proveedor.nombre,
              asunto,
              fecha: fechaCorreo.toISOString().slice(0, 10),
              resultado: d.esRecibo ? 'sin monto' : 'no es recibo',
              confianza: d.confianza,
            })
            return
          }

          // --- Fecha y conversión -------------------------------------------
          const fechaCobro = /^\d{4}-\d{2}-\d{2}$/.test(d.fecha)
            ? new Date(`${d.fecha}T00:00:00.000Z`)
            : fechaCorreo
          let fechaValida = Number.isNaN(fechaCobro.getTime()) ? fechaCorreo : fechaCobro

          // La factura de un colaborador llega a fin de mes y se paga el 5 del
          // siguiente: el movimiento va con la fecha del pago, no la de la factura.
          const esPagoPrevisto =
            d.tipoDocumento === 'factura_por_pagar' &&
            CATEGORIAS_CON_FACTURA_POR_PAGAR.includes(proveedor.categoria.nombre)
          // Se calcula desde la llegada del correo, no desde la fecha que dio el
          // modelo: "Factura Agosto" que llega el 1 de septiembre se paga el 5 de
          // septiembre, no el 5 de octubre.
          if (esPagoPrevisto) fechaValida = fechaDePagoPrevisto(fechaCorreo)

          const conversion = await aPesos(
            d.monto,
            d.moneda,
            esPagoPrevisto ? fechaCorreo : fechaValida,
          )
          if (conversion.error) {
            await prisma.correoProcesado.create({
              data: { ...conProveedor, estado: 'error', detalleError: conversion.error },
            })
            resultado.errores += 1
            resultado.detalle.push({
              gmailId,
              remitente,
              proveedor: proveedor.nombre,
              asunto,
              fecha: fechaValida.toISOString().slice(0, 10),
              resultado: 'error de tipo de cambio',
              nota: conversion.error,
            })
            return
          }

          const mes = fechaValida.getUTCMonth() + 1
          const anio = fechaValida.getUTCFullYear()

          // --- Anti-duplicado ------------------------------------------------
          // Enero a septiembre ya vienen del Excel: la primera corrida va a
          // encontrar esos mismos recibos y no debe confirmarlos de nuevo.
          const delMismoMes = await prisma.movimiento.findMany({
            where: { proveedorId: proveedor.id, anio, mes },
            select: { id: true, montoCLP: true, fuente: true },
          })
          const duplicado = delMismoMes.find((m) => {
            if (m.montoCLP === conversion.montoCLP) return true
            const mayor = Math.max(Math.abs(m.montoCLP), Math.abs(conversion.montoCLP))
            if (mayor === 0) return false
            return Math.abs(m.montoCLP - conversion.montoCLP) / mayor <= TOLERANCIA_DUPLICADO
          })

          // Un compromiso declarado es la misma deuda registrada en el mes en que se
          // paga. Se busca aparte porque el anti-duplicado de arriba mira solo el mes
          // del movimiento, y la factura puede llegar uno o dos meses antes.
          const compromiso = await compromisoQueDuplica({
            anio,
            proveedorId: proveedor.id,
            montoCLP: conversion.montoCLP,
            montoOriginal: d.moneda === 'CLP' ? null : d.monto,
            monedaOriginal: d.moneda,
          })

          const notas: string[] = []
          if (esPagoPrevisto) {
            notas.push(
              `pago previsto: factura recibida el ${(datosMensaje.internalDate
                ? new Date(Number(datosMensaje.internalDate))
                : fechaCorreo
              )
                .toISOString()
                .slice(0, 10)}, se paga el ${fechaValida.toISOString().slice(0, 10)}`,
            )
            if (d.moneda === 'USD') {
              notas.push(
                'monto en CLP estimado con el dólar observado; el valor real sale de la cartola ' +
                  '(los pagos internacionales pasan por Global66, con su propio tipo de cambio)',
              )
            }
          }
          if (duplicado) notas.push(`posible duplicado de ${duplicado.id}`)
          if (compromiso) notas.push(compromiso.motivo)
          if (remitenteCompartido && !eleccionFirme) {
            notas.push(
              `remitente compartido: el modelo no pudo decidir entre ${candidatos
                .map((c) => c.nombre)
                .join(', ')} (confianza ${d.confianzaProveedor.toFixed(2)}); ` +
                `se asignó a ${proveedor.nombre}, verifícalo`,
            )
          } else if (remitenteCompartido) {
            notas.push(
              `remitente compartido: el modelo eligió ${proveedor.nombre} ` +
                `con confianza ${d.confianzaProveedor.toFixed(2)}`,
            )
          }
          if (!d.coincideConProveedor) {
            notas.push(
              `el correo cobra por "${d.productoMencionado || 'otro producto'}", no por ${proveedor.nombre}`,
            )
          }
          if (d.periodoServicio) notas.push(d.periodoServicio)

          const confiable =
            d.confianza >= CONFIANZA_PARA_CONFIRMAR &&
            conversion.montoCLP > 0 &&
            !duplicado &&
            // Nunca se confirma solo algo que repite una deuda ya declarada.
            !compromiso &&
            d.coincideConProveedor &&
            eleccionFirme &&
            // Un pago previsto nunca se confirma solo: todavía no ha salido la plata.
            !esPagoPrevisto
          const estado = opciones.forzarRevision || !confiable ? 'por_revisar' : 'confirmado'

          const prefijos: string[] = []
          if (esPagoPrevisto) {
            prefijos.push(d.moneda === 'USD' ? 'PAGO PREVISTO (CLP estimado)' : 'PAGO PREVISTO')
          }
          if (duplicado) prefijos.push(`posible duplicado de ${duplicado.id}`)
          if (compromiso) prefijos.push('DUPLICA UN COMPROMISO DECLARADO')
          const descripcion = [...prefijos, d.descripcion].join(' · ').slice(0, 200)

          const movimiento = await prisma.movimiento.create({
            data: {
              fecha: fechaValida,
              mes,
              anio,
              montoCLP: conversion.montoCLP,
              monedaOriginal: d.moneda,
              montoOriginal: d.moneda === 'CLP' ? null : d.monto,
              proveedorId: proveedor.id,
              categoriaId: proveedor.categoriaId,
              descripcion,
              fuente: 'gmail',
              idExterno: gmailId,
              estado,
            },
          })

          await prisma.correoProcesado.create({
            data: {
              ...conProveedor,
              estado: 'procesado',
              movimientoId: movimiento.id,
              detalleError: [...notas, ...contenido.avisos].join(' · ') || null,
            },
          })

          resultado.creados += 1
          if (estado === 'por_revisar') resultado.porRevisar += 1
          else resultado.confirmados += 1
          resultado.detalle.push({
            gmailId,
            remitente,
            proveedor: proveedor.nombre,
            asunto,
            fecha: fechaValida.toISOString().slice(0, 10),
            resultado: estado,
            montoCLP: conversion.montoCLP,
            moneda: d.moneda,
            ...(d.moneda === 'USD' ? { montoOriginal: d.monto } : {}),
            confianza: d.confianza,
            ...(notas.length > 0 ? { nota: notas.join(' · ') } : {}),
          })
        } catch (error: unknown) {
          resultado.errores += 1
          const detalle = error instanceof Error ? error.message : String(error)
          await prisma.correoProcesado
            .create({
              data: {
                gmailId,
                remitente: '',
                asunto: '',
                fecha: new Date(),
                estado: 'error',
                detalleError: detalle,
              },
            })
            .catch(() => undefined)
          resultado.detalle.push({
            gmailId,
            remitente: '',
            proveedor: '—',
            asunto: '',
            fecha: '',
            resultado: 'error',
            nota: detalle,
          })
        }
      },
      PAUSA_ENTRE_CORREOS_MS,
    )

    await cerrar(sincronizacion.id, resultado, null)
    return resultado
  } catch (error: unknown) {
    const detalle = error instanceof Error ? error.message : String(error)
    await cerrar(sincronizacion.id, resultado, detalle)
    throw error
  }
}

async function cerrar(
  id: string,
  resultado: ResultadoIngesta,
  detalleError: string | null,
): Promise<void> {
  await prisma.sincronizacion.update({
    where: { id },
    data: {
      terminadaEn: new Date(),
      correosVistos: resultado.correosVistos,
      creados: resultado.creados,
      porRevisar: resultado.porRevisar,
      sinMonto: resultado.sinMonto,
      errores: resultado.errores,
      detalleError,
    },
  })
}
