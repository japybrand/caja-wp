import type { LucideIcon } from 'lucide-react'

/**
 * Piezas compartidas de la interfaz.
 *
 * Encapsulan tres reglas para que no haya que recordarlas en cada pantalla:
 *
 *  1. La escala tipográfica tiene ocho pasos y cada uno hace una cosa. Nada usa un
 *     tamaño suelto.
 *  2. El color estructura y además comunica estado. La superficie de tinta marca lo
 *     principal, la cálida lo urgente, la blanca lo informativo y el fondo el
 *     detalle. El rojo y el ámbar siguen siendo solo estado.
 *  3. Los montos van con ancho de dígito fijo y alineados a la derecha, siempre.
 */

export type Tono = 'neutro' | 'negativo' | 'alerta' | 'positivo'

/** Sobre superficie clara. */
const TEXTO: Record<Tono, string> = {
  neutro: '',
  negativo: 'text-negativo',
  alerta: 'text-alerta',
  positivo: 'text-positivo',
}

/** Sobre la superficie de tinta hay que aclarar el color o se pierde. */
const TEXTO_INVERSO: Record<Tono, string> = {
  neutro: '',
  negativo: 'text-negativo-claro',
  alerta: 'text-alerta-claro',
  positivo: 'text-positivo-claro',
}

export const clp = (n: number): string =>
  '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

export const numero = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** 2026-09-20 → "20 de septiembre" */
export const fechaEnPalabras = (iso: string): string => {
  const [, m, d] = iso.split('-')
  return `${Number(d)} de ${MESES[Number(m) - 1]}`
}

export const nombreMes = (mes: number): string => MESES[mes - 1] ?? String(mes)

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
    <div className="mx-auto max-w-[1120px] px-e5 py-e5">
      <header className="mb-e5 flex flex-wrap items-baseline justify-between gap-e3">
        <div>
          <h1 className="t-pagina">{titulo}</h1>
          {bajada ? <p className="t-apoyo mt-0.5">{bajada}</p> : null}
        </div>
        {acciones ? (
          <div className="flex items-center gap-e4 text-[12px]">{acciones}</div>
        ) : null}
      </header>
      {children}
    </div>
  )
}

/**
 * Encabezado de zona.
 *
 * Ordena la página en bloques —lo principal, lo urgente, el detalle— sin competir
 * con el contenido: por eso va en el paso más chico de la escala, en versalitas y
 * en gris suave.
 */
export function Zona({
  titulo,
  nota,
  children,
}: {
  titulo: string
  nota?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-e6 first:mt-0">
      <div className="mb-e3 flex items-baseline gap-e3">
        <h2 className="t-zona">{titulo}</h2>
        {nota ? <span className="t-apoyo">{nota}</span> : null}
        <div className="h-px flex-1 bg-linea" />
      </div>
      {children}
    </section>
  )
}

/**
 * Tarjeta.
 *
 * `variante` elige la superficie, y con ella el peso visual:
 *  - 'principal' va en tinta y domina la pantalla. Una sola por página.
 *  - 'urgente' usa el papel cálido de la zona de acción.
 *  - 'normal' es la tarjeta blanca informativa.
 *  - 'plana' no tiene fondo ni borde: para el detalle subordinado.
 */
