import { calcularPanel } from '@/lib/panel'
import { ANIO_ACTIVO } from '@/lib/dominio'
import { PanelInicio } from './PanelInicio'

export const dynamic = 'force-dynamic'

export default async function PaginaInicio() {
  return <PanelInicio panel={await calcularPanel(ANIO_ACTIVO)} />
}
