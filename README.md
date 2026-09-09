# Caja WP

Flujo de caja de **Japybrand WP**. Reproduce el Excel `Flujo de Caja 2026 - Japybrand WP.xlsx`
calculando todo desde una base de datos, para dejar de editar planillas a mano.

Next.js 15 (App Router) · TypeScript estricto · Tailwind 4 · Prisma (SQLite en desarrollo,
PostgreSQL/Supabase en producción).

---

## Puesta en marcha

Requiere **Node.js 20 o superior** (probado en 24.19).

```bash
npm install
npx prisma db push     # crea prisma/dev.db con el esquema
npm run importar       # carga el Excel y verifica la cuadratura
npm run dev            # http://localhost:3000
```

`npm install` corre `prisma generate` solo. Si el esquema cambia, vuelve a correr
`npx prisma db push`.

---

## El importador

```bash
npm run importar
```

Lee `Flujo_de_Caja_2026_-_Japybrand_WP.xlsx` desde la raíz del proyecto y carga:

| Origen | Destino |
|---|---|
| Hoja `Proveedores`, filas 3–43 | 41 proveedores + sus movimientos, con la categoría que les da su rango de filas |
| `Pagos Remuneraciones`, `Pagos Honorarios`, `Pagos Internacional` | 10 colaboradores + sus movimientos |
| Hoja `Retiros`, filas 3–10 | 12 movimientos sueltos, sin proveedor (esas filas no tienen nombre en el Excel) |
| Filas manuales del flujo (ventas, financiamiento, impuestos, deudas, saldo inicial de enero) | `ValorManual` |

**Es idempotente.** Cada movimiento lleva un `idExterno` derivado de su celda de origen
(`excel:Proveedores:3:2026-01`), así que correrlo dos veces actualiza en vez de duplicar.
Si una celda pasa a cero, el movimiento correspondiente se borra.

Al terminar imprime el resumen de carga y la **cuadratura**: para cada fila calculada del
flujo y para cada mes compara el total del Excel contra el de la app, descuenta las
diferencias acordadas y exige que la diferencia no explicada sea cero. Si no lo es, el
script termina con código de salida 1 y marca las filas con `FALLA`.

### Diferencias deliberadas respecto del Excel

Están declaradas en `DIFERENCIAS`, dentro de [`scripts/importar-excel.ts`](scripts/importar-excel.ts),
y la cuadratura las descuenta sola. Si mañana se corrigen en el Excel, se borra la entrada.

1. **Honorarios de enero.** El Excel deja la celda `C26` del flujo vacía, así que no arrastra
   los 199.000 de Macarena Paredes. La app sí los cuenta. Enero sigue incompleto (faltan
   nóminas, internacional y el resto de honorarios) hasta que la fase 2 los extraiga de Gmail.
2. **Fila 8 de `Pagos Honorarios`.** No tiene nombre y carga 328.446 en mayo. Se descartó por
   ser un error, y resultó no serlo: la cartola mostró después que es el pago a **Damián
   Moreno**, colaborador a honorarios que dejó la agencia. La planilla tenía bien la
   categoría, solo le faltaba el nombre. Se sigue omitiendo esta fila porque el mismo monto
   entra desde la cartola con su proveedor; importarla además lo contaría dos veces. La
   diferencia acordada que la descontaba de la cuadratura ya se eliminó.
3. **Xepelin (193.780, septiembre).** Es la comisión por adelanto de facturas, no una
   suscripción. Se movió de `Sistema comercial` a una categoría nueva, `Factoring`, que
   aparece como una fila más de Pago Proveedores. No cambia ningún total.

Otros ajustes menores: `Financimiento` (B17 del Excel) va escrito bien; el saldo inicial de
enero, que en el Excel es un `0` fijo, aquí es editable.

---

## Pantallas

**`/flujo`** — la grilla, 12 meses en columnas más el total del año. Las filas manuales
(ventas, financiamiento, impuestos, deudas y el saldo inicial de enero) se editan con un clic
en la celda y se guardan al salir o con Enter; Escape cancela. Los subtotales de proveedores,
colaboradores y retiros se despliegan con ▸ para ver el detalle por proveedor. Negativos en
rojo, columna del mes en curso destacada.

**`/movimientos`** — tabla filtrable por mes, categoría, proveedor, fuente, estado y texto de
la descripción; los filtros viajan en la URL, así que una vista filtrada se puede compartir.
Permite crear, editar y eliminar (con confirmación en dos pasos). Los movimientos
`por_revisar` salen destacados en ámbar arriba de todo, con un botón para confirmarlos de una.

Los movimientos solo pueden colgar de categorías **calculadas**. Las filas manuales del flujo
no aparecen en el selector y la acción del servidor también las rechaza: si aceptaran
movimientos, el monto se contaría dos veces (una en `ValorManual` y otra en `Movimiento`).

**`/obligaciones`** — el estado de la deuda con calendario cerrado. Arriba, cuánto se lleva
pagado y cuánto queda de los cuatro convenios de la Tesorería y de la línea Fogape. En medio,
el calendario mes a mes hasta febrero de 2028 con una columna por obligación y el total
combinado, que es el número que interesa: cuánto hay que pagar cada mes pase lo que pase.
Abajo, las cotizaciones previsionales con sus días de atraso.

**`/`** — el panel de inicio, en lenguaje de dueño y no de contador. Siete preguntas: cuánta
plata hay hoy y cuánta falta para cerrar el mes, qué está atrasado, qué vence en 15 días,
si alcanza o no, cuánto IVA hay que pagar y por qué, qué está costando más, y a quién se le
debe. Los gráficos van abajo, después de lo importante.

**`/proveedores`** — los 51 proveedores y colaboradores agrupados por categoría, con su moneda
por defecto, si están activos, cuántos movimientos tienen y su total del año. El campo de
**remitentes de email** se edita en línea: acepta correos separados por coma, punto y coma o
salto de línea, valida el formato, los pasa a minúsculas y elimina repetidos. Es el campo que
usará la fase 2 para clasificar los mensajes de Gmail.

---

## Variables de entorno

Copia `.env.example` a `.env`.

| Variable | Para qué | Ejemplo |
|---|---|---|
| `DATABASE_URL` | Conexión a la base | `file:./dev.db` |
| `DIRECT_URL` | Solo en Postgres: conexión directa para migraciones | `postgresql://…:5432/postgres` |
| `NEXT_PUBLIC_ANIO_ACTIVO` | Año que muestra la app | `2026` |

La fase 2 agrega siete variables más, en `.env.local`: ver **Fase 2 → Variables de entorno**.

---

## Migrar a PostgreSQL / Supabase

El esquema es portable a propósito: sin enums de Prisma, sin listas escalares, sin tipos
nativos `@db.*` y sin `Decimal`. **No hay que tocar código de aplicación.**

```bash
npm run db:postgres        # cambia el provider en prisma/schema.prisma
# pon la DATABASE_URL de Supabase en .env
npx prisma generate
npx prisma db push
npm run importar
```

Para volver a SQLite: `npm run db:sqlite`.

En Supabase usa el **pooler** (puerto 6543, con `?pgbouncer=true&connection_limit=1`) para la
app, y la **conexión directa** (puerto 5432) en `DIRECT_URL` para las migraciones.

## Despliegue

Sirve tal cual en Vercel o Railway. Configura `DATABASE_URL` (y `DIRECT_URL`) apuntando a
Postgres, porque SQLite no persiste en un sistema de archivos efímero. El `build` ya corre
`prisma generate`.

---

## Estructura

```
prisma/schema.prisma        Categoria · Proveedor · Movimiento · ValorManual
prisma/seed.ts              precarga de las 25 categorías
scripts/importar-excel.ts   importador + cuadratura contra el Excel
scripts/db-provider.mjs     alterna sqlite ⇄ postgresql
src/lib/catalogo.ts         las filas del flujo, con los nombres del Excel
src/lib/flujo.ts            calcularFlujo(): réplica de las fórmulas del Excel
src/lib/dominio.ts          uniones de TypeScript que reemplazan a los enums
src/lib/formato.ts          formato y parseo de pesos chilenos
src/app/flujo/              la grilla de 12 meses
src/app/movimientos/        tabla con filtros, alta/edición/borrado y bandeja de revisión
src/app/proveedores/        listado, remitentes de email y candidatos de Gmail
src/app/ventas/             detalle mensual del SII y ranking de clientes
src/lib/sii/                parser del Registro de Ventas, totales y ranking
src/lib/banco/              parser de cartolas de Santander (lector xlsx propio)
src/lib/obligaciones.ts     convenios TGR, línea Fogape y cotizaciones previsionales
src/app/obligaciones/       calendario de cuotas y estado de las cotizaciones
src/app/flujo/Proyeccion.tsx  el flujo multi-año, de solo lectura

auth.config.ts              config de Auth.js compatible con Edge (sin Prisma)
auth.ts                     config completa: suma el guardado del refresh token
src/middleware.ts           protege toda la app (va en src/, no en la raíz)
vercel.json                 cron horario de la ingesta
src/lib/cifrado.ts          AES-256-GCM para el refresh token de Google
src/lib/sesion.ts           requerirSesion() para las server actions
src/lib/gmail/              cliente, descubrimiento de remitentes y lectura de correos
src/lib/extraccion/         el prompt, el esquema Zod y la llamada al modelo
src/lib/cambio.ts           dólar observado con caché
src/lib/ingesta.ts          el orquestador: correos → movimientos
```

