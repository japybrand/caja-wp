import type { Grupo } from './dominio'

export interface DefinicionCategoria {
  nombre: string
  grupo: Grupo
  orden: number
  esManual: boolean
}

/**
 * Catalogo de filas del flujo, con los nombres exactos del Excel.
 *
 * esManual = true  -> la fila se edita mes a mes en la grilla (tabla ValorManual).
 * esManual = false -> la fila se calcula sumando movimientos (tabla Movimiento).
 *
 * Diferencias deliberadas respecto del Excel, acordadas con Japybrand WP:
 *  - "Financimiento" (B17) va escrito bien: Financiamiento.
 *  - "Factoring" es una categoria nueva del grupo proveedores, al mismo nivel que Bancos.
 *    Ahi vive la comision de Xepelin por adelanto de facturas, que en el Excel estaba
 *    mal ubicada dentro de "Sistema comercial".
 */
export const CATEGORIAS: DefinicionCategoria[] = [
  // Fila 8 del Excel. En el Excel enero es un 0 fijo; aca es editable.
  { nombre: 'Saldo Inicial', grupo: 'saldo_inicial', orden: 1, esManual: true },

  // Filas 11-13
  { nombre: 'Ventas del mes', grupo: 'ingresos', orden: 1, esManual: true },

  // Filas 18-20
  { nombre: 'Línea de crédito Fogape Maxxa', grupo: 'financiamiento', orden: 1, esManual: true },
  { nombre: 'Xepelin', grupo: 'financiamiento', orden: 2, esManual: true },

  // Filas 25-28
  { nombre: 'Pago de nóminas', grupo: 'colaboradores', orden: 1, esManual: false },
  { nombre: 'Pago de servicios a honorarios', grupo: 'colaboradores', orden: 2, esManual: false },
  { nombre: 'Pago de servicios Internacional', grupo: 'colaboradores', orden: 3, esManual: false },

  // Filas 33-39
  { nombre: 'Cloud', grupo: 'proveedores', orden: 1, esManual: false },
  { nombre: 'Sistema comercial', grupo: 'proveedores', orden: 2, esManual: false },
  { nombre: 'AI apps', grupo: 'proveedores', orden: 3, esManual: false },
  { nombre: 'Proveedores nacional', grupo: 'proveedores', orden: 4, esManual: false },
  { nombre: 'Marketing digital', grupo: 'proveedores', orden: 5, esManual: false },
  { nombre: 'Bancos', grupo: 'proveedores', orden: 6, esManual: false },
  { nombre: 'Factoring', grupo: 'proveedores', orden: 7, esManual: false },

  // Filas 46-51
  { nombre: 'Pago de cotizaciones Previred', grupo: 'impuestos', orden: 1, esManual: true },
  { nombre: 'Pago de impuestos IVA', grupo: 'impuestos', orden: 2, esManual: true },
  { nombre: 'Pago de giros', grupo: 'impuestos', orden: 3, esManual: true },
  { nombre: 'Previred pagos postergados', grupo: 'impuestos', orden: 4, esManual: true },
  { nombre: 'Santander Pagos TGR', grupo: 'impuestos', orden: 5, esManual: true },

  // Fila 54
  { nombre: 'Retiros', grupo: 'retiros', orden: 1, esManual: false },

  // Filas 60-65
  { nombre: 'Inmotion - acuerdo de pago', grupo: 'deudas', orden: 1, esManual: true },
  { nombre: 'Fogape - cuotas', grupo: 'deudas', orden: 2, esManual: true },
  { nombre: 'TGR pie inicial', grupo: 'deudas', orden: 3, esManual: true },
  { nombre: 'TGR convenio', grupo: 'deudas', orden: 4, esManual: true },
  { nombre: 'RC Ingeniería - acuerdo de pago', grupo: 'deudas', orden: 5, esManual: true },
]
