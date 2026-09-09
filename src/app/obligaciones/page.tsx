import { estadoObligaciones } from '@/lib/obligaciones'
import { PanelObligaciones } from './PanelObligaciones'

export const dynamic = 'force-dynamic'

export default async function PaginaObligaciones() {
  const estado = await estadoObligaciones()
  const ahora = new Date()
  // La fecha se calcula en el servidor y viaja como número: el componente cliente
  // no puede usar `new Date()` sin arriesgar un desajuste con el huso del navegador.
  return (
    <PanelObligaciones
      estado={estado}
      hoy={{ anio: ahora.getFullYear(), mes: ahora.getMonth() + 1 }}
    />
  )
}
