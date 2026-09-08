import { PrismaClient } from '@prisma/client'

const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalParaPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalParaPrisma.prisma = prisma