Cada pantalla tiene su `page.tsx` (server component, hace las consultas), un `acciones.ts`
con las server actions y un componente cliente con la tabla.

### El modelo

- **Categoria** — cada fila y subgrupo del flujo. `esManual = true` significa que la fila se
  edita mes a mes en la grilla (`ValorManual`); `false`, que se calcula sumando `Movimiento`.
- **Proveedor** — pertenece a una categoría. `remitentesEmail` guarda una lista JSON de
  correos que la fase 2 usará para clasificar mensajes de Gmail.
- **Movimiento** — un pago concreto de un mes. `montoCLP` es un entero y es el valor que manda
  en todos los cálculos; `montoOriginal` es solo un espejo informativo de la moneda de origen.
- **ValorManual** — una celda editable del flujo: categoría + mes + año.

### Las fórmulas

`src/lib/flujo.ts` replica el Excel fila por fila:

```
Saldo Inicial (enero)         = valor manual
Saldo Inicial (resto)         = flujo de caja financiero del mes anterior
Resultado antes de impuestos  = Saldo Inicial + Ingresos + Financiamiento
                                − Colaboradores − Proveedores
Flujo de caja económico       = Resultado − Impuestos − Retiros
Flujo de caja financiero      = Económico − Deudas
```

El saldo inicial dentro del *Resultado antes de impuestos* no es lo habitual en contabilidad,
pero es lo que hace el Excel (`C42 = SUM(C8+C14+C21-C29-C40)`) y se reproduce igual.

---

## Principio del modelo: meses reales y meses proyectados

**Un mes es real o es proyectado, nunca a medias. La app tiene que decirlo siempre.**

- **Real** — hay cartola bancaria de ese mes, así que los montos son lo que efectivamente pasó
  por la cuenta corriente.
- **Proyectado** — no hay cartola, y lo que se muestra viene de la proyección anual que se armó
  al empezar el año.

Esto no es un detalle de presentación. Los montos originales del Excel **eran una proyección**,
no un registro de lo pagado: 24 de 39 proveedores repetían uno o dos valores en los doce meses.
Verpex aparecía con 233.511 los doce meses; Microsoft Office con 8.490 los doce. Son
suscripciones en dólares pagadas con tarjeta chilena, así que el cargo real varía con el tipo
de cambio y nunca es el mismo dos meses seguidos.

Mezclar ambas cosas sin marcarlas hace que un número proyectado se lea como un hecho, que es
justo el error que la app existe para evitar.

### Cómo se ve

En `/flujo`, cada columna de mes dice **`real`** o **`proy.`** bajo el nombre, y las columnas
proyectadas llevan una trama diagonal tenue. La cabecera resume cuántos meses son de cada tipo.

Es la misma idea que la marca `SII` de las celdas de ventas: el origen del dato se muestra,
no se esconde.

### Dónde vive

`calcularFlujo` devuelve `naturalezaPorMes: ('real' | 'proyectado')[]`, calculado por la
presencia de `MovimientoBancario` en cada mes. No hay una bandera que alguien pueda dejar mal:
si llega la cartola de octubre, octubre pasa a real solo.

### El banco manda donde hay cartola

```bash
npm run aplicar-banco            # simulación
npm run aplicar-banco -- --firme
```

Reemplaza el monto proyectado de cada proveedor y mes por la **suma real de sus cargos** en la
cartola. Solo toca meses con cartola y solo movimientos de fuente `excel`; los actualizados
pasan a fuente `cartola`.

Aplicado sobre enero–septiembre: **94 movimientos cambiaron**, con un efecto neto de 812.026
más de egresos en nueve meses.

Y `npm run importar` **ya no los pisa**: un movimiento de fuente `cartola` se salta con un aviso
en el resumen. Sin eso, volver a correr el importador del Excel devolvería las proyecciones
encima de los datos reales.

Por lo mismo, la cuadratura contra el Excel **deja de cuadrar a propósito** en los meses con
cartola. El importador lo advierte.

---

## Fase 2: ingesta desde Gmail

La app lee los recibos que llegan a Gmail, extrae el monto con Claude y crea el movimiento.
Nada se confirma sin criterio: lo dudoso cae en una bandeja de revisión.

### Configuración en Google Cloud

