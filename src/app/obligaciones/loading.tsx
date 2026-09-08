import { Esqueleto, TarjetaCargando } from '@/componentes/ui'

export default function Cargando() {
  return (
    <div className="mx-auto max-w-[1120px] px-e5 py-e5">
      <div className="mb-e5">
        <Esqueleto alto={18} ancho="150px" />
        <div className="mt-e2">
          <Esqueleto alto={11} ancho="320px" />
        </div>
      </div>
      <div className="grid gap-e3">
        <TarjetaCargando filas={1} />
        <TarjetaCargando filas={5} />
        <TarjetaCargando filas={6} />
      </div>
    </div>
  )
}
