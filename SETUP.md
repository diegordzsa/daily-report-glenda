# Guia de Configuracion — Daily Report Template

Este template genera un reporte diario automatico que combina datos de **Meta Ads** y **Shopify**, genera un diagnostico con **Claude AI**, y lo envia a **Slack**.

---

## Configuracion actual de GLENDA

| Dato | Valor | Como se supo |
|---|---|---|
| Cuenta Meta | `SKIN+ MX` | `GET /act_<id>?fields=name` |
| TZ cuenta Meta | `America/Mexico_City` (UTC-6, sin DST) | `timezone_name`, `timezone_offset_hours_utc: -6` |
| Moneda Meta | EUR | `currency` + `account_currency` en insights |
| Tienda Shopify | `GLENDA®` | `GET /admin/api/2024-10/shop.json` |
| TZ Shopify | `America/Mexico_City` | `iana_timezone` |
| Moneda Shopify | MXN | `currency`, `money_format: "$ {{amount}}"` |
| Cierre del dia | **06:00 UTC** | 00:00 America/Mexico_City |
| `MIN_HOURS_AFTER_CLOSE` | 3 | Ver "Por que las 11:05" |
| Entrega | **11:05 Europe/Madrid** | Cron externo, no GitHub |
| Lector del reporte | Madrid | `STORE_LOCALE: es-ES` |

Todo medido el 2026-07-29 contra las APIs reales. Si cambia la timezone de la
cuenta en el Business Manager, el codigo lo detecta solo: lee `timezone_name` en
cada ejecucion y `META_ACCOUNT_TIMEZONE` es solo el fallback.

---

## Checklist Rapido

1. Crear un nuevo repo en GitHub usando este template
2. Configurar los 7 secretos requeridos en GitHub (Settings > Secrets and variables > Actions)
3. **Medir** la timezone y la moneda de la cuenta de Meta y de Shopify, y poner
   los valores en el bloque `env:` del workflow. No copiarlos de otra tienda.
4. Calcular la hora de entrega (ver "Por que no hay cron de GitHub")
5. Crear el cronjob externo en cron-job.org
6. Probar ejecutando el workflow manualmente (Actions > Daily Report > Run workflow)

---

## Secretos Requeridos

Configura estos 7 secretos en tu repositorio de GitHub:
**Settings > Secrets and variables > Actions > New repository secret**

### `STORE_NAME`
Nombre de tu tienda que aparecera en el reporte de Slack.
- Ejemplo: `Mi Tienda ES`, `Brand MX`, `Store US`

### `META_ACCESS_TOKEN`
Token de acceso de la Marketing API de Meta (Facebook/Instagram Ads).

