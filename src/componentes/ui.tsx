import type { LucideIcon } from 'lucide-react'

/**
 * Piezas compartidas de la interfaz.
 *
 * Existen para que una decisión de estilo se tome una sola vez. Antes cada pantalla
 * elegía su propio `px-2.5 py-1.5` y el conjunto no se veía de una pieza.
 *
 * Reglas que encapsulan:
 *  - El color solo comunica estado. Nada decorativo lleva color.
 *  - Los montos van con ancho de dígito fijo y alineados a la derecha, siempre.
 *  - Los íconos son de 14px y acompañan a un texto; nunca van solos de adorno.
 */

export type Tono = 'neutro' | 'negativo' | 'alerta' | 'positivo'

const TEXTO_TONO: Record<Tono, string> = {
  neutro: '',
  negativo: 'text-negativo',
  alerta: 'text-alerta',
  positivo: 'text-positivo',
}

/** Formato de pesos chilenos. Una sola implementación para toda la app. */
export const clp = (n: number): string =>
  '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

/** Sin el signo, para cuando el contexto ya dice que es plata. */
export const numero = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

/** 2026-09-20 → "20 de septiembre" */
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]
export const fechaEnPalabras = (iso: string): string => {
  const [, m, d] = iso.split('-')
  return `${Number(d)} de ${MESES[Number(m) - 1]}`
}

// ---------------------------------------------------------------------------

export function Pagina({
  titulo,
  bajada,
  acciones,
  children,
}: {
  titulo: string
  bajada?: string
  acciones?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-[16px] font-semibold tracking-[-0.01em]">{titulo}</h1>
          {bajada ? <p className="mt-0.5 text-[12px] text-tenue">{bajada}</p> : null}
        </div>
        {acciones ? <div className="flex items-center gap-3 text-[12px]">{acciones}</div> : null}
      </header>
      {children}
    </div>
  )
}

/** Contenedor blanco sobre el fondo gris. Es la unidad de composición. */
export function Tarjeta({
  titulo,
  icono: Icono,
  bajada,
  tono = 'neutro',
  pie,
  children,
  className = '',
}: {
  titulo?: string
  icono?: LucideIcon
  bajada?: string
  tono?: Tono
  pie?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const borde =
    tono === 'negativo'
      ? 'border-negativo/25'
      : tono === 'alerta'
        ? 'border-alerta/25'
        : 'border-linea'
  return (
    <section className={`tarjeta ${borde} ${className}`}>
      {titulo ? (
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-1">
          {Icono ? <Icono size={14} strokeWidth={2} className={TEXTO_TONO[tono] || 'text-suave'} /> : null}
          <h2 className={`rotulo ${TEXTO_TONO[tono]}`}>{titulo}</h2>
        </div>
      ) : null}
      <div className={titulo ? 'px-4 pb-4' : 'p-4'}>
        {bajada ? <p className="mb-2 text-[12px] text-tenue">{bajada}</p> : null}
        {children}
      </div>
      {pie ? (
        <div className="border-t border-linea px-4 py-2.5 text-[12px] text-tenue">{pie}</div>
      ) : null}
    </section>
  )
}

/** El número grande de una tarjeta, con su explicación debajo. */
export function Titular({
  valor,
  explica,
  tono = 'neutro',
}: {
  valor: string
  explica?: React.ReactNode
  tono?: Tono
}) {
  return (
    <div>
      <div className={`cifra-titular ${TEXTO_TONO[tono]}`}>{valor}</div>
      {explica ? <p className="mt-1 max-w-[58ch] text-[12px] text-tenue">{explica}</p> : null}
    </div>
  )
}

/** Lo que hay que hacer, en imperativo. Siempre con ícono y color de estado. */
export function Accion({
  icono: Icono,
  tono = 'alerta',
  children,
}: {
  icono?: LucideIcon
  tono?: Tono
  children: React.ReactNode
}) {
  return (
    <p className={`mt-3 flex items-start gap-1.5 text-[12px] font-medium ${TEXTO_TONO[tono]}`}>
      {Icono ? <Icono size={14} strokeWidth={2} className="mt-px shrink-0" /> : null}
      <span>{children}</span>
    </p>
  )
}

/** Etiqueta de estado. Sin fondo saturado: un punto de color y el texto. */
export function Marca({ tono = 'neutro', children }: { tono?: Tono; children: React.ReactNode }) {
  const punto =
    tono === 'negativo'
      ? 'bg-negativo'
      : tono === 'alerta'
        ? 'bg-alerta'
        : tono === 'positivo'
          ? 'bg-positivo'
          : 'bg-suave'
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${TEXTO_TONO[tono] || 'text-tenue'}`}>
      <span className={`size-1.5 shrink-0 rounded-full ${punto}`} />
      {children}
    </span>
  )
}

/**
 * Qué mostrar cuando no hay nada.
 *
 * Un vacío puede ser buena noticia —nada atrasado— o falta de datos. Por eso lleva
 * tono: el mismo componente sirve para "estás al día" y para "falta cargar algo".
 */
export function Vacio({
  icono: Icono,
  titulo,
  detalle,
  tono = 'neutro',
}: {
  icono?: LucideIcon
  titulo: string
  detalle?: string
  tono?: Tono
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
      {Icono ? <Icono size={20} strokeWidth={1.5} className={TEXTO_TONO[tono] || 'text-suave'} /> : null}
      <p className={`text-[13px] font-medium ${TEXTO_TONO[tono]}`}>{titulo}</p>
      {detalle ? <p className="max-w-[46ch] text-[12px] text-tenue">{detalle}</p> : null}
    </div>
  )
}

/** Bloque gris que ocupa el lugar del contenido mientras llega. */
export function Esqueleto({ alto = 16, ancho = '100%' }: { alto?: number; ancho?: string }) {
  return <div className="esqueleto" style={{ height: alto, width: ancho }} />
}

/** Tarjeta en carga: mismo tamaño que la real, para que nada salte al llegar. */
export function TarjetaCargando({ filas = 3 }: { filas?: number }) {
  return (
    <div className="tarjeta p-4">
      <Esqueleto alto={11} ancho="35%" />
      <div className="mt-3">
        <Esqueleto alto={26} ancho="45%" />
      </div>
      <div className="mt-4 space-y-2">
        {Array.from({ length: filas }, (_, i) => (
          <Esqueleto key={i} alto={13} ancho={`${90 - i * 12}%`} />
        ))}
      </div>
    </div>
  )
}
