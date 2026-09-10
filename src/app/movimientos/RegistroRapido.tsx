'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Plus, X } from 'lucide-react'
import { formatearCLPConCero, parsearCLP } from '@/lib/formato'
import { registrarPago, type DatosRegistro } from './acciones-registro'

/**
 * Registro rápido de un pago o un cobro que todavía no llegó a la cartola.
 *
 * CUATRO CAMPOS Y NADA MÁS
 * Categoría, proveedor, monto y fecha, con una nota opcional. El formulario largo de
 * la tabla sigue existiendo para lo demás —moneda, estado, monto en origen—, pero
 * pedirlos aquí haría que registrar un pago cueste más que anotarlo en un papel, y
 * entonces no se usaría.
 *
 * EL AVISO DE DUPLICADO NO ES OPCIONAL
 * El caso normal es pagar algo que la planilla ya proyectaba para ese mes. Guardar
 * sin más sumaría el pago encima de la proyección y el gasto quedaría al doble, sin
 * ninguna señal. Por eso el primer intento no escribe: busca un movimiento del mismo
 * proveedor y mes, y si lo encuentra pregunta si reemplaza o si es un pago aparte.
 */

interface Categoria {
  id: string
  nombre: string
  grupo: string
  esManual: boolean
}
interface Proveedor {
  id: string
  nombre: string
  categoriaId: string
}

/** Los grupos donde un registro manual tiene sentido, en el orden en que se usan. */
const GRUPOS: { grupo: string; etiqueta: string }[] = [
  { grupo: 'proveedores', etiqueta: 'Proveedores' },
  { grupo: 'colaboradores', etiqueta: 'Colaboradores' },
  { grupo: 'retiros', etiqueta: 'Retiros' },
  { grupo: 'ingresos', etiqueta: 'Ingresos' },
]

const hoyISO = (): string => new Date().toISOString().slice(0, 10)