**Como obtenerlo:**
1. Ve a [Meta Business Suite](https://business.facebook.com) > Business Settings
2. En el menu izquierdo: **Users > System Users**
3. Si no tienes un System User, crea uno con rol Admin
4. Haz clic en el System User > **Generate New Token**
5. Selecciona tu app y el permiso `ads_read`
6. Copia el token generado

> **Nota:** Los tokens de System User no expiran. Los tokens de usuario normal expiran en ~60 dias.

### `META_AD_ACCOUNT_ID`
El ID numerico de tu cuenta de anuncios de Meta (sin el prefijo `act_`).

**Como obtenerlo:**
1. Ve a [Meta Business Suite](https://business.facebook.com) > Business Settings
2. En el menu izquierdo: **Accounts > Ad Accounts**
3. Selecciona tu cuenta de anuncios
4. Copia el **Account ID** (solo los numeros, sin `act_`)
- Ejemplo: `2217973965310655`

### `SHOPIFY_STORE_DOMAIN`
El dominio `.myshopify.com` de tu tienda.

**Como obtenerlo:**
1. Ve al admin de tu tienda Shopify
2. El dominio esta en la URL: `https://TU-TIENDA.myshopify.com/admin`
3. Copia solo la parte `tu-tienda.myshopify.com`
- Ejemplo: `mi-tienda.myshopify.com`

### `SHOPIFY_ACCESS_TOKEN`
Token de Admin API de una Custom App de Shopify.

**Como obtenerlo:**
1. En el admin de Shopify: **Settings > Apps and sales channels > Develop apps**
2. Crea una app (o abre la existente)
3. En **Configuration > Admin API integration**, activa el scope `read_orders`
4. Instala la app en la tienda
5. En **API credentials**, copia el **Admin API access token**
- Formato: `shpat_...`

> Los scripts `get-shopify-token.js` y `exchange-token.js` del repo son ayudas
> puntuales para obtener ese token; el reporte no los usa en ejecucion.

### `ANTHROPIC_API_KEY`
API key de Anthropic para usar Claude.

**Como obtenerla:**
1. Ve a [console.anthropic.com](https://console.anthropic.com)
2. Inicia sesion o crea una cuenta
3. Ve a **API Keys** en el menu
4. Crea una nueva key y copiala
- Formato: `sk-ant-api03-...`

### `SLACK_WEBHOOK_URL`
URL de Incoming Webhook de Slack para enviar el reporte.

**Como obtenerlo:**
1. Ve a [api.slack.com/apps](https://api.slack.com/apps)
2. Crea una nueva app (From scratch) o usa una existente
3. En el menu izquierdo: **Incoming Webhooks**
4. Activa los webhooks (toggle ON)
5. Haz clic en **Add New Webhook to Workspace**
6. Selecciona el canal donde quieres recibir el reporte
7. Copia la **Webhook URL**
- Formato: `https://hooks.slack.com/services/T.../B.../...`

---

## Variables Opcionales

Estas variables tienen valores por defecto. Para cambiarlas, descomenta las lineas correspondientes en `.github/workflows/daily-report.yml`.

### Obligatorias por tienda (medir, no copiar)

Estas tres **no tienen default** y el reporte no arranca sin ellas. Son codigos
ISO, no simbolos: `$` es ambiguo (MXN o USD) y una conversion mal resuelta da
cifras falsas sin que nada falle.

| Variable | GLENDA | Como medirlo |
|---|---|---|
| `STORE_CURRENCY_ISO` | `MXN` | `shop.json` > `currency` |
| `META_CURRENCY_ISO` | `EUR` | `GET /act_<id>?fields=currency` |
| `REPORT_CURRENCY_ISO` | `EUR` | La moneda en la que quieres leer el reporte |

El **simbolo se deriva** de `REPORT_CURRENCY_ISO` + `STORE_LOCALE` (EUR + es-ES
da `€`). `REPORT_CURRENCY` existe solo como override manual.

Si `META_CURRENCY_ISO` y `REPORT_CURRENCY_ISO` no coinciden, el reporte **no se
publica**: el gasto de Meta se usa sin convertir. Y el codigo compara lo
configurado contra el `account_currency` que devuelve la propia API de insights,
asi que si la cuenta cambia de moneda se entera.

### Resto de opcionales

| Variable | Default | Cuando cambiar |
|---|---|---|
| `META_ACCOUNT_TIMEZONE` | `America/Mexico_City` | Fallback si falla la lectura de `timezone_name`. Debe ser la TZ de la cuenta de **Meta** |
| `MIN_HOURS_AFTER_CLOSE` | `3` | Solo con datos del probe de frescura. Nunca por corazonada |
| `STORE_LOCALE` | `es-ES` | Locale del **lector**, no de la tienda (`en-US`, `es-MX`, `pt-BR`) |
| `REPORT_TIME_LABEL` | `11:05 (Europe/Madrid)` | Si cambias la hora en cron-job.org, actualiza esto para que no mienta |
| `FX_FALLBACK_STORE_PER_REPORT` | `0` | Unidades de `STORE_CURRENCY_ISO` por 1 `REPORT_CURRENCY_ISO` (MXN por EUR). Solo se usa si la API de FX cae |
| `STORE_INDUSTRY` | _(vacio)_ | Para benchmarks especificos en el diagnostico de Claude |
| `ROAS_BENCHMARK` | _(vacio)_ | Para que Claude compare contra un benchmark de tu industria |
| `META_API_VERSION` | `v21.0` | Si Meta depreca esta version |
| `SHOPIFY_API_VERSION` | `2024-10` | Si Shopify depreca esta version |
| `CLAUDE_MODEL` | `claude-sonnet-4-6` | Para usar otro modelo de Claude |

---

## Subscription Tags (Opcional)

Si tu tienda tiene suscripciones y quieres trackearlas en el reporte, configura la variable `SUBSCRIPTION_TAGS` con un JSON array.

Cada entrada tiene:
- `tag`: El tag exacto que Shopify pone en las ordenes de suscripcion
- `label`: El nombre que aparecera en el reporte

**Ejemplo:**
```
SUBSCRIPTION_TAGS: '[{"tag":"Kaching Subscription First Order","label":"1ª Susc"},{"tag":"appstle_subscription_recurring_order","label":"Recurrentes"}]'
```

Si no defines `SUBSCRIPTION_TAGS` o lo dejas vacio, las metricas de suscripcion simplemente no aparecen en el reporte.

---

## Por que no hay cron de GitHub

El workflow **no tiene bloque `schedule:`**. Es deliberado.

GitHub encola los workflows programados y los arranca tarde, sin patron. Medido
sobre **21 ejecuciones reales de este repo** (9–29 jul 2026), comparando el cron
vigente en cada fecha contra el arranque real:

| Cron | Fechas | Arranque real (UTC) | Retraso |
|---|---|---|---|
| `0 3 * * *` | 9–22 jul (14 runs) | 05:17 – 06:36 | +2h17 a +3h36 |
| `0 7 * * *` | 23–28 jul (6 runs) | 08:54 – 10:32 | +1h54 a +3h32 |
| `15 6 * * *` | 29 jul (1 run) | 09:10 | +2h55 |

**Global: +1h 55min a +3h 36min, media +2h 41min.** El retraso no depende de la
hora elegida: cambiar el cron mueve la ventana, no la estrecha. Con esa
dispersion no se puede prometer una hora de entrega ni garantizar que el dia haya
cerrado.

El disparo lo hace **cron-job.org** contra la API de dispatches. Ver mas abajo.

---

## Por que las 11:05 Europe/Madrid

### 1. Cuando cierra el dia

El dia lo cierra la **timezone de la cuenta publicitaria**, no la del lector ni
UTC. Medido: `America/Mexico_City`, UTC-6, sin DST desde 2022.

**00:00 America/Mexico_City = 06:00 UTC.** Ese es el instante a partir del cual
"ayer" existe como dia completo.

### 2. Cuanto hay que esperar despues del cierre

Meta sigue agregando gasto durante horas tras el cierre. Un gasto subestimado
infla ROAS y MER, asi que **antes no publicar que publicar mal**.

Medido cruzando el gasto que reporto cada ejecucion contra el consolidado
posterior (7 ejecuciones, 22–28 jul 2026):

| Fecha | Reportado | h post-cierre | Consolidado | Error |
|---|---|---|---|---|
| 2026-07-24 | 391.61 | 2.92 h | 393.48 | −0.48 % |
| 2026-07-25 | 280.28 | 3.12 h | 281.42 | −0.41 % |
| 2026-07-28 | 285.21 | 3.18 h | 287.45 | −0.78 % |
| 2026-07-23 | 306.27 | 3.25 h | 307.88 | −0.52 % |
| 2026-07-22 | 373.67 | 3.31 h | 376.21 | −0.68 % |
| 2026-07-27 | 126.03 | 3.51 h | 127.28 | −0.98 % |
| 2026-07-26 | 288.92 | 4.54 h | 291.14 | −0.76 % |

Entre 2.9 h y 4.5 h el error es **plano y siempre por debajo**, en el rango
−0.4 % a −1.0 %. **Por debajo de 2.9 h no hay medicion.** De ahi
`MIN_HOURS_AFTER_CLOSE = 3`: no bajarlo sin datos del probe de frescura.

Cierre 06:00 UTC + 3 h = **09:00 UTC como hora mas temprana defendible**.

### 3. Traducido a la hora del lector

El lector esta en Madrid. El cron externo se configura **en Europe/Madrid, no en
UTC**, porque Mexico no cambia la hora y Madrid si:

| | Madrid | UTC | h post-cierre |
|---|---|---|---|
| Verano (CEST, UTC+2) | 11:05 | 09:05 | 3.08 h |
| Invierno (CET, UTC+1) | 11:05 | 10:05 | 4.08 h |

Fijandolo en hora de Madrid, la hora local se mantiene todo el año y **en
invierno el dato llega incluso mas consolidado**. Simulados los 365 dias de 2026,
el minimo anual de horas post-cierre es 3.08 h: nunca baja del umbral.

Los 5 minutos sobre las 11:00 son margen: a las 11:00 clavadas el peor caso daba
exactamente 3.00 h, justo en el borde del guard.

### Lo que no es posible

**Un reporte a las 8:00–9:00 Madrid no puede ser fiable.** A las 8:00 de verano
son las 06:00 UTC, el instante exacto del cierre: cero horas de consolidacion. A
las 9:00 es 1 h post-cierre, fuera de todo lo medido. El guard bloquearia ambas.

Para adelantar la hora hace falta medir primero, con el probe de frescura
(`workflow_dispatch` que solo loguea): dispararlo 1 h y 2 h antes durante ~5 dias
y comparar contra el consolidado. Si el error se mantiene en −0.4 % a −1.0 %,
entonces se baja la hora y `MIN_HOURS_AFTER_CLOSE`. Si se dispara, se queda.

---

## El guard de frescura

`src/report.js` comprueba, **antes de pedir ningun dato**, cuantas horas lleva
cerrado el dia en la timezone de la cuenta. Si no llega a
`MIN_HOURS_AFTER_CLOSE`, avisa a Slack y sale con `process.exit(1)` para que se
vea en rojo en Actions.

```
[Freshness] 2026-07-28 cerro hace 3.12 h en America/Mexico_City (minimo requerido: 3 h)
```

La timezone se lee de la API de Meta en cada ejecucion; `META_ACCOUNT_TIMEZONE`
es solo el fallback si esa llamada falla.

---

## Cron externo (cron-job.org)

Un cronjob por tienda. Lo unico que cambia entre tiendas es la URL y la hora.

- **URL:** `https://api.github.com/repos/diegordzsa/daily-report-glenda/actions/workflows/daily-report.yml/dispatches`
- **Method:** POST
- **Body:** `{"ref":"main"}`
- **Headers:**
  - `Accept: application/vnd.github+json`
  - `Authorization: Bearer <PAT>`
  - `X-GitHub-Api-Version: 2022-11-28`
  - `Content-Type: application/json`
- **Respuesta correcta: 204 No Content.**
  401 = token mal copiado · 403 = falta permiso *Actions: Read and write* ·
  404 = URL con errata
- **Schedule:** modo *Custom*, zona horaria **Europe/Madrid**, `5 11 * * *`.
  Las listas son multiseleccion (`Ctrl`+clic) o se escribe la expresion en
  *Crontab expression*. **MINUTES tiene que quedar con un solo valor**: si queda
  en *every*, dispara 120 veces al dia.
- Activar **aviso por email al fallar**. Sin cron de GitHub no hay red de
  seguridad.

Reutiliza el PAT que ya existe en cron-job.org; tiene acceso a todos los repos.
No crees uno nuevo.

### Organizacion con varias tiendas

Usa **MANAGE FOLDERS** y agrupa todos los reportes. Nombra igual siempre:
`<Tienda> reporte diario`, `<Tienda> probe frescura`.

| Tienda | Repo | TZ cuenta Meta | Cierre UTC | Entrega | Moneda Shopify / Meta |
|---|---|---|---|---|---|
| Zendi | `daily-report-zendi` | America/Mexico_City | 06:00 | 11:00 Madrid | MXN / EUR |
| GLENDA | `daily-report-glenda` | America/Mexico_City | 06:00 | 11:05 Madrid | MXN / EUR |

**Prueba con el probe, no con el reporte.** Ambos usan el mismo token y
cabeceras, pero el probe no escribe en Slack: valida la autenticacion sin mandar
un reporte duplicado.

---

## Probar el Reporte

1. Ve a tu repositorio en GitHub
2. Haz clic en la pestana **Actions**
3. Selecciona el workflow **Daily Report**
4. Haz clic en **Run workflow** > **Run workflow**
5. Espera a que termine y revisa el canal de Slack

Si falla, haz clic en el job para ver los logs y el mensaje de error.

---

## Errores Comunes

| Error | Causa | Solucion |
|---|---|---|
| `Missing required env var: X` | Falta un secreto en GitHub, o falta una de las `*_CURRENCY_ISO` en el bloque `env:` | Agrega el secreto en Settings > Secrets, o la variable en el workflow |
| Slack dice "Reporte Diario NO publicado" y el job sale en rojo | El guard de frescura: el dia no lleva `MIN_HOURS_AFTER_CLOSE` horas cerrado | Correcto, no es un fallo. Revisa que cron-job.org dispare a la hora acordada |
| Slack dice "Problema de moneda" | La moneda que reporta Meta no coincide con `META_CURRENCY_ISO`, o no hubo tipo de cambio | Verifica la moneda de la cuenta; configura `FX_FALLBACK_STORE_PER_REPORT` |
| El cronjob externo devuelve 401/403/404 | Token mal copiado / falta *Actions: Read and write* / URL con errata | Ver la seccion de cron-job.org |
| `Meta API error: 190` | Token de Meta expirado o invalido | Genera un nuevo token (usa System User para que no expire) |
| `Meta API error: 100` | Ad Account ID incorrecto | Verifica el ID en Business Settings > Ad Accounts |
| `Shopify token exchange failed: 401` | Client ID/Secret incorrectos | Verifica las credenciales en el Dev Dashboard de Shopify |
| `Shopify API error: 404` | Dominio de tienda incorrecto | Verifica que el dominio `.myshopify.com` es correcto |
| `Slack webhook error: 403/404` | Webhook URL invalida o desactivada | Crea un nuevo webhook en api.slack.com |
| `Claude diagnosis failed` | API key de Anthropic invalida o sin saldo | Verifica la key en console.anthropic.com |
| `SUBSCRIPTION_TAGS is not valid JSON` | Formato JSON incorrecto | Verifica que el JSON es valido (usa un validador online) |
