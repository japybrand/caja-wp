'use client'

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { BarraMes } from '@/lib/panel'

const millones = (n: number): string => `${Math.round(n / 100_000) / 10}M`
const clp = (n: number): string =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))

/**
 * Ingresos contra egresos por mes, con el saldo acumulado encima.
 *
 * Las barras van en grises y solo la línea de saldo toma color, y únicamente
 * cuando cruza bajo cero: es el único dato del gráfico que exige una decisión.
 */
export function Grafico({ barras }: { barras: BarraMes[] }) {
  const hayNegativo = barras.some((b) => b.saldo < 0)

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={barras} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--color-linea)" vertical={false} />
          <XAxis
            dataKey="mes"
            tick={{ fontSize: 11, fill: 'var(--color-tenue)' }}
            axisLine={{ stroke: 'var(--color-linea-fuerte)' }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={millones}
            tick={{ fontSize: 11, fill: 'var(--color-tenue)' }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            // Los tipos de recharts admiten valores de varias formas; aquí siempre
            // llegan números y etiquetas de mes, así que se normaliza en la entrada.
            formatter={(valor, nombre) => [clp(Number(valor ?? 0)), String(nombre ?? '')]}
            labelFormatter={(etiqueta) => {
              const mes = String(etiqueta ?? '')
              const b = barras.find((x) => x.mes === mes)
              const nota =
                b?.naturaleza === 'real'
                  ? 'mes real'
                  : b?.naturaleza === 'incompleto'
                    ? 'incompleto'
                    : 'proyectado'
              return `${mes} · ${nota}`
            }}
            contentStyle={{
              fontSize: 12,
              border: '1px solid var(--color-linea-fuerte)',
              borderRadius: 4,
              padding: '6px 8px',
            }}
          />
          <Bar dataKey="ingresos" name="Ingresos" fill="#9ca3af" radius={[2, 2, 0, 0]} />
          <Bar dataKey="egresos" name="Egresos" fill="#d1d5db" radius={[2, 2, 0, 0]} />
          <Line
            type="monotone"
            dataKey="saldo"
            name="Saldo acumulado"
            stroke={hayNegativo ? 'var(--color-negativo)' : 'var(--color-tinta)'}
            strokeWidth={1.5}
            dot={{ r: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
