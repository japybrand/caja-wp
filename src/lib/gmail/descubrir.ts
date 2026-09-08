import 'server-only'
import { prisma } from '@/lib/prisma'
import { clienteGmail, cabecera, partirRemitente, enTandas, conReintento } from './cliente'

/**
 * Descubrimiento de remitentes.
 *
 * Para cada proveedor activo sin remitentes cargados, busca en Gmail por su nombre
 * en los últimos 12 meses, agrupa los remitentes que aparecen y guarda los
 * candidatos con estado "propuesto". Nada llega a Proveedor.remitentesEmail hasta
 * que una persona aprueba desde /proveedores.
 */

/** Cuántos mensajes se miran por proveedor. Suficiente para que la frecuencia signifique algo. */
const MENSAJES_POR_PROVEEDOR = 15

/**
 * Ritmo. Gmail cobra 5 unidades de cuota por cada messages.list y messages.get, con
 * un techo de 250 unidades por segundo por usuario. Cada proveedor cuesta
 * 1 list + 15 get = 80 unidades, asi que dos proveedores a la vez con una pausa
 * entre tandas deja harto margen. Con 5 en paralelo y sin pausa, Gmail devolvia
 * 429 a partir del proveedor 33.
 */
const PROVEEDORES_EN_PARALELO = 2
const PAUSA_ENTRE_PROVEEDORES_MS = 700
const MENSAJES_EN_PARALELO = 3
const PAUSA_ENTRE_MENSAJES_MS = 250

/**
 * Remitentes que nunca son un proveedor: la propia cuenta, y el ruido habitual de
 * Google que aparece al buscar casi cualquier palabra.
 */
const DOMINIOS_IGNORADOS = [
  'google.com',
  'googlemail.com',
  'accounts.google.com',
  'mail.google.com',
]

export interface ResumenDescubrimiento {
  proveedoresBuscados: number
  proveedoresConCandidatos: number
  candidatosNuevos: number
  errores: { proveedor: string; detalle: string }[]
}

/** Escapa las comillas para que el nombre viaje como una frase exacta en la query. */
function frase(nombre: string): string {
  return `"${nombre.replace(/"/g, '')}"`
}

export async function descubrirRemitentes(
  opciones: { soloProveedorId?: string } = {},
): Promise<ResumenDescubrimiento> {
  const { gmail, email: cuentaPropia } = await clienteGmail()

  const proveedores = await prisma.proveedor.findMany({
    where: opciones.soloProveedorId
      ? { id: opciones.soloProveedorId }
      : { activo: true, remitentesEmail: '[]' },
    orderBy: { nombre: 'asc' },
  })

  const resumen: ResumenDescubrimiento = {
    proveedoresBuscados: proveedores.length,
    proveedoresConCandidatos: 0,
    candidatosNuevos: 0,
    errores: [],
  }

  const ignorados = new Set([cuentaPropia.toLowerCase()])

  await enTandas(
    proveedores,
    PROVEEDORES_EN_PARALELO,
    async (proveedor) => {
    try {
      const listado = await conReintento(() =>
        gmail.users.messages.list({
          userId: 'me',
          q: `${frase(proveedor.nombre)} newer_than:365d`,
          maxResults: MENSAJES_POR_PROVEEDOR,
        }),
      )

      const ids = (listado.data.messages ?? [])
        .map((m) => m.id)
        .filter((id): id is string => Boolean(id))
      if (ids.length === 0) return

      // Solo cabeceras: no hace falta bajar el cuerpo para agrupar remitentes.
      const mensajes = await enTandas(
        ids,
        MENSAJES_EN_PARALELO,
        async (id) => {
          const respuesta = await conReintento(() =>
            gmail.users.messages.get({
              userId: 'me',
              id,
              format: 'metadata',
              metadataHeaders: ['From', 'Subject', 'Date'],
            }),
          )
          return respuesta.data
        },
        PAUSA_ENTRE_MENSAJES_MS,
      )

      // email -> acumulado
      const porRemitente = new Map<
        string,
        { nombre: string; cantidad: number; asunto: string; ultimo: Date }
      >()

      for (const mensaje of mensajes) {
        const { email, nombre } = partirRemitente(cabecera(mensaje, 'From'))
        if (email === '' || ignorados.has(email)) continue
        if (DOMINIOS_IGNORADOS.some((d) => email.endsWith('@' + d))) continue

        const asunto = cabecera(mensaje, 'Subject')
        const fecha = mensaje.internalDate
          ? new Date(Number(mensaje.internalDate))
          : new Date(cabecera(mensaje, 'Date'))
        const fechaValida = Number.isNaN(fecha.getTime()) ? new Date() : fecha

        const previo = porRemitente.get(email)
        if (previo) {
          previo.cantidad += 1
          if (fechaValida > previo.ultimo) {
            previo.ultimo = fechaValida
            previo.asunto = asunto || previo.asunto
          }
        } else {
          porRemitente.set(email, {
            nombre,
            cantidad: 1,
            asunto,
            ultimo: fechaValida,
          })
        }
      }

      if (porRemitente.size === 0) return
      resumen.proveedoresConCandidatos += 1

      for (const [email, datos] of porRemitente) {
        const existente = await prisma.remitenteCandidato.findUnique({
          where: { proveedorId_email: { proveedorId: proveedor.id, email } },
        })
        await prisma.remitenteCandidato.upsert({
          where: { proveedorId_email: { proveedorId: proveedor.id, email } },
          create: {
            proveedorId: proveedor.id,
            email,
            nombreDe: datos.nombre || null,
            cantidad: datos.cantidad,
            asuntoEjemplo: datos.asunto.slice(0, 200),
            ultimoCorreo: datos.ultimo,
            estado: 'propuesto',
          },
          // Un candidato ya aprobado o descartado conserva su estado.
          update: {
            cantidad: datos.cantidad,
            asuntoEjemplo: datos.asunto.slice(0, 200),
            ultimoCorreo: datos.ultimo,
            nombreDe: datos.nombre || null,
            buscadoEn: new Date(),
          },
        })
        if (!existente) resumen.candidatosNuevos += 1
      }
    } catch (error: unknown) {
        resumen.errores.push({
          proveedor: proveedor.nombre,
          detalle: error instanceof Error ? error.message : String(error),
        })
      }
    },
    PAUSA_ENTRE_PROVEEDORES_MS,
  )

  return resumen
}
