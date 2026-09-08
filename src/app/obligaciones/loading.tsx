import { TarjetaCargando } from '@/componentes/ui'

export default function Cargando() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <div className="mb-5">
        <div className="esqueleto" style={{ height: 18, width: 150 }} />
        <div className="esqueleto mt-2" style={{ height: 12, width: 320 }} />
      </div>
      <div className="grid gap-3">
        <TarjetaCargando filas={1} />
        <TarjetaCargando filas={5} />
        <TarjetaCargando filas={6} />
      </div>
    </div>
  )
}