1. En [console.cloud.google.com](https://console.cloud.google.com) crea o elige un proyecto.
2. **APIs y servicios → Biblioteca** → habilita la **Gmail API**.
3. **Pantalla de consentimiento de OAuth**: tipo *Externo*; agrega el scope
   `https://www.googleapis.com/auth/gmail.readonly`; en **Usuarios de prueba** agrega
   `finanzas@japybrand.cl`. Mientras la app siga en modo prueba, Google muestra el aviso de
   "aplicación no verificada": *Configuración avanzada → Ir a Caja WP*.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**. En **URIs
   de redireccionamiento autorizados**:
   - `http://localhost:3000/api/auth/callback/google` para desarrollo
   - `https://TU-DOMINIO/api/auth/callback/google` para producción
5. Copia el ID y el secreto a `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`.

El permiso es de **solo lectura**: la app no envía, no borra ni modifica correos.

### Variables de entorno de la fase 2

Van en `.env.local`, que no se versiona. `.env.example` las lista todas con ejemplos.

| Variable | Para qué | Cómo generarla |
|---|---|---|
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | OAuth con Google | Google Cloud, arriba |
| `ANTHROPIC_API_KEY` | Extracción con `claude-sonnet-4-6` | console.anthropic.com |
| `AUTH_SECRET` | Firma la sesión JWT | `npx auth secret` |
| `AUTH_URL` | Base de las URL de callback | `http://localhost:3000`, o el dominio |
| `ALLOWED_EMAILS` | Quién puede entrar, separado por coma | — |
| `ENCRYPTION_KEY` | Cifra el refresh token de Google (AES-256-GCM) | `openssl rand -hex 32` |
| `CRON_SECRET` | Protege `/api/ingesta/gmail` | `openssl rand -base64 32` |

Con `ALLOWED_EMAILS` vacía **no entra nadie**: es el fallo seguro. Si cambias `ENCRYPTION_KEY`,
el refresh token guardado deja de descifrarse y hay que volver a entrar con Google.

### Autenticación

Login con Google (Auth.js v5), restringido a `ALLOWED_EMAILS`. El mismo consentimiento pide
`gmail.readonly` con `access_type=offline` y `prompt=consent`, y el refresh token se guarda
cifrado en `CuentaGoogle`. No se usa el adaptador de Prisma porque guardaría ese token en
texto plano en su tabla `Account`.

Dos capas: `src/middleware.ts` bloquea la navegación y cada server action llama a
`requerirSesion()`. La configuración está partida en dos a propósito — `auth.config.ts` es lo
que corre el middleware en el runtime Edge, sin Prisma ni `node:crypto`; `auth.ts` le suma la
escritura en la base y solo corre en Node.

> El middleware vive en `src/middleware.ts`, **no** en la raíz. Con carpeta `src/`, Next lo
> busca ahí y solo ahí: puesto en la raíz se ignora en silencio y la app queda abierta.

### Descubrimiento de remitentes

En `/proveedores`, **Buscar remitentes en Gmail** recorre los proveedores activos sin
remitentes, busca su nombre en los últimos 12 meses, agrupa por remitente y guarda candidatos
en `RemitenteCandidato`. **Nada llega a `Proveedor.remitentesEmail` hasta que alguien
aprueba.** Cada candidato muestra cuántos correos, el último, un asunto de ejemplo y en cuántos
proveedores distintos aparece ese mismo remitente: uno que sale bajo muchos casi siempre es
ruido de un hilo que menciona varias empresas.

Va de a 2 proveedores en paralelo, con pausas y reintento exponencial. Gmail cobra 5 unidades
de cuota por llamada con techo de 250 por segundo; sin freno corta con 429 a mitad de camino.

También está `npm run remitentes` para correrlo desde la terminal.

### Ingesta

`npm run sincronizar -- --dias 7 --revisar`, el botón **Sincronizar ahora** de `/movimientos`,
o el cron. Los tres llaman a la misma `ejecutarIngesta()`.

Por cada correo nuevo: extrae el cuerpo en texto plano (o el HTML convertido) más el texto del
primer PDF adjunto, se lo manda a `claude-sonnet-4-6` con structured outputs, convierte USD a
CLP y crea el `Movimiento` con `idExterno = gmailId`. Cada correo queda anotado en
`CorreoProcesado`, así que la siguiente corrida no lo vuelve a mirar.

**Qué queda por revisar en vez de confirmarse:**

- confianza bajo 0,85, o monto 0
- `coincideConProveedor: false` — el correo cobra por otra cosa. Típico de PayPal o FastSpring,
  que facturan por cuenta de muchas empresas
- remitente compartido por dos proveedores: el remitente solo no basta para saber de cuál es
- **posible duplicado**: ya existe un movimiento del mismo proveedor y mes con monto igual o
  dentro del 1 %. Enero a septiembre vienen del Excel, así que esto salta seguido
- **pago previsto**, ver abajo
- la corrida entera, con `--revisar` / `forzarRevision`

**Facturas de colaboradores.** Para las categorías *Pago de servicios Internacional* y *Pago de
servicios a honorarios*, una factura o boleta recibida cuenta aunque todavía no esté pagada:
llegan a fin de mes y se pagan el 5 del siguiente. El movimiento se fecha el **día 5** —del
mismo mes si la factura llegó hasta el día 10, del siguiente si llegó después— y queda
**siempre por revisar**, con la descripción marcada `PAGO PREVISTO`.

Cuando la factura viene en dólares, `montoOriginal` guarda los USD y el monto en CLP es una
**estimación** con el dólar observado, marcada `PAGO PREVISTO (CLP estimado)`. El valor real lo
fija Global66 con su propio tipo de cambio y aparecerá en la cartola.

**Tipo de cambio**: dólar observado de [mindicador.cl](https://mindicador.cl), cacheado en
`TipoCambio`. Camina hasta 7 días hacia atrás en fines de semana y feriados, y una fecha futura
se ancla en hoy.

**Los movimientos por revisar no entran en el flujo.** `/flujo` suma solo los confirmados y
muestra lo pendiente aparte: en ámbar bajo cada celda y en una fila de cierre. Un duplicado sin
revisar descuadraría el flujo en silencio.

### Cron

`vercel.json` deja `/api/ingesta/gmail` corriendo cada hora. Vercel manda
`Authorization: Bearer $CRON_SECRET`; la ruta rechaza cualquier otra cosa con 401, y está fuera
del matcher del middleware porque no se autentica con sesión.

```json
{ "crons": [{ "path": "/api/ingesta/gmail", "schedule": "0 * * * *" }] }
```

En Railway o cualquier otro host, un cron externo que llame a esa URL con la misma cabecera
sirve igual.

### Bandeja de revisión

En `/movimientos`, cada movimiento que vino de un correo tiene **ver correo**: asunto,
remitente, notas, link para abrirlo en Gmail y el JSON que devolvió el modelo. Las acciones son
**Confirmar**, **Editar y confirmar** y **Descartar** — esta última borra el movimiento y marca
el correo como ignorado para que no vuelva en la siguiente corrida.

---

## Fase 3: cartola bancaria

Notas para cuando se implemente.

**Banco Santander es la cuenta operativa.** De ahí sale la cartola principal, con todos los
pagos y cargos. Es la fuente que va a cubrir lo que Gmail no ve: los tres cargos de la
categoría *Bancos*, las nóminas, y los proveedores que cobran por tarjeta sin mandar correo.

**Banco de Chile es solo la línea de crédito.** Aporta los giros y las amortizaciones que
alimentan la fila *Financiamiento* del flujo.

**Los pagos internacionales pasan por Global66.** Sale un solo monto en pesos desde Santander
hacia Global66, agregado por varios colaboradores, y desde ahí salen los dólares. Ese monto en
pesos de la cartola **es el valor real**: ya trae dentro el tipo de cambio y el spread de
Global66.

**La glosa del banco no dice "Global66" en ninguna parte.** La cuenta de Global66 está a nombre
de la misma sociedad, así que el envío aparece como:

```
0765137659 Transf a Japybrand SPA
```

19 transferencias entre enero y septiembre de 2026, **−15.143.551** en total. Ese es el vehículo
de *todos* los pagos internacionales. Hay una regla de clasificación cargada para ese patrón,
apuntando a *Pago de servicios Internacional*, sin proveedor: el cargo no es un gasto en sí, es
el traspaso que después se reparte.

El patrón lleva la `a` a propósito. `Transf. Japybrand SPA` **con punto** es un abono de
entrada (hay uno en enero por 196.651), no un envío: si el patrón fuera solo `Japybrand SPA`
se clasificaría también la plata que entra.

El envío no siempre es uno por mes: abril tiene 6 transferencias y agosto 4.

El tipo de cambio de Global66 **no llega por correo**, vive dentro de su aplicación, así que no
hay nada que leer de Gmail para esto. La fase 2 deja el `montoCLP` como una estimación con el
dólar observado, marcada `PAGO PREVISTO (CLP estimado)`, y ahí se queda hasta que llegue la
cartola.

Lo que tiene que hacer la app en esta fase:

1. Detectar la transferencia a Global66 en la cartola de Santander.
2. Cruzarla con los **pagos previstos** de los colaboradores incluidos en ese envío —los
   movimientos `gmail` en estado `por_revisar` con `montoOriginal` en USD de *Pago de servicios
   Internacional*, del período que corresponda.
3. Reemplazar el `montoCLP` estimado de cada uno por el **real**, repartiendo la transferencia
   según los montos en dólares.
4. Registrar la **diferencia entre el estimado y el real** como **costo de Global66**, en su
   propia categoría dentro del grupo `proveedores`. Hoy ese costo está escondido dentro del
   monto de cada colaborador y no se ve en ninguna parte.

El paso 4 pide una categoría nueva, al mismo nivel que *Factoring*: se agrega en
`src/lib/catalogo.ts` y la recoge el `db:seed`.

### Antes de conciliar: la brecha de Internacional

**Hay que entender esta brecha antes de tocar nada.** La categoría *Pago de servicios
Internacional* del Excel no cuadra con lo que de verdad salió hacia Global66:

| Mes | Excel (confirmado) | A Global66 | Brecha | Envíos |
|---|---:|---:|---:|:---:|
| Ene | 0 | 1.830.133 | −1.830.133 | 1 |
| Feb | 2.143.685 | 2.175.121 | −31.436 | 1 |
| Mar | 2.008.763 | 2.180.000 | −171.237 | 1 |
| Abr | 3.129.984 | 3.204.984 | −75.000 | 6 |
| May | 3.050.292 | 3.123.427 | −73.135 | 3 |
| **Jun** | 1.653.264 | **467.627** | **1.185.637** | 1 |
| **Jul** | 2.113.182 | **476.213** | **1.636.969** | 1 |
| Ago | 930.233 | 1.399.097 | −468.864 | 4 |
| **Sep** | 2.206.568 | **286.949** | **1.919.619** | 1 |
| **Total** | **17.235.971** | **15.143.551** | **2.092.420** | 19 |

La brecha **no está repartida**, y son dos fenómenos distintos:

- **Febrero a mayo y agosto**: se transfirió *un poco más* que la suma de los pagos. Esa
  diferencia negativa (entre 31 mil y 469 mil) es exactamente lo que se busca: **el costo y el
  spread de Global66**.
- **Junio, julio y septiembre**: se transfirió *muchísimo menos* que lo que el Excel dice que se
  pagó. Entre los tres suman **4.742.225** de diferencia. O esos pagos salieron por otra vía, o
  el Excel tiene montos que nunca se pagaron. **Esto hay que resolverlo antes de conciliar**, o
  el reparto proporcional va a repartir plata que no existe.
- **Enero** transfiere 1.830.133 contra 0 en el Excel: es el mismo hueco de enero que arrastra
  la fase 1.

> Sobre las cifras: el total del año completo de la categoría es **21.096.975**, pero ese número
> incluye octubre a diciembre proyectados y los pagos previstos de Gmail que están por revisar.
> Comparado contra nueve meses de cartola da una brecha aparente de ~6 millones que no es real.
> La comparación pareja —enero a septiembre, solo movimientos confirmados— da **2.092.420**.

**Pendiente aparte:** cambiar el correo de facturación a `finanzas@japybrand.cl` en los
proveedores que todavía no tienen remitente. Hoy hay 41 proveedores activos sin ninguno, y
varios (AWS, Google Workspace, Adobe, Claude, Monday, Metricool) sí facturan por correo —
probablemente llega a otra casilla.

---


## Fase 4: Registro de Ventas del SII

Los archivos van en `sii/ventas` y `sii/compras`, que están en `.gitignore` porque son
datos tributarios reales. CSV con separador punto y coma y codificación **Latin-1** — leerlos
como UTF-8 rompe los nombres con acentos.

```bash
npm run importar-ventas
```

**El período viene en el nombre del archivo**, `RCV_VENTA_76513765-9_202608.csv`, no adentro:
dentro solo hay fechas de documento, que pueden caer en otro mes. Por eso una nota de crédito
de agosto puede anular una factura de julio.

### Las reglas

| Tipo | Qué es | Efecto |
|---|---|---|
| 33 | Factura afecta | suma |
| 34 | Factura exenta | suma |
| 61 | Nota de crédito | **resta** |
| 48 | Comprobante de pago electrónico | **no viene en el detalle** |

El tipo 48 el SII lo entrega solo como resumen mensual. Es la causa de las diferencias chicas
contra la planilla, que sí los cuenta: −84.000 en enero, −168.000 en febrero, −210.000 en mayo,
+182.000 en julio, +476.000 en septiembre, y así.

La clave única es `(tipoDocumento, folio)`, así que recargar el mismo archivo actualiza en vez
de duplicar. Verificado contra los 123 documentos del período: cero colisiones, y los rangos de
folio no se pisan entre tipos (33 va 479–581, 34 va 638–654, 61 va 60–64).

### La planilla infla las ventas del año en 3.770.221

**Esto está sin corregir a propósito.** En julio se emitieron **dos facturas idénticas** a LA
COMEDIA TICKETERA SPA: folios **551 y 552**, ambas del 01/07/2026, ambas por **3.770.221**. En
agosto el SII registra la **nota de crédito folio 64**, que en su campo de referencia apunta a
`33/551` y anula el duplicado.

La planilla contó las dos facturas de julio y **nunca aplicó la anulación**. De ahí sale la
diferencia de −3.770.221 en agosto, y por eso el total del año de la planilla (113.717.795)
está por encima del SII (109.975.574) en 3.742.221.

No es que falte una venta en agosto: **sobra una venta en julio**.

Por eso el reporte muestra siempre las notas de crédito **con el documento que anulan**, no
solo el monto: una 61 suelta es un número sin sentido, y solo al resolver la referencia se ve
que está corrigiendo otro mes. El reporte marca aparte las notas cuyo documento referenciado
es de un mes distinto, y detecta si hay documentos gemelos.

### El ranking agrupa por RUT

Por razón social no sirve: el RUT `76495359-2` viene escrito de dos formas —"RC INGENIERIA" y
"RC INGENIERA"— y agrupando por nombre aparece dos veces con la mitad del monto cada una. Son
18 RUT contra 19 razones sociales. Se muestra el nombre del documento más reciente.

Los tres primeros clientes concentran el **77,6%** de la facturación del año.

### La fila "Ventas del mes" del flujo es híbrida

**Si el mes tiene documentos del SII cargados, manda el SII. Si no, cae al `ValorManual`** que
dejó la planilla. Así enero a septiembre son facturación real y octubre a diciembre siguen
proyectados.

Las celdas que vienen del SII salen marcadas `SII` en la grilla y **no se editan a mano**: la
grilla las bloquea y `guardarValorManual` también las rechaza, por si la acción se invoca
directo. Las de los meses proyectados siguen siendo editables.

`Categoria.esManual` sigue en `true` para esa fila: el `ValorManual` es el respaldo, no un
resto. Lo que decide es `FilaFlujo.origenPorMes`, que dice mes a mes de dónde salió el número.

Efecto de pasar de la planilla al SII: el año baja de **151.877.300** a **148.135.079**, y el
flujo de caja financiero de diciembre cae de −486.803 a **−4.229.024**. La mayor parte de esa
caída son los 3.770.221 de la nota de crédito que la planilla nunca aplicó.

```bash
npm run comparar-ventas   # muestra el antes y el después, sin escribir nada
```

### La pantalla /ventas

Detalle por mes (documentos, notas de crédito, exento, neto, IVA débito, total facturado y la
diferencia contra la planilla), las notas de crédito con el documento que anulan —destacadas en
ámbar cuando corrigen otro mes— y el ranking de clientes del año con **el porcentaje que
representa cada uno sobre la facturación**, con barra de participación.

### Compras del SII (implementado en la fase 7)

**No implementado todavía.** Los archivos ya están en `sii/compras` y el formato quedó
verificado: 72 documentos entre enero y septiembre, **13.812.808** en total con **2.263.714**
de IVA recuperable.

Ese monto está **muy por debajo de los egresos reales** —132 millones de cargos en la cartola
del mismo período— porque la mayoría de los proveedores son extranjeros (AWS, Google, Anthropic,
Verpex, Monday) y no emiten documento tributario chileno. Solo lo comprado en Chile genera
crédito fiscal.

Para el F29 lo que importa es el cruce: **IVA débito** desde las ventas (17.334.791 en nueve
meses) menos **IVA crédito** desde las compras (2.263.714), que es lo que explica por qué los
pagos de IVA de la fila de impuestos son tan altos.

Dos diferencias de formato respecto de ventas, ya verificadas: la columna del IVA se llama
`Monto IVA Recuperable` y no `Monto IVA`, y aparece el tipo **46** (factura de compra) además
de 33, 34 y 61.

---

---

## Fase 5: obligaciones con calendario

Cuatro convenios de la Tesorería y la línea Fogape de Maxxa son deuda con calendario cerrado:
se sabe cuánto y hasta cuándo. Antes vivían como valores sueltos en las filas de deudas del
Excel, con la estimación que se hizo al empezar el año. Ahora tienen modelo propio y el
calendario manda sobre la planilla.

### El calendario se deriva desde el final, no desde el principio

El dato firme de un convenio no es cuándo empieza sino **cuándo termina**: la fecha de la
última cuota y cuántas quedan. El portal de TGR informa "7 cuotas pendientes más una por
generar, última el 30-04-2027", y de ahí se cuenta hacia atrás.

Comprobación de que la derivación es correcta: los cuatro convenios suman **28.361.006** en
cuotas ya emitidas y **30.327.911** contando las cuatro por generar. Las dos cifras coinciden
al peso con lo que informa el portal.

| Obligación | Marco | Cuota | Cuotas | Desde | Hasta |
|---|---|---:|---:|---|---|
| TGR 100309 | Ley 20.780 | 320.954 | 8 | sep 2026 | abr 2027 |
| TGR 133768 | ProPyme | 110.444 | 15 | sep 2026 | nov 2027 |
| TGR 248426 | ProPyme | 1.233.109 | 17 | sep 2026 | ene 2028 |
| TGR 257782 | ProPyme | 302.398 | 17 | oct 2026 | feb 2028 |
| Maxxa Fogape | Fogape | 870.000 | 15 | may 2026 | jul 2027 |

**La última cuota de cada convenio nace en estado `por_generar`.** TGR emite las cuotas por
tramos y siempre deja una sin emitir: está comprometida y hay que pagarla, pero todavía no
existe como documento. Contarla junto a las emitidas mentiría sobre lo que ya está exigible;
no contarla mentiría sobre lo que se debe.

**Las cuotas se materializan, no se calculan al vuelo.** Se derivan una vez y quedan como
filas de `CuotaObligacion`, para poder marcarlas pagadas y enlazarlas al cargo del banco.

**Un cargo puede pagar varias cuotas.** El pago del 07/09/2026 por 431.398 cubrió la cuota de
septiembre de dos convenios a la vez (320.954 + 110.444, exacto). Por eso
`CuotaObligacion.movimientoBancarioId` **no** lleva `@unique`.

### La carga fija mensual

El peak son siete meses seguidos a **2.836.905**, de octubre de 2026 a abril de 2027, con los
cuatro convenios y el Fogape corriendo juntos.

### El calendario pisa a la planilla en el flujo

`ObligacionFinanciera.categoriaId` dice qué fila del flujo alimenta cada obligación. Desde el
primer mes con cuota, el calendario **reemplaza** el `ValorManual` y la celda queda marcada
`cuota`. Reemplaza y no suma: la planilla ya traía una estimación de esa fila, y sumarle el
calendario contaría la cuota dos veces.

Lo que corrige en concreto: la planilla suponía 1.664.507 al mes de septiembre a diciembre en
`TGR convenio`, pero el convenio 257782 se activó el 04/09 y sube la cuota a **1.966.905**
desde octubre. Son 907.194 más en el último trimestre que la planilla no veía.

### La línea Fogape venía mal en dos puntos

La tabla de desarrollo de Maxxa (8.700.000, abierta el 06/04/2026, girada por completo)
mostró que el Excel tenía razón en casi todo menos en dos cosas: mayo fueron **4.834.000** de
financiamiento y no 4.000.000, y la cuota de julio fueron **872.542** y no 870.000 — los 2.542
son interés de mora por pagar el 07/07 en vez del 05/07.

**Penta Hipotecario es la razón social de Maxxa.** Sus cargos son cuotas del Fogape y van a la
fila de deudas, no a la de financiamiento: ahí restarían del desembolso mientras la fila de
cuotas ya cuenta la amortización, o sea doble conteo con el signo cambiado.

### ERPyme cobra dos cosas distintas

Por la plataforma de Maxxa pasan la suscripción mensual del ERP (entre 42.500 y 43.800) y la
cuota del Fogape. El 06/08/2026 hay dos cargos `Compra ERPYME` el mismo día: 43.744 y 870.000.
Una resolución en lote los mandó a los dos al proveedor Maxxa ERP, y agosto quedó con la cuota
contada dos veces.

Se resolvió con **dos** reglas, y que sean dos no es opcional:

| Patrón | Monto | Destino |
|---|---|---|
| `Compra ERPYME` | 870.000 | Fogape - cuotas |
| `Compra ERPYME` | cualquiera | Sistema comercial / Maxxa ERP |

El motor evalúa reglas **antes** que los alias, y un patrón que calza sin regla que cubra el
monto deja el cargo sin conciliar (`monto_sin_regla`). Con solo la regla de 870.000, los nueve
cobros de la suscripción habrían dejado de resolverse por alias y caído a la bandeja.

> Al crear una regla con monto exacto, revisa siempre que exista la general del mismo patrón.

### Cotizaciones previsionales: modelo aparte

Van separadas de las obligaciones a propósito. Un convenio es un compromiso con calendario
conocido de punta a punta. Una cotización nace cada mes con la remuneración y no tiene
calendario pactado; lo que importa de ella es si está al día y cuánto se atrasó.

**El período es el mes que se cotiza, no el mes en que se paga.** La de mayo de 2026 se pagó
el 05/06. Confundirlos desalinea todo el rezago.

**Se guardan dos montos.** `monto` es lo que salió de la cuenta y `montoCertificado` lo que
Previred certifica por Felipe Molina. La diferencia es lo cotizado por Cristián Andrés, que
estuvo hasta mayo de 2026; en junio quedan 40.617, su mes parcial antes del finiquito.

De enero a octubre de 2025 no hay cartola, así que ahí `monto` es el certificado y no el cargo
real. Queda anotado en la nota de cada período.

**"Pagar dos períodos juntos" son dos planillas el mismo día**, con folios correlativos y dos
cargos separados — no un cargo por los dos períodos. La cartola del 23/02/2026 lo muestra
directo: 418.532 con folio 404332975 y 411.100 con folio 404333366, noviembre y diciembre de
2025. Como el certificado da el mismo monto para los dos meses (373.039), lo que los ordena es
el folio: al ponerse al día se paga primero el período más viejo.

**El atraso se mide contra el día 13 del mes siguiente**, que es el vencimiento del pago por
internet. El peor fue noviembre de 2025 con 69 días. Durante 2026 el rezago se venía cerrando
—tres meses al día— hasta que julio quedó impago.

### El embargo de agosto estaba anotado dos veces

El Excel registraba a mano `TGR pie inicial` 1.014.705 + `TGR convenio` 752.352 en deudas, y
además `Santander Pagos TGR` 1.763.883 en impuestos, que es el "Embargo Judicial" de la
cartola. Es el mismo hecho. Manda la cartola: las dos filas de deudas quedaron en cero y el
embargo se mantiene en impuestos.

### El flujo se extiende más allá de diciembre

`calcularFlujo(anio)` no se tocó: es la réplica verificada del Excel y el contrato con la
planilla original. Encima va `calcularHorizonte(desde, hasta)`, que lo llama por año y corrige
el arrastre del saldo entre diciembre y enero.

Puede hacerlo sin recalcular nada porque **la cadena es lineal**: el saldo inicial de un mes es
el flujo financiero del anterior, y ese flujo es el saldo más una suma que no depende del
saldo. Una diferencia constante en el saldo de enero se propaga igual a los doce meses, así
que basta sumársela a las cuatro filas encadenadas.

La vista vive en `/flujo?horizonte=1` y es de solo lectura.

### Tercer estado del mes: incompleto

Al principio del proyecto un mes era **real** (hay cartola) o **proyectado** (no la hay). 2027
y 2028 obligaron a un tercero: **incompleto**. Son meses que existen solo porque hay deuda
comprometida ahí; no tienen ingresos ni gastos operacionales cargados.

Su saldo no es un pronóstico de caja sino cuánto hay que generar para cubrir la deuda. Se
marca con trama propia, distinta de la de los proyectados, porque el problema es otro: en un
mes proyectado falta la cartola, en uno incompleto falta el negocio entero.

Es una decisión deliberada no arrastrar el patrón de octubre a diciembre hacia 2027: esa
proyección ya demostró ser irreal, y es preferible ver el compromiso limpio que un pronóstico
inventado.

### Cerrar la bandeja: qué se ignora y por qué

La bandeja llegó a tener 626 movimientos sin conciliar. Bajarla no es marcar todo
como resuelto: cada grupo se cerró con un criterio que queda anotado en la nota de
cada movimiento.

**Los cobros de factura se ignoran, no se asignan.** Son 128 abonos por 104.406.148.
Es plata real que entró, pero el Registro de Ventas del SII ya la cuenta en la fila
"Ventas del mes": asignarlos al flujo duplicaría los ingresos. La fila de ventas se
alimenta de lo facturado, no de lo cobrado.

Antes de ignorarlos en bloque hay que separar los abonos que **no** son cobros,
porque esos sí deben entrar al flujo. Los que aparecieron:

| Glosa | Mov | Qué es |
|---|---:|---|
| `Transf. Japybrand SPA` | 1 | La cuenta propia en Global66: es plata que vuelve |
| `Reverso Compra WebPay` | 7 | Reversos de compra con tarjeta |
| `Transf. Syt Impresores` | 1 | SyT es proveedor (neto −374.430 en el año): es una devolución |
| `Transf. Alvaro Ramiro R` | 9 | 2.500 exactos todos los meses, demasiado regular para ser una factura |

Los reversos de WebPay tienen su propia gracia: los siete abonos del 17 y 20 de
agosto y las siete `Anulación Rev. Compra WebPay` del 19 suman **exactamente cero**.
Es ruido de tarjeta que entra y sale.

**Dos falsas alarmas que conviene no repetir.** Los abonos `F.5xx JAPYBRAND PUBLIC`
parecen de la cuenta propia por el nombre, pero vienen del RUT 76.680.934-0 pagando
facturas nuestras por folio: son cobros. Y varios abonos a nombre de personas por
63.000 o 42.000 repiten el mismo monto entre pagadores distintos, o sea tarifa
estándar: también son cobros.

**Los gastos operacionales con glosa `Compra` crean movimiento, no solo alias.** Un
alias identifica al proveedor pero no mete el gasto al flujo. Estos cargos —Freepik,
Figma, DataForSEO, YITH, Acepta, BlueSnap, Dodo Payments, CapCut, Entel, A2E AI,
Trae y Google ADS— no estaban en el Excel, así que sin crear el `Movimiento` el
gasto seguiría invisible. Son 18 movimientos por 472.450 al año.

**Los gastos personales se ignoran con motivo.** 32 movimientos: supermercado,
combustible, restaurantes, YouTube, compras en MercadoPago. Se registran como
ignorados en vez de borrarse, para que la cartola siga cuadrando al peso.

### Pagos directos de giros F21

Los 17 cargos `PAGO EN LINEA T.G.R.` de febrero a julio de 2026 son anteriores a
todos los convenios: el primero se activó el 07/05 y su primera cuota es de
septiembre. Son giros F21 pagados directo.

Van a las mismas filas que las cuotas, porque contablemente es la misma deuda con la
Tesorería; lo que los separa es la nota `pago directo de giros F21, anterior a los
convenios`. Sin esa marca, dentro de seis meses nadie podría distinguir un pago
directo de una cuota mirando el flujo.

Mayo es la excepción: el cargo del 08/05 por 771.640 activó el convenio 100309 el
07/05 y el Excel ya lo tenía anotado en `TGR pie inicial` con 771.495. Y el del
07/09 por 257.342 es el pie inicial del 257782, activado el 04/09.

De los siete meses, solo marzo y mayo estaban en la planilla. Los otros cinco
—1.557.498 en febrero, 1.554.355 en abril, 2.732.961 en junio, 183.432 en julio—
son 6,0 millones que el Excel simplemente no registraba.

### Un valor huérfano pendiente de revisar

`Pago de giros` tiene 1.519.742 en mayo dentro de impuestos y **ningún cargo de la
cartola lo explica**: no calza con ninguno del mes, ni solo ni sumado, y el único
T.G.R. de mayo son los 771.640 del pie inicial. Queda anotado en
`Categoria.nota` como candidato a ser la misma deuda contada dos veces. Pendiente de
revisar con el contador.

### El Excel ya no puede pisar lo que vino del banco

`ValorManual.origen` dice de dónde salió cada valor: `excel` o `banco`. El
importador solo escribe encima de los que dicen `excel`, y cuenta los otros como
**filas protegidas**.

Sin este guardia, cada `npm run importar` deshacía en silencio una sesión entera de
correcciones: el saldo inicial real de enero volvía a cero, los pagos de F21
desaparecían y el giro de mayo del Fogape volvía a los 4.000.000 de la proyección.

La marca no se pone a mano. Un valor viene del banco si hay un movimiento bancario
conciliado apuntando a esa fila en ese mes, y `scripts/marcar-origen-banco.ts`
deriva la marca desde ahí. Solo tres casos van explícitos porque no tienen
movimiento asociado: el saldo inicial, que sale de la cabecera de la cartola, y los
dos ceros de agosto de TGR, que son una corrección y no un monto.

> **Al renombrar una fila del flujo hay que cambiarla también en
> `src/lib/catalogo.ts` y en `FILAS_MANUALES` de `scripts/importar-excel.ts`.** Si
> no, el importador la recrea con el nombre viejo y el mes se cuenta dos veces.
> Pasó al renombrar `BRC - acuerdo de pago`.

### El saldo inicial de enero

La planilla traía 0. La cartola de enero, cuyo período es 30/12/2025–30/01/2026,
abre en **2.689.881**, y entre el 30/12 y el 01/01 no hay movimientos —el primero es
del 02/01— así que ese es el saldo al 1 de enero. La cadena de saldos de las nueve
cartolas calza una con otra, cada saldo final con el inicial de la siguiente.

### Ingresos que el SII no cuenta

`Ventas del mes` la pisa el Registro de Ventas en todo mes con documentos, así que
un ingreso escrito ahí desaparecería en el siguiente cálculo, sin error visible. Los
cobros sin factura van a una fila aparte, **`Ingresos no facturados`**, que el SII no
toca. Hoy vive ahí el hosting mensual de un cliente: 2.500 al mes.

Es la contracara de ignorar los cobros de factura. Un cobro facturado ya está en la
fila de ventas y sumarlo duplicaría; uno no facturado no está en ninguna parte y hay
que agregarlo.

### No compilar producción con el servidor de desarrollo encendido

`npx next build` escribe en el mismo `.next` que usa `next dev`. Correrlo con el
servidor arriba deja la app sin estilos: HTML plano, sin CSS. Se arregla parando el
servidor, borrando `.next` y reiniciando.

### Las planillas de colaboradores no dicen qué está pagado

Las planillas de Jimena Simos, Juan Pablo Ruiz, Fernando Vela y Angelina Solano son
**fuente confiable de los montos facturados**, y de nada más. Sus estados de pago
están desactualizados: arrastran meses que ya se regularizaron.

Restar lo enviado a lo que dicen las planillas parece una forma razonable de sacar
la deuda, y da un número completamente falso. Esa resta arrojaba 3.134.062
pendientes con Juan Pablo cuando lo real son 1.467 USD, porque sus atrasos de mayo
y junio se corrieron a agosto y se acordó pagarlos en cuotas — un hecho que ninguna
planilla registra.

**La deuda con colaboradores se declara, no se deduce.** Vive como `Movimiento` con
`fuente: 'compromiso'` en el mes en que se espera pagarla, así que la vista de
pendientes de `/obligaciones` y el flujo son el mismo dato y no se pueden
contradecir. Se carga con `npm run compromisos`.

Al 08/09/2026 la deuda es solo de agosto: 1.467 USD con Juan Pablo Ruiz y 600 con
Fernando Vela. Convertidos al último tipo de cambio realmente pagado —934,50 de la
conversión Global66 del 04/09— son **1.931.612** que salen en octubre.

Se usa el tipo de cambio de Global66 y no el dólar observado porque es el precio al
que Global66 vende de verdad, que es lo que va a costar pagar esa deuda.

---

## Fase 6: Global66, la cuarta fuente

Los pagos internacionales no salen uno a uno desde Santander: se transfiere un monto
a la cuenta propia en Global66 y desde ahí se paga a cada colaborador. La cartola
solo ve la transferencia total, así que durante un tiempo el reparto hubo que
estimarlo.

**La estimación se equivocaba justo donde importaba.** Repartir a prorrata mostraba a
todos parcialmente pagados en junio y julio, cuando la verdad es que solo alcanzó
para uno. Y un modelo que calculaba un "tipo de cambio efectivo" repartiendo toda la
transferencia entre los dólares del mes daba costos **negativos** en abril y julio,
porque ignoraba que la cuenta arrastra saldo en dólares de un mes a otro.

### El export cuadra contra Santander al peso

`USD × tipo de cambio + costo de cambio` reproduce el cargo de la cartola:

| Mes | USD | TC | + costo | Santander | dif |
|---|---:|---:|---:|---:|---:|
| Feb | 2.511,51 | 859,13 | 17.400 | 2.175.121 | **7** |
| Mar | 2.321,56 | 910,85 | 65.400 | 2.180.000 | **7** |
| May | 3.382,13 | 895,52 | 94.637 | 3.123.427 | **18** |
| Jun | 500,00 | 914,68 | 10.287 | 467.627 | **0** |
| Sep | 300,00 | 934,50 | 6.599 | 286.949 | **0** |

Junio y julio compran exactamente 500 USD: solo para Jimena. El costo real de
Global66 es **425.937 en el año, un 3,2%** entre comisiones de envío (5 USD cada
uno) y spread del cambio, contra el 11,5% que daba la estimación.

### Tres decisiones del reparto

**El tipo de cambio se pondera por dólares comprados.** En abril hay cinco
conversiones de tamaños muy distintos y un promedio simple le daría el mismo peso a
una de 25 dólares que a una de 2.171.

**No se atribuye a cada envío la conversión exacta que lo financió.** Los dólares
son fungibles y la cuenta arrastra saldo entre meses, así que esa atribución sería
inventada. Lo que sí cuadra, y al peso, es el total del mes.

**El export reemplaza a la planilla en los meses que cubre.** La fila "Pago de
servicios Internacional" traía los montos de las planillas, que dicen lo facturado y
no lo pagado. Lo que se dejó de pagar no desaparece: vive como compromiso declarado.

### Enero 2026 queda pendiente

Se transfirieron **1.633.482** a Global66 y no hay ninguna conversión en la cuenta
USD ese mes. Probablemente siguen en el monedero en pesos. Hasta confirmarlo, esa
transferencia se queda sin conciliar en vez de inventarle destino ni cargársela al
costo de Global66, que la haría parecer una comisión del 90%.

### La detección de tipo mira el contenido, no el nombre

El export se llama `movements-01-2026_09-2026.xls`: el nombre no dice qué es, trae
el rango en vez del período, y la extensión es `.xls` aunque por dentro sea xlsx. Por
nombre se confundiría con una cartola de Santander. `esExportGlobal66()` decide por
el nombre de la hoja y su cabecera, y el período real sale de la fila 2.

Es la primera fuente de `/cargar` que no se puede reconocer por el nombre del
archivo, y por eso `detectarTipo` ahora recibe también el contenido.

### Global66 tiene dos modalidades de pago

1. **Conversión a la cuenta USD y luego envío.** Es lo habitual desde febrero de
   2026, y es lo que aparece en el export "Movimientos de cuenta USD".
2. **Envío internacional directo desde el monedero en pesos**, con la conversión
   dentro de la misma operación. **No deja rastro en la cuenta USD.**

Enero de 2026 usó la segunda, y por eso mostraba 1.633.482 transferidos desde
Santander sin ninguna conversión en el export. Los pagos existían; estaban en los
movimientos CLP.

> Al revisar un mes de Global66 hay que mirar **las dos** cuentas. Un mes sin
> conversiones en el export USD no significa que no se pagó.

Enero cuadra al peso: Santander cargó 1.830.133 y devolvió 196.651, neto 1.633.482,
que es exactamente la suma de los dos envíos y sus dos costos de cambio (Angelina
Solano 1.324.126 + 27.022, Jimena Simos 271.041 + 11.293). Ambos con glosa "PAGO
SERVICIOS FREELANCE INTERNACIONAL DICIEMBRE 2025".

La devolución de 196.651 no es un gasto negativo: el envío a Juan Pablo Ruiz no se
cursó porque se le pagó por PayPal el mismo día (`Compra PAYPAL *JUAN RUIZ`,
161.676). Se concilia con nota y sin crear movimiento, porque el egreso que compensa
tampoco se registra.

### Cuando una fuente real reemplaza al Excel, le pertenece el mes entero

El reparto de Global66 **borra** los movimientos del Excel de los meses que cubre, y
el guardia del importador que mira el movimiento previo no alcanza: si fue borrado,
no hay previo que proteger. Reimportar el Excel duplicaba la fila de pagos
internacionales.

Proteger por proveedor tampoco basta. En junio y julio solo cobró Jimena, así que un
guardia por proveedor dejaba que el Excel volviera a traer a Juan Pablo y a Fernando
Vela — precisamente a quienes no se les pagó. El export es el registro **completo**
del mes: si alguien no aparece es porque no cobró.

Por eso el guardia mira categoría y mes. No se generaliza a la cartola: ahí un cargo
identificado no dice nada sobre los demás proveedores del mes, y bloquear la celda
entera borraría gastos reales que solo están en la planilla.

---

## Fase 7: el panel en lenguaje de dueño

La app estaba pensada como planilla y pedía saber contabilidad para leerla. El panel
de inicio responde siete preguntas concretas, cada una con el número grande, una
frase que lo explica y, si hay que hacer algo, un verbo con fecha.

### El saldo acumulado del flujo no es plata

La grilla de `/flujo` cierra septiembre en −26 millones, pero la cuenta tiene 113.711
y nunca podría llegar ahí: simplemente no se paga todo. Ese número es la **brecha
acumulada** entre lo comprometido y lo que entró, no un pronóstico de caja.

Mostrarlo como "cuánta plata vas a tener" sería mentir. El panel proyecta hacia
adelante desde el saldo real del banco —saldo de hoy, más lo que falta cobrar del
mes, menos lo que falta pagar— y el resultado se lee como "te faltan X para cubrir
el mes", que es la pregunta verdadera.

La proyección queda **corta a propósito** cuando el registro de ventas del mes está a
medias, y el panel lo dice en vez de estimar desde promedios. Estimar desde promedios
es exactamente lo que hacía la planilla, y por eso fallaba.

### El IVA se calcula, no se estima

Con el Registro de Compras cargado, el IVA sale del F29: débito fiscal de las ventas
menos crédito fiscal de las compras, con arrastre de remanente. La planilla lo
estimaba y erraba en millones:

| Período | Planilla | Real | Diferencia |
|---|---:|---:|---:|
| Enero | — | 1.129.552 | +1.129.552 |
| Marzo | 637.943 | 2.836.484 | **+2.198.541** |
| Abril | 3.601.060 | 1.642.547 | **−1.958.513** |
| Agosto | 2.429.918 | 1.470.812 | −959.106 |

**El período y el mes de pago no son el mismo.** El F29 se declara y paga hasta el día
20 del mes siguiente, así que la fila de septiembre lleva el IVA del período agosto.
`ivaPorMesDePago()` hace esa traslación, y mira también diciembre del año anterior,
que se paga en enero.

**El remanente se arrastra.** Si el crédito supera al débito no se devuelve plata:
queda a favor y baja lo que se paga el mes siguiente. En 2026 nunca ocurrió, pero la
lógica está: sin ella, el primer mes con remanente mostraría un pago que no
corresponde.

**Un mes solo entra al flujo si tiene los dos registros cargados.** Con uno solo el
número sería un débito sin crédito, peor que la estimación que reemplaza.

### El SII repite documentos en líneas de continuación

El registro de compras trae el mismo documento varias veces con el mismo tipo, folio
y RUT pero **todos los montos en blanco**: son el detalle de otros impuestos, no
documentos nuevos. Sin saltarlas, el upsert por `(tipo, folio, rut)` pisa la fila
buena con ceros. Así desaparecían 15.165 de crédito en agosto y 24.270 en septiembre.

> Al importar cualquier registro del SII, una fila sin monto total es continuación de
> la anterior, no un documento.

### Reglas de diseño del panel

**El color solo comunica estado.** Aparece dos veces: en lo atrasado y en la plata que
falta. Si todo estuviera al día, el panel no tendría un solo color. Las barras y el
gráfico van en gris a propósito — colorearlos no agrega información y le resta fuerza
a lo que sí exige una decisión.

**Nada de jerga sin explicar.** "Débito fiscal" aparece siempre después de "le
cobraste a tus clientes", nunca solo.

**Lo que requiere acción lleva verbo y fecha.** "Paga en Previred antes del 13", no
"vence el 13".

**El orden es por urgencia, no por lógica contable**: cuánta plata hay, qué está en
rojo, qué viene. Los gráficos van abajo, después de lo importante, y el detalle fino
sigue viviendo en `/flujo` y `/obligaciones`.

---

## Fase 8: producción

Supabase para la base, Vercel para la app, Resend para los avisos. El dominio es
`caja.japybrand.com`.

### Las variables de Vercel se arman, no se copian a mano

`npm run preparar-vercel` escribe `.env.vercel` con las quince variables de
producción: las que se copian de `.env.local`, las que se generan nuevas y las que
faltan por completar. El panel de Vercel acepta pegar un `.env` entero en
*Settings → Environment Variables → Import .env*, así que es un solo pegado en vez
de quince campos.

**Ningún valor sale por pantalla**: el script imprime los nombres, el largo y de
dónde viene cada uno. Un secreto impreso en la terminal queda en el scrollback, en
el historial del shell y en la transcripción de la conversación, que son tres
lugares más de los que hacen falta para algo que ya está en un archivo del disco.
`.env.vercel` está en `.gitignore` y se borra apenas se pega.

Dos que no son intercambiables:

- **`AUTH_SECRET` y `CRON_SECRET` se generan nuevos.** No se comparte el secreto de
  desarrollo con producción: si el de desarrollo se filtra alguna vez, no debe
  servir para firmar sesiones reales ni para disparar el cron.
- **`ENCRYPTION_KEY` tiene que ser la MISMA.** Cifra el refresh token de Gmail que
  viaja en la migración. Con otra clave el token no se puede descifrar y hay que
  volver a autorizar el acceso a Gmail, que en modo prueba caduca cada siete días de
  todas formas.

### La migración quedó verificada el 09/09/2026

2.024 filas, 18 tablas, 933 enlaces por clave foránea y las seis cifras derivadas:
28 comprobaciones, todas correctas. PostgreSQL 17.6 en São Paulo.

Dos comprobaciones que solo se pueden hacer con los datos ya en Postgres:

- **Los campos de texto llegaron intactos.** 14.054 campos comparados contra el
  respaldo, cero diferencias, incluidos los seis proveedores con acento o ñ
  —Cabify Envíos, Mantención Débito Santander, Trizrán Zamora, Cristián Andrés,
  Damián Moreno, Carlos Millán—. Los 3.016 campos de fecha, comparados como ISO,
  también coinciden: no se corrió ninguna hora.
- **El helper de mayúsculas no era teórico.** Buscar "amazon" en minúscula encuentra
  8 cargos con `contiene()` y **0** con el `contains` crudo; "verpex" 56 contra 0;
  "transf a molina" 34 contra 0. En SQLite las tres daban lo mismo con o sin helper.
  Ese era exactamente el error silencioso que había que evitar.

### Después de migrar, el entorno local necesita un paso

`prisma/schema.prisma` queda con `provider = "postgresql"`, que es lo que Vercel
necesita para construir. Con el `DATABASE_URL` local todavía en `file:./dev.db`,
Prisma se niega a arrancar: el provider y la URL no coinciden.

Para volver a trabajar contra la copia local:

    npm run db:sqlite && npx prisma generate

Y para volver a producción, lo mismo con `db:postgres`. El `dev.db` y los respaldos
en JSON siguen intactos: lo único que cambia es contra qué motor se genera el
cliente.

### La clave de producción vive en un archivo aparte

Los scripts cargan `--env-file=.env.local --env-file=.env`, y en Node **el último
archivo gana**. Con `DATABASE_URL` en `.env.local` y el `file:./dev.db` todavía en
`.env`, los scripts habrían seguido escribiendo en SQLite mientras la aplicación
apuntaba a Supabase, sin ningún error visible: el peor tipo de falla, porque los dos
lados funcionan y dicen cosas distintas.

Por eso las credenciales de producción van en `.env.produccion`, que los comandos
`migrar:*` cargan de último y el entorno de desarrollo no carga nunca. `.env.local`
y `.env` quedan intactos y la app local sigue en SQLite mientras se migra.

`npm run migrar:probar` comprueba la conexión antes de escribir nada, y distingue
las tres formas de que falle: la clave sin codificar, la clave equivocada o el
proyecto todavía arrancando. Detecta además los caracteres que rompen una URL si no
van en `encodeURIComponent`. **Nada de lo que imprime lleva la contraseña**: los
errores de Postgres a veces traen la cadena de conexión completa, así que todo pasa
por un enmascarador antes de salir por pantalla.

### Los ids se conservan al migrar, y eso es todo lo que importa

`npm run exportar-datos` deja la base entera en `respaldo/datos-AAAA-MM-DD.json`;
el script que lo reconstruye en el otro motor se escribe cuando exista la base de
Supabase. No hay dump de SQLite que
PostgreSQL entienda —las fechas y los booleanos se guardan distinto—, así que el
JSON pasa por Prisma, que traduce los tipos en las dos direcciones.

Lo que hay que cuidar no es el volumen: son 2.025 filas. Es que los `cuid`
sobrevivan. Hay 986 enlaces por clave foránea, entre ellos 435 cargos bancarios que
apuntan a su movimiento, 6 cuotas de convenio y 8 cotizaciones que apuntan a su
cargo. Si al importar se generaran ids nuevos, el flujo seguiría cuadrando y "ya
pagado" daría cero: el error no se vería por ninguna parte. Por eso la importación
escribe el `id` explícito y el orden de tablas respeta las dependencias.

La verificación no cuenta filas, compara cifras derivadas: el saldo de hoy, el "ya
pagado" del mes y el flujo financiero de diciembre se calculan **recorriendo** esos
enlaces. Si dan lo mismo en los dos motores, la conciliación llegó entera.

El archivo lleva la cartola completa, los sueldos y el flujo del año. `respaldo/`
está en `.gitignore` por lo mismo que `cartolas/`.

### El motor de reglas no depende de la colación de la base

En SQLite `contains` se resuelve con LIKE, que en ASCII no distingue mayúsculas. En
PostgreSQL sí las distingue. Era el riesgo serio de la migración: que las reglas de
clasificación dejaran de calzar en silencio.

No ocurre. El motor de reglas y el calce de glosas normalizan en JavaScript
—`normalizarTexto`: mayúsculas, sin acentos, sin puntuación— y comparan con
`String.includes`. Nunca le preguntan a la base.

Lo que sí dependía eran los dos buscadores por texto, en `/banco` y en
`/movimientos`, donde escribir "santander" habría dejado de encontrar "PAC Seg.
Fraude Santander". Pasan por `contiene()` de `src/lib/consulta.ts`, que agrega
`mode: 'insensitive'` solo cuando la base es PostgreSQL: ese modificador no existe
en el conector de SQLite y pasarlo ahí es un error de validación, así que la
decisión se toma en tiempo de ejecución mirando `DATABASE_URL`.

### El refresh token de Google caduca a los 7 días

Mientras la app siga en modo **prueba** en la pantalla de consentimiento de Google,
los refresh tokens expiran a la semana. La ingesta de Gmail va a dejar de funcionar
cada siete días y el síntoma es un error de token inválido, no un bug de la app.

Las salidas son dos: volver a entrar y autorizar cada semana, o publicar la app en
la pantalla de consentimiento. Con un solo usuario y un scope de solo lectura la
verificación de Google es trámite, y es lo que corresponde hacer si esto va a quedar
funcionando solo.

### Una deuda declarada no se puede contar dos veces

PayPal avisó por los 1.467 USD de Juan Pablo Ruiz de agosto y la ingesta creó el
movimiento en septiembre, que es cuando llegó el correo. La misma deuda ya estaba
declarada como compromiso en octubre, que es cuando se paga. Septiembre quedó
inflado en 1.369.400 y **nada lo mostraba**: los dos registros están en meses
distintos, cada uno parece legítimo por separado y el flujo sigue cuadrando.

El anti-duplicado de la ingesta no podía verlo porque busca dentro del mismo mes.
Sirve para lo que fue pensado —que la primera corrida no recree los recibos que ya
trajo el Excel— pero un compromiso no está atado al mes en que llega la factura: la
factura de agosto llega en septiembre y se paga en octubre, tres meses y una sola
deuda.

`src/lib/duplicados.ts` compara contra los compromisos de todo el año y **en moneda
de origen** antes que en pesos: los dos registros de esta deuda quedaron en
1.369.400 y 1.370.912, distintos en pesos por el tipo de cambio del día e idénticos
en dólares. Se usa en tres lugares:

- La ingesta no confirma sola nada que repita un compromiso, y lo anota en la glosa.
- `confirmarMovimiento` se **niega** a confirmarlo. Es el único bloqueo duro de la
  pantalla. La salida, si se equivoca, es el formulario de edición: cambiar el monto
  o el proveedor ahí es un acto deliberado, no un clic de más.
- La bandeja lo muestra en la fila, no escondido tras el botón del correo.

El compromiso es la representación válida de la deuda; el correo de PayPal es un
aviso de cobro, no un pago. Por eso el que vuelve a la bandeja es el de la ingesta,
y vuelve **sin borrarse**: el rastro de que el proveedor cobró queda.

### Marcar pagado sin esperar a la cartola

La cartola se descarga a mano y llega cuando llega, así que entre pagar una cuota y
verla conciliada pasan días. En ese hueco la obligación seguía apareciendo pendiente
y el aviso por correo la reportaba como atrasada. Avisar por algo ya resuelto es el
camino más corto a que se dejen de leer todos los avisos.

La tarjeta **Pendiente de pago**, arriba de `/obligaciones`, lista las cuotas y
cotizaciones cuyo mes ya llegó y no están pagadas, con un botón para darlas por
pagadas. Es reversible: marcar por error se deshace en el mismo lugar.

`CuotaObligacion.fechaPago` puesta con `movimientoBancario` en null significa
**pagada por declaración**: alguien dice que salió, el banco todavía no lo muestra.
Cuando el cargo aparezca, la conciliación lo enlaza y quedan las dos cosas. Una
cuota que ya tiene cargo del banco **no se puede desmarcar** desde ahí: la cartola
manda, y para deshacer eso hay que romper la conciliación en `/banco`.

La distinción importa por una razón concreta: el **"ya pagado" del panel sigue
saliendo de la cartola**, no de esta marca. Una declaración no es evidencia de que
la plata salió de la cuenta, y el panel proyecta desde el saldo real del banco.

### Los cuatro avisos por correo

| Aviso | Cuándo evalúa | Condición | Repite |
|---|---|---|---|
| Falta cargar el mes anterior | día 11 | al mes anterior le falta cartola, registro de ventas o registro de compras | una vez |
| Cartola atrasada | lunes | el último movimiento bancario tiene más de 7 días | cada 7 días |
| Obligación por vencer | diario | cuota de convenio, cuota Fogape, cotización o F29 a 5 días o menos | una vez por obligación |
| Bandeja estancada | diario | hay movimientos por revisar creados hace más de 3 días | cada 7 días |

El día 11 y no el 1 porque el SII publica el registro del período dentro de los
primeros diez días y la cartola del mes cerrado llega en esa misma ventana: antes
del 11 el hueco es normal y avisar sería ruido.

Sin la tabla `AvisoEnviado` el aviso de una cuota que vence en cinco días llegaría
cinco veces y el de la bandeja llegaría todos los días. Un aviso que se repite se
deja de leer, y entonces deja de servir el día que trae algo nuevo. Los avisos que
describen un hecho —el día 11, una cuota concreta— no se repiten nunca; los que
describen una situación que persiste se repiten cada siete días mientras dure. Un
envío fallido no cuenta como avisado, así que se reintenta al día siguiente.

Las obligaciones van en un correo cada una y no en un resumen: cada una se paga en
su plataforma, y juntarlas obligaría a releer el mismo correo para ir tachando.

`npm run probar-alertas -- --fecha 2026-10-11` imprime lo que saldría ese día sin
mandar nada. Tres de las cuatro reglas dependen del calendario, así que sin poder
mover la fecha probarlas significaría esperar al día correcto.

Sin `RESEND_API_KEY` el envío no falla: escribe el correo en el log y sigue. Así el
cron se prueba entero sin gastar correos.

### El cálculo de vencimientos es uno solo

El panel mira 15 días y el correo 5. Estaban por escribirse dos veces, y con dos
implementaciones una se habría quedado atrás en el primer cambio: el correo diría
algo distinto de la pantalla a la que apunta. `src/lib/vencimientos.ts` lo resuelve
una vez y recibe la ventana como argumento.

### Una corrida diaria, y qué hacer si se queda corta

El plan Hobby de Vercel permite una sola corrida de cron al día, así que la ingesta
de Gmail y los avisos comparten `/api/ingesta/diario` a las 12:00 UTC, que son las
08:00 en Santiago en invierno y las 09:00 en verano. El día del mes y el día de la
semana se calculan con `Intl` sobre `America/Santiago`: con `new Date().getDate()`
el aviso del día 11 se dispararía el 10 por la noche la mitad del año.

Si una vez al día se queda corto para Gmail, la alternativa gratuita es un workflow
de GitHub Actions que llame al mismo endpoint cada hora. No cambia nada del código y
el secreto vive en GitHub Secrets:

```yaml
# .github/workflows/ingesta.yml
name: Ingesta de Gmail
on:
  schedule:
    - cron: '0 * * * *'
  workflow_dispatch:
jobs:
  ingesta:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -sS -f -X GET https://caja.japybrand.com/api/ingesta/gmail             -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

Queda anotado, no activado. GitHub no garantiza la puntualidad de los `schedule` y
puede saltarse corridas cuando hay carga, así que sirve para refrescar seguido pero
no para algo que deba ocurrir a una hora exacta.

### `maxDuration` era del plan que no tenemos

La ruta de ingesta declaraba 300 segundos, que es el tope del plan Pro. En Hobby la
función se corta mucho antes igual, pero el número hacía creer que había margen. Está
en 60. Si la ingesta no alcanza, la salida es bajar la ventana de días.

### `/api/cron/*` también queda fuera del middleware

El matcher excluía `api/ingesta`. El cron de Vercel llega sin cookie de sesión: si el
middleware tomara la ruta, devolvería un redirect al login y la corrida diaria
fallaría en silencio, con un 200 y una página HTML. Las dos rutas están fuera de la
sesión **a propósito**, así que todo lo que cuelgue de ellas tiene que validar
`CRON_SECRET` por su cuenta.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build y servidor de producción |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run importar` | Importa el Excel y verifica la cuadratura |
| `npm run remitentes` | Busca remitentes en Gmail desde la terminal |
| `npm run sincronizar` | Corre la ingesta de Gmail. Acepta `-- --dias N --revisar --desde F --hasta F` |
| `npm run reporte-banco` | Compara la cartola de Santander contra la app. No escribe nada |
| `npm run importar-ventas` | Importa el Registro de Ventas del SII y cuadra contra la planilla |
| `npm run comparar-ventas` | Muestra cómo cambia el flujo con las ventas del SII. No escribe nada |
| `npm run importar-cartolas` | Carga las cartolas en MovimientoBancario. `--firme` para aplicar |
| `npm run conciliar` | Concilia cartola contra movimientos. `--firme` para aplicar |
| `npm run aplicar-banco` | Reemplaza montos proyectados por los reales. `--firme` para aplicar |
| `npm run fogape` | Carga giros y cuotas de la línea Fogape desde la tabla de desarrollo. `--firme` |
| `npm run arreglar-erpyme` | Separa la cuota Fogape de la suscripción del ERP y crea sus reglas. `--firme` |
| `npm run cargar-obligaciones` | Carga convenios TGR, línea Fogape y cotizaciones previsionales. `--firme` |
| `npm run resolver-impuestos` | Reparte los pagos de T.G.R. y Previred entre filas del flujo. `--firme` |
| `npm run resolver-tgr-f21` | Asigna los pagos directos de giros F21 de feb-jul. `--firme` |
| `npm run cerrar-bandeja` | Ignora cobros y gastos personales, crea los gastos operacionales. `--firme` |
| `npm run resolver-syt-webpay` | Crea SyT Impresores con su devolución e ignora los reversos WebPay. `--firme` |
| `npm run ajustes-flujo` | Saldo inicial real, ingresos no facturados y acuerdo RC. `--firme` |
| `npm run marcar-origen-banco` | Marca qué valores manuales vienen de la cartola. `--firme` |
| `npm run compromisos` | Registra la deuda declarada con colaboradores como salida futura. `--firme` |
| `npm run clasificar-bandeja` | Clasifica retiros, servicios legales y el cargo partido de MOLINA OVALLE. `--firme` |
| `npm run importar-global66` | Importa el export de Global66 y reparte los pagos internacionales. `--firme` |
| `npm run global66-enero` | Carga los envíos directos desde el monedero CLP de enero. `--firme` |
| `npm run importar-compras` | Importa el Registro de Compras del SII y muestra el IVA. `--firme` |
| `npm run db:seed` | Solo precarga las categorías |
| `npm run db:studio` | Prisma Studio |
| `npm run preparar-vercel` | Arma `.env.vercel` para pegar en Vercel. No imprime valores |
| `npm run migrar:probar` | Comprueba la conexión con Supabase. No escribe nada |
| `npm run migrar:push` | Crea las tablas en Supabase con DIRECT_URL |
| `npm run migrar:datos` | Importa el respaldo a Supabase. `--firme` para aplicar |
| `npm run migrar:verificar` | Verifica la migración contra el respaldo |
| `npm run exportar-datos` | Respalda la base entera a `respaldo/`. No escribe en la base |
| `npm run proyeccion` | Recalcula las proyecciones de oct-dic desde el gasto real. `--firme` |
| `npm run revisar-duplicados` | Devuelve a la bandeja lo que repite un compromiso. `--firme` |
| `npm run probar-alertas` | Muestra qué avisos saldrían. `-- --fecha AAAA-MM-DD` y `--firme` |
| `npm run importar-datos` | Reconstruye el respaldo en la base destino. `--firme` para aplicar |
| `npm run verificar-migracion` | Compara filas, enlaces y cifras derivadas contra el respaldo |
| `npm run db:sqlite` / `db:postgres` | Cambia el provider de la base, con `directUrl` en Postgres |
