import { componer } from '@/lib/correo/plantilla'
import { enviarCorreo, registrarAviso, yaSeAviso } from '@/lib/correo/enviar'
import { evaluarAlertas, type Regla } from './reglas'

export { evaluarAlertas, enSantiago, type Regla } from './reglas'

export interface ResultadoAlertas {
  evaluadas: number
  enviados: number
  omitidos: number
  fallidos: number
  detalle: { tipo: string; clave: string; asunto: string; estado: string }[]
}

/**
 * Evalúa las cuatro reglas y manda lo que corresponda.
 *
 * `seco` corre todo salvo el envío y el registro: sirve para ver qué saldría un día
 * cualquiera sin gastar correos ni ensuciar `AvisoEnviado`.
 */
export async function ejecutarAlertas({
  hoy = new Date(),
  seco = false,
}: { hoy?: Date; seco?: boolean } = {}): Promise<ResultadoAlertas> {
  const reglas = await evaluarAlertas(hoy)
  const resultado: ResultadoAlertas = {
    evaluadas: reglas.length,
    enviados: 0,
    omitidos: 0,
    fallidos: 0,
    detalle: [],
  }

  for (const regla of reglas) {
    const anota = (estado: string): void => {
      resultado.detalle.push({
        tipo: regla.tipo,
        clave: regla.clave,
        asunto: regla.aviso.asunto,
        estado,
      })
    }

    // Un aviso agrupado cubre varios hechos. Se manda si hay AL MENOS UNO que no se
    // haya avisado antes, y después se registran todos: así entrar algo nuevo dispara
    // un correo con el panorama completo, y marcar cosas como pagadas no dispara
    // ninguno. Con un solo hecho, el comportamiento es el de siempre.
    const claves = regla.claves ?? [regla.clave]
    const nuevas: string[] = []
    for (const clave of claves) {
      if (!(await yaSeAviso(regla.tipo, clave, regla.repetirCadaDias))) nuevas.push(clave)
    }
    if (nuevas.length === 0) {
      resultado.omitidos += 1
      anota('ya avisado')
      continue
    }
    if (seco) {
      resultado.enviados += 1
      anota(`se enviaría (${nuevas.length} de ${claves.length} sin avisar)`)
      continue
    }

    const { ok, error } = await enviarCorreo(componer(regla.aviso))
    // El registro guarda también los fallos: `yaSeAviso` no los cuenta como
    // avisados, así que el aviso se reintenta al día siguiente en vez de perderse.
    for (const clave of claves) {
      await registrarAviso(regla.tipo, clave, regla.aviso.asunto, error)
    }
    if (ok) {
      resultado.enviados += 1
      anota('enviado')
    } else {
      resultado.fallidos += 1
      anota(`falló: ${error.slice(0, 80)}`)
    }
  }

  return resultado
}

/** Solo para la simulación: el correo compuesto, sin mandarlo. */
export function vistaPrevia(regla: Regla): { asunto: string; texto: string } {
  const { asunto, texto } = componer(regla.aviso)
  return { asunto, texto }
}