export function RegistroRapido({
  categorias,
  proveedores,
}: {
  categorias: Categoria[]
  proveedores: Proveedor[]
}) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [pendiente, iniciar] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [duplicado, setDuplicado] = useState<{
    id: string
    descripcion: string
    montoCLP: number
    fuente: string
  } | null>(null)

  const [categoriaId, setCategoriaId] = useState('')
  const [proveedorId, setProveedorId] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [nota, setNota] = useState('')

  // Solo las derivadas: las manuales guardan un número por mes y un registro ahí
  // sumaría al total sin dejar rastro de quién ni cuándo.
  const disponibles = useMemo(
    () =>
      GRUPOS.map((g) => ({
        ...g,
        categorias: categorias.filter((c) => c.grupo === g.grupo && !c.esManual),
      })).filter((g) => g.categorias.length > 0),
    [categorias],
  )
  const delProveedor = useMemo(
    () => proveedores.filter((p) => p.categoriaId === categoriaId),
    [proveedores, categoriaId],
  )

  const limpiar = (): void => {
    setCategoriaId('')
    setProveedorId('')
    setMonto('')
    setFecha(hoyISO())
    setNota('')
    setError(null)
    setDuplicado(null)
  }

  const guardar = (siDuplica: DatosRegistro['siDuplica']): void => {
    setError(null)
    if (!categoriaId) {
      setError('Elige una categoría.')
      return
    }
    const valor = parsearCLP(monto)
    if (valor === null || valor <= 0) {
      setError('El monto tiene que ser mayor que cero.')
      return
    }
    iniciar(async () => {
      const r = await registrarPago({
        categoriaId,
        proveedorId: proveedorId || null,
        fecha,
        montoCLP: valor,
        nota,
        siDuplica,
      })
      if (r.duplicado) {
        setDuplicado(r.duplicado)
        return
      }
      if (!r.ok) {
        setError(r.error ?? 'No se pudo registrar.')
        return
      }
      limpiar()
      setAbierto(false)
      router.refresh()
    })
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex items-center gap-1.5 rounded-[8px] bg-acento-superficie px-e3 py-1.5 text-[12.5px] font-medium text-claro transition-opacity hover:opacity-90"
      >
        <Plus size={14} strokeWidth={2} />
        Registrar pago
      </button>
    )
  }

  return (
    <section className="tarjeta mb-e4 px-e4 py-e4">
      <div className="mb-e3 flex items-center justify-between">
        <h3 className="t-tarjeta">Registrar un pago o cobro</h3>
        <button
          type="button"
          onClick={() => {
            limpiar()
            setAbierto(false)
          }}
          className="text-tenue transition-colors hover:text-tinta"
          aria-label="Cerrar"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </div>
      <p className="t-apoyo mb-e3 max-w-[72ch]">
        Queda marcado como <span className="font-medium">declarado</span>: entra al gasto del mes
        pero no cuenta como pagado hasta que el banco lo muestre. Cuando cargues la cartola, la
        conciliación lo enlaza con el cargo real en vez de duplicarlo.
      </p>

      <div className="grid gap-e3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="block">
          <span className="t-rotulo">Categoría</span>
          <select
            value={categoriaId}
            onChange={(e) => {
              setCategoriaId(e.target.value)
              setProveedorId('')
              setDuplicado(null)
            }}
            className="mt-1 w-full rounded-[8px] border border-linea px-e2 py-1.5 text-[12.5px]"
          >
            <option value="">Elige una…</option>
            {disponibles.map((g) => (
              <optgroup key={g.grupo} label={g.etiqueta}>
                {g.categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="t-rotulo">Proveedor o persona</span>
          <select
            value={proveedorId}
            onChange={(e) => {
              setProveedorId(e.target.value)
              setDuplicado(null)
            }}
            disabled={!categoriaId}
            className="mt-1 w-full rounded-[8px] border border-linea px-e2 py-1.5 text-[12.5px] disabled:opacity-50"
          >
            <option value="">Sin proveedor</option>
            {delProveedor.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="t-rotulo">Monto</span>
          <input
            value={monto}
            onChange={(e) => {
              setMonto(e.target.value)
              setDuplicado(null)
            }}
            inputMode="numeric"
            placeholder="0"
            className="monto mt-1 w-full rounded-[8px] border border-linea px-e2 py-1.5 text-[12.5px]"
          />
        </label>

        <label className="block">
          <span className="t-rotulo">Fecha del pago</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="cifra mt-1 w-full rounded-[8px] border border-linea px-e2 py-1.5 text-[12.5px]"
          />
        </label>
      </div>

      <label className="mt-e3 block">
        <span className="t-rotulo">Nota</span>
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Opcional: número de transferencia, a quién, por qué"
          className="mt-1 w-full rounded-[8px] border border-linea px-e2 py-1.5 text-[12.5px]"
        />
      </label>

      {error ? (
        <p className="mt-e3 rounded-[8px] bg-negativo/[0.06] px-e3 py-e2 text-[12.5px] text-negativo">
          {error}
        </p>
      ) : null}

      {duplicado ? (
        <div className="zona-urgente mt-e3 px-e3 py-e3">
          <p className="flex items-start gap-1.5 text-[12.5px] font-medium text-alerta">
            <AlertTriangle size={14} strokeWidth={2} className="mt-px shrink-0" />
            Ese proveedor ya tiene un movimiento en el mes, por{' '}
            {formatearCLPConCero(duplicado.montoCLP)}.
          </p>
          <p className="t-apoyo mt-e2 max-w-[72ch]">
            {duplicado.descripcion || 'Sin descripción'} · origen {duplicado.fuente}. Si es lo mismo
            que acabas de pagar, reemplázalo: guardar los dos contaría el gasto dos veces.
          </p>
          <div className="mt-e3 flex flex-wrap gap-e2">
            <button
              type="button"
              disabled={pendiente}
              onClick={() => guardar('reemplazar')}
              className="rounded-[8px] bg-acento-superficie px-e3 py-1.5 text-[12px] font-medium text-claro disabled:opacity-50"
            >
              Reemplazar el que está
            </button>
            <button
              type="button"
              disabled={pendiente}
              onClick={() => guardar('agregar')}
              className="rounded-[8px] border border-linea-fuerte px-e3 py-1.5 text-[12px] font-medium disabled:opacity-50"
            >
              Es un pago aparte, agrégalo
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-e4 flex items-center gap-e3">
        <button
          type="button"
          disabled={pendiente || duplicado !== null}
          onClick={() => guardar('preguntar')}
          className="rounded-[8px] bg-acento-superficie px-e4 py-1.5 text-[12.5px] font-medium text-claro transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pendiente ? 'Guardando…' : 'Registrar'}
        </button>
        <button
          type="button"
          onClick={limpiar}
          className="text-[12.5px] text-tenue transition-colors hover:text-tinta"
        >
          Limpiar
        </button>
      </div>
    </section>
  )
}
