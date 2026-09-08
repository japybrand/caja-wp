import { TarjetaCargando } from '@/componentes/ui'

/**
 * Lo que se ve mientras el panel calcula.
 *
 * Bloques del mismo tamaño que las tarjetas reales, para que nada salte de lugar
 * cuando llegan los datos. Un spinner centrado dejaría la página en blanco y
 * obligaría a redibujar todo de golpe.
 */
export default function Cargando() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <div className="mb-5">
        <div className="esqueleto" style={{ height: 18, width: 180 }} />
        <div className="esqueleto mt-2" style={{ height: 12, width: 240 }} />
      </div>
      <div className="grid gap-3">
        <TarjetaCargando filas={1} />
        <TarjetaCargando filas={2} />
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <TarjetaCargando filas={4} />
          <TarjetaCargando filas={1} />
        </div>
      </div>
    </div>
  )
}
