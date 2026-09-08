import { PrismaClient } from '@prisma/client'
import { CATEGORIAS } from '../src/lib/catalogo'

const prisma = new PrismaClient()

async function main(): Promise<void> {
  let creadas = 0
  let actualizadas = 0

  for (const definicion of CATEGORIAS) {
    const existente = await prisma.categoria.findUnique({
      where: { grupo_nombre: { grupo: definicion.grupo, nombre: definicion.nombre } },
    })
    await prisma.categoria.upsert({
      where: { grupo_nombre: { grupo: definicion.grupo, nombre: definicion.nombre } },
      create: definicion,
      update: { orden: definicion.orden, esManual: definicion.esManual },
    })
    if (existente) actualizadas += 1
    else creadas += 1
  }

  console.log(
    `Categorías: ${creadas} creadas, ${actualizadas} ya existían (${CATEGORIAS.length} en total).`,
  )
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    void prisma.$disconnect()
  })
