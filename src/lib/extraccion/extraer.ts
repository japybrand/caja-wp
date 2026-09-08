import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import {
  EsquemaExtraccion,
  SISTEMA,
  construirMensaje,
  type DatosCorreo,
  type Extraccion,
} from './prompt'

/** El modelo que pidió Japybrand WP para esta tarea. */
export const MODELO = 'claude-sonnet-4-6'

let cliente: Anthropic | null = null
function obtenerCliente(): Anthropic {
  if (!cliente) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('Falta ANTHROPIC_API_KEY.')
    cliente = new Anthropic()
  }
  return cliente
}

export interface ResultadoExtraccion {
  ok: boolean
  datos?: Extraccion
  error?: string
  /** JSON crudo, para guardarlo en CorreoProcesado y poder revisarlo después. */
  crudo: string
}

export async function extraerRecibo(datos: DatosCorreo): Promise<ResultadoExtraccion> {
  try {
    const respuesta = await obtenerCliente().messages.parse({
      model: MODELO,
      max_tokens: 4000,
      // Distinguir un cobro de un aviso de renovación pide algo de criterio,
      // pero no es una tarea de razonamiento profundo.
      thinking: { type: 'adaptive' },
      system: [
        {
          type: 'text',
          text: SISTEMA,
          // El sistema es idéntico para todos los correos de una corrida.
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        effort: 'low',
        format: zodOutputFormat(EsquemaExtraccion),
      },
      messages: [{ role: 'user', content: construirMensaje(datos) }],
    })

    if (respuesta.stop_reason === 'refusal') {
      return {
        ok: false,
        error: 'El modelo se negó a procesar el correo.',
        crudo: JSON.stringify({ stop_reason: respuesta.stop_reason, stop_details: respuesta.stop_details }),
      }
    }

    const analizado = respuesta.parsed_output
    if (!analizado) {
      const texto = respuesta.content
        .filter((bloque): bloque is Anthropic.TextBlock => bloque.type === 'text')
        .map((bloque) => bloque.text)
        .join('')
      return { ok: false, error: 'El modelo no devolvió el JSON esperado.', crudo: texto.slice(0, 4000) }
    }

    return { ok: true, datos: analizado, crudo: JSON.stringify(analizado) }
  } catch (error: unknown) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'La API de Anthropic está limitando el ritmo (429).', crudo: '' }
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: 'ANTHROPIC_API_KEY inválida.', crudo: '' }
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Error ${error.status} de la API: ${error.message}`, crudo: '' }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      crudo: '',
    }
  }
}
