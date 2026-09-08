import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Cifrado simetrico para el refresh token de Google.
 *
 * AES-256-GCM con clave de 32 bytes en ENCRYPTION_KEY (64 caracteres hex).
 * El formato guardado es  iv:authTag:ciphertext,  todo en hex.
 * GCM autentica, asi que un texto manipulado falla al descifrar en vez de
 * devolver basura.
 */

const LARGO_IV = 12 // recomendado para GCM
const ALGORITMO = 'aes-256-gcm'

function obtenerClave(): Buffer {
  const hex = process.env.ENCRYPTION_KEY
  if (!hex) {
    throw new Error('Falta ENCRYPTION_KEY. Generala con: openssl rand -hex 32')
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'ENCRYPTION_KEY debe ser exactamente 64 caracteres hexadecimales (32 bytes) para AES-256.',
    )
  }
  return Buffer.from(hex, 'hex')
}

export function cifrar(textoPlano: string): string {
  const iv = randomBytes(LARGO_IV)
  const cifrador = createCipheriv(ALGORITMO, obtenerClave(), iv)
  const cifrado = Buffer.concat([cifrador.update(textoPlano, 'utf8'), cifrador.final()])
  const etiqueta = cifrador.getAuthTag()
  return [iv.toString('hex'), etiqueta.toString('hex'), cifrado.toString('hex')].join(':')
}

export function descifrar(guardado: string): string {
  const partes = guardado.split(':')
  if (partes.length !== 3) {
    throw new Error('El valor cifrado no tiene el formato iv:authTag:ciphertext.')
  }
  const [ivHex, etiquetaHex, cifradoHex] = partes as [string, string, string]

  const descifrador = createDecipheriv(ALGORITMO, obtenerClave(), Buffer.from(ivHex, 'hex'))
  descifrador.setAuthTag(Buffer.from(etiquetaHex, 'hex'))
  return Buffer.concat([
    descifrador.update(Buffer.from(cifradoHex, 'hex')),
    descifrador.final(),
  ]).toString('utf8')
}
