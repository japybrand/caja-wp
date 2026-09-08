import { ANIO_ACTIVO } from '@/lib/dominio'
import { estadoDeCarga } from './acciones'
import { PanelCargar } from './PanelCargar'

export const dynamic = 'force-dynamic'

export default async function PaginaCargar() {
  const estado = await estadoDeCarga(ANIO_ACTIVO)
  const hoy = new Date()

  return (
    <PanelCargar
      anio={ANIO_ACTIVO}
      estado={estado}
      hoy={{ dia: hoy.getDate(), mes: hoy.getMonth() + 1, anio: hoy.getFullYear() }}
    />
  )
}
