import { Esqueleto, TarjetaCargando } from '@/componentes/ui'

/**
 * Lo que se ve mientras el panel calcula.
 *
 * Reproduce la composición real —bloque principal, zona urgente, panorama— para
 * que nada salte de lugar cuando llegan los datos. Un spinner centrado dejaría la
 * página en blanco y obligaría a redibujar todo de golpe.
 */
export default function Cargando() {
  return (
    <div className="mx-auto max-w-[1120px] px-e5 py-e5">
      <div className="mb-e5">
        <Esqueleto alto={18} ancho="180px" />
        <div className="mt-e2">
          <Esqueleto alto={11} ancho="240px" />
        </div>
      </div>

      {/* El bloque principal también en oscuro: si apareciera claro, la pantalla
          cambiaría de peso visual al cargar. */}
      <div className="tarjeta-principal px-e4 py-e4">
        <div className="grid gap-e6 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i}>
              <div className="h-2.5 w-24 rounded bg-acento-linea" />
              <div className="mt-e3 h-8 w-40 rounded bg-acento-linea" />
              <div className="mt-e2 h-3 w-32 rounded bg-acento-linea" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-e6">
        <Esqueleto alto={11} ancho="140px" />
        <div className="mt-e3 grid gap-e3 lg:grid-cols-2">
          <TarjetaCargando filas={3} />
          <TarjetaCargando filas={4} />
        </div>
      </div>

      <div className="mt-e6">
        <Esqueleto alto={11} ancho="160px" />
        <div className="mt-e3 grid gap-e3 lg:grid-cols-3">
          <TarjetaCargando filas={4} />
          <TarjetaCargando filas={5} />
          <TarjetaCargando filas={4} />
        </div>
      </div>
    </div>
  )
}