export function Tarjeta({
  titulo,
  icono: Icono,
  bajada,
  variante = 'normal',
  tono = 'neutro',
  pie,
  children,
  className = '',
}: {
  titulo?: string
  icono?: LucideIcon
  bajada?: string
  variante?: 'principal' | 'urgente' | 'normal' | 'plana'
  tono?: Tono
  pie?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const inverso = variante === 'principal'
  const color = inverso ? TEXTO_INVERSO : TEXTO
  const base =
    variante === 'principal'
      ? 'tarjeta-principal'
      : variante === 'urgente'
        ? 'zona-urgente'
        : variante === 'plana'
          ? ''
          : 'tarjeta'
  const relleno = variante === 'plana' ? '' : 'px-e4 py-e4'

  return (
    <section className={`${base} ${className}`}>
      <div className={relleno}>
        {titulo ? (
          <div className="mb-e3 flex items-center gap-e2">
            {Icono ? (
              <Icono
                size={14}
                strokeWidth={2}
                className={color[tono] || (inverso ? 'text-claro-suave' : 'text-suave')}
              />
            ) : null}
            <h3 className={`t-tarjeta ${color[tono]}`}>{titulo}</h3>
          </div>
        ) : null}
        {bajada ? (
          <p className={`t-apoyo mb-e3 max-w-[70ch] ${inverso ? 'text-claro-tenue' : ''}`}>
            {bajada}
          </p>
        ) : null}
        {children}
      </div>
      {pie ? (
        <div
          className={
            'px-e4 py-e3 text-[12px] ' +
            (inverso
              ? 'border-t border-acento-linea text-claro-tenue'
              : 'border-t border-linea text-tenue')
          }
        >
          {pie}
        </div>
      ) : null}
    </section>
  )
}

/**
 * La cifra de un bloque, con su rótulo arriba y su explicación abajo.
 *
 * `tamano` distingue la cifra que domina la pantalla de las secundarias. No hay un
 * tercer tamaño: si algo no es lo principal ni una cifra de tarjeta, es texto.
 */
export function Cifra({
  rotulo,
  valor,
  explica,
  tono = 'neutro',
  tamano = 'normal',
  inverso = false,
}: {
  rotulo?: string
  valor: string
  explica?: React.ReactNode
  tono?: Tono
  tamano?: 'principal' | 'normal'
  inverso?: boolean
}) {
  const color = inverso ? TEXTO_INVERSO : TEXTO
  return (
    <div>
      {rotulo ? (
        <div className={`t-rotulo ${inverso ? 'text-claro-suave' : ''}`}>{rotulo}</div>
      ) : null}
      <div
        className={`${tamano === 'principal' ? 't-display' : 't-cifra'} ${rotulo ? 'mt-e2' : ''} ${color[tono]}`}
      >
        {valor}
      </div>
      {explica ? (
        <p className={`t-apoyo mt-e2 max-w-[52ch] ${inverso ? 'text-claro-tenue' : ''}`}>
          {explica}
        </p>
      ) : null}
    </div>
  )
}

/** Lo que hay que hacer, en imperativo. */
export function Accion({
  icono: Icono,
  tono = 'alerta',
  inverso = false,
  children,
}: {
  icono?: LucideIcon
  tono?: Tono
  inverso?: boolean
  children: React.ReactNode
}) {
  const color = inverso ? TEXTO_INVERSO : TEXTO
  return (
    <p className={`mt-e3 flex items-start gap-1.5 text-[12px] font-medium ${color[tono]}`}>
      {Icono ? <Icono size={14} strokeWidth={2} className="mt-px shrink-0" /> : null}
      <span>{children}</span>
    </p>
  )
}

/** Etiqueta de estado: un punto de color y el texto, sin fondo saturado. */
export function Marca({
  tono = 'neutro',
  inverso = false,
  children,
}: {
  tono?: Tono
  inverso?: boolean
  children: React.ReactNode
}) {
  const punto =
    tono === 'negativo'
      ? 'bg-negativo'
      : tono === 'alerta'
        ? 'bg-alerta'
        : tono === 'positivo'
          ? 'bg-positivo'
          : 'bg-suave'
  const color = inverso ? TEXTO_INVERSO : TEXTO
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] whitespace-nowrap ${color[tono] || (inverso ? 'text-claro-tenue' : 'text-tenue')}`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${punto}`} />
      {children}
    </span>
  )
}

/**
 * Barra de proporción.
 *
 * Sin color: la longitud ya comunica. Pintarla haría competir cinco categorías por
 * la atención cuando ninguna exige una decisión.
 */
export function Barra({ porcentaje, inverso = false }: { porcentaje: number; inverso?: boolean }) {
  return (
    <div className={`h-1.5 w-full rounded-full ${inverso ? 'bg-acento-linea' : 'bg-panel'}`}>
      <div
        className={`h-full rounded-full ${inverso ? 'bg-claro-suave' : 'bg-linea-fuerte'}`}
        style={{ width: `${Math.max(Math.min(porcentaje, 100), 2)}%` }}
      />
    </div>
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
    <div className="flex flex-col items-center gap-1.5 px-e4 py-e6 text-center">
      {Icono ? <Icono size={20} strokeWidth={1.5} className={TEXTO[tono] || 'text-suave'} /> : null}
      <p className={`text-[13px] font-medium ${TEXTO[tono]}`}>{titulo}</p>
      {detalle ? <p className="t-apoyo max-w-[46ch]">{detalle}</p> : null}
    </div>
  )
}

export function Esqueleto({ alto = 16, ancho = '100%' }: { alto?: number; ancho?: string }) {
  return <div className="esqueleto" style={{ height: alto, width: ancho }} />
}

/** Tarjeta en carga: mismo tamaño que la real, para que nada salte al llegar. */
export function TarjetaCargando({ filas = 3 }: { filas?: number }) {
  return (
    <div className="tarjeta px-e4 py-e4">
      <Esqueleto alto={11} ancho="35%" />
      <div className="mt-e3">
        <Esqueleto alto={24} ancho="45%" />
      </div>
      <div className="mt-e4 space-y-e2">
        {Array.from({ length: filas }, (_, i) => (
          <Esqueleto key={i} alto={12} ancho={`${90 - i * 12}%`} />
        ))}
      </div>
    </div>
  )
}
