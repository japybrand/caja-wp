// Diagnostico rapido del estado de la conexion con Gmail y del descubrimiento.
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const c = await p.cuentaGoogle.findMany({ select: { email: true, scope: true, creadoEn: true } })
console.log('CuentaGoogle:', c.length)
for (const x of c) {
  console.log('  email :', x.email)
  console.log('  scope :', x.scope)
  console.log('  creada:', x.creadoEn.toISOString())
}
console.log('Proveedores activos sin remitentes:', await p.proveedor.count({ where: { activo: true, remitentesEmail: '[]' } }))
console.log('Candidatos guardados            :', await p.remitenteCandidato.count())
await p.$disconnect()
