import { estadoObligaciones } from '@/lib/obligaciones'
import { PanelObligaciones } from './PanelObligaciones'

export const dynamic = 'force-dynamic'

export default async function PaginaObligaciones() {
  const estado = await estadoObligaciones()
  return <PanelObligaciones estado={estado} />
}
