function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function optional(name, defaultValue = '') {
  return process.env[name] || defaultValue;
}

function optionalNumber(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`${name} no es un numero valido ("${raw}") — usando ${defaultValue}`);
    return defaultValue;
  }
  return n;
}

function parseSubscriptionTags(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(t => t.tag && t.label);
  } catch {
    console.error('SUBSCRIPTION_TAGS is not valid JSON — ignoring');
    return [];
  }
}

export const STORE_NAME = required('STORE_NAME');
export const META_ACCESS_TOKEN = required('META_ACCESS_TOKEN');
export const META_AD_ACCOUNT_ID = required('META_AD_ACCOUNT_ID');
export const SHOPIFY_STORE_DOMAIN = required('SHOPIFY_STORE_DOMAIN');
export const SHOPIFY_ACCESS_TOKEN = required('SHOPIFY_ACCESS_TOKEN');
export const ANTHROPIC_API_KEY = required('ANTHROPIC_API_KEY');
export const SLACK_WEBHOOK_URL = required('SLACK_WEBHOOK_URL');

export const STORE_LOCALE = optional('STORE_LOCALE', 'es-ES');
export const STORE_INDUSTRY = optional('STORE_INDUSTRY');
export const ROAS_BENCHMARK = optional('ROAS_BENCHMARK');
export const META_API_VERSION = optional('META_API_VERSION', 'v21.0');
export const SHOPIFY_API_VERSION = optional('SHOPIFY_API_VERSION', '2024-10');
export const CLAUDE_MODEL = optional('CLAUDE_MODEL', 'claude-sonnet-4-6');
export const SUBSCRIPTION_TAGS = parseSubscriptionTags(optional('SUBSCRIPTION_TAGS'));

// --- Frescura de los datos de Meta -------------------------------------------
// El dia cierra a medianoche en la timezone de la CUENTA PUBLICITARIA, no en la
// del lector ni en UTC. En cada ejecucion se lee timezone_name de la API; esto
// es solo el fallback si la llamada falla. Medido para act_ de GLENDA el
// 2026-07-29: "America/Mexico_City", timezone_offset_hours_utc = -6, sin DST.
export const META_ACCOUNT_TIMEZONE = optional('META_ACCOUNT_TIMEZONE', 'America/Mexico_City');

// Horas minimas desde el cierre del dia antes de publicar. Por debajo de esto
// el reporte NO sale. Medido sobre 7 ejecuciones (22-28 jul 2026): entre 2.92 h
// y 4.54 h post-cierre el gasto reportado quedo -0.41 % a -0.98 % por debajo
// del consolidado, siempre por debajo y sin tendencia. Por debajo de 2.9 h no
// hay medicion: no bajar este numero sin datos del probe de frescura.
export const MIN_HOURS_AFTER_CLOSE = optionalNumber('MIN_HOURS_AFTER_CLOSE', 3);

// --- Moneda -------------------------------------------------------------------
// Los simbolos son SOLO para mostrar. Las conversiones usan los codigos ISO, que
// deben declararse explicitamente: derivar el ISO de un simbolo es ambiguo ("$"
// puede ser MXN o USD) y una conversion mal resuelta produce cifras falsas sin
// que nada falle. Medido el 2026-07-29: Shopify GLENDA factura en MXN,
// la cuenta Meta "SKIN+ MX" gasta en EUR.
// El simbolo se deriva del ISO en vez de configurarse aparte: dos variables
// independientes se contradicen tarde o temprano y el reporte acaba mostrando
// "€" sobre cifras en MXN. REPORT_CURRENCY solo existe como override manual.
function symbolFor(iso, locale) {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: iso })
      .formatToParts(0);
    return parts.find(p => p.type === 'currency')?.value || iso;
  } catch {
    return iso;
  }
}

export const STORE_CURRENCY_ISO = required('STORE_CURRENCY_ISO');
export const META_CURRENCY_ISO = required('META_CURRENCY_ISO');
export const REPORT_CURRENCY_ISO = required('REPORT_CURRENCY_ISO');
export const REPORT_CURRENCY = optional('REPORT_CURRENCY', symbolFor(REPORT_CURRENCY_ISO, STORE_LOCALE));

// Tipo de cambio de emergencia: unidades de STORE_CURRENCY_ISO por 1
// REPORT_CURRENCY_ISO (p.ej. MXN por EUR). Solo se usa si la API de FX falla.
export const FX_FALLBACK_STORE_PER_REPORT = optionalNumber('FX_FALLBACK_STORE_PER_REPORT', 0);

// Hora real de envio, la que configura el cron externo. Debe coincidir con
// cron-job.org: si mienten entre si, el pie del reporte engana al lector.
export const REPORT_TIME_LABEL = optional('REPORT_TIME_LABEL', '11:05 (Europe/Madrid)');
