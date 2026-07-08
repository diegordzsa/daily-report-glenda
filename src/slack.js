import { STORE_NAME, STORE_CURRENCY, STORE_LOCALE, REPORT_TIME_LABEL, SUBSCRIPTION_TAGS, META_CURRENCY, META_TO_STORE_RATE_FALLBACK } from './config.js';

let cachedRate = null;

async function fetchExchangeRate() {
  if (META_CURRENCY === STORE_CURRENCY) return 0;
  try {
    const from = META_CURRENCY === '€' ? 'EUR' : META_CURRENCY === '$' ? 'USD' : null;
    const to = STORE_CURRENCY === '$' ? 'MXN' : STORE_CURRENCY === '€' ? 'EUR' : null;
    if (!from || !to || from === to) return META_TO_STORE_RATE_FALLBACK;
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`);
    if (!res.ok) return META_TO_STORE_RATE_FALLBACK;
    const data = await res.json();
    const rate = data.rates?.[to];
    console.log(`[FX] Live rate: 1 ${from} = ${rate} ${to}`);
    return rate || META_TO_STORE_RATE_FALLBACK;
  } catch {
    console.warn('[FX] Failed to fetch live rate, using fallback');
    return META_TO_STORE_RATE_FALLBACK;
  }
}

export async function sendToSlack(webhookUrl, reportText) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: reportText },
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Slack webhook error: ${res.status} ${res.statusText}`);
  }
}

function buildSubscriptionLine(metrics) {
  if (SUBSCRIPTION_TAGS.length === 0 || !metrics.subscriptionCounts) return null;
  const parts = metrics.subscriptionCounts.map(s => `${s.label}: ${s.count}`);
  return `  ${parts.join(' | ')}`;
}

export async function formatReport({ date, metrics, diagnosis }) {
  cachedRate = await fetchExchangeRate();
  const d = new Date(date);
  const dateStr = d.toLocaleDateString(STORE_LOCALE, {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  const subscriptionLine = buildSubscriptionLine(metrics);

  const lines = [
    `:bar_chart: *${STORE_NAME} — Reporte Diario*`,
    dateStr,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `:moneybag: *REVENUE*`,
    `  Net Sales (Shopify): ${STORE_CURRENCY}${fmt(metrics.shopifyRevenue)}`,
    `  Ordenes: ${metrics.shopifyOrders} | AOV: ${STORE_CURRENCY}${fmt(metrics.shopifyAOV)}`,
  ];

  if (subscriptionLine) {
    lines.push(subscriptionLine);
  }

  lines.push(
    ``,
    `:loudspeaker: *PAID ADS (Meta)*`,
    `  Gasto: ${META_CURRENCY}${fmt(metrics.adSpend)}${conv(metrics.adSpend)}`,
    `  ROAS: ${metrics.metaROAS.toFixed(2)}x | CPO: ${META_CURRENCY}${fmt(metrics.cpo)}${conv(metrics.cpo)}`,
    `  Revenue atribuido: ${META_CURRENCY}${fmt(metrics.metaAttributedRevenue)}${conv(metrics.metaAttributedRevenue)}`,
    ``,
    `:mag: *FUNNEL*`,
    `  Impresiones: ${fmtInt(metrics.impressions)}`,
    `  Link Clicks: ${fmtInt(metrics.linkClicks)} (CTR: ${metrics.ctr.toFixed(1)}%)`,
    `  Add to Cart: ${metrics.addToCarts} (${metrics.addToCartRate.toFixed(1)}%)`,
    `  Checkout: ${metrics.checkoutsInitiated} (${metrics.checkoutRate.toFixed(1)}%)`,
    `  Compras: ${metrics.metaOrders} (${metrics.purchaseRate.toFixed(1)}%)`,
    ``,
    `:robot_face: *DIAGNOSTICO (Claude)*`,
    ...diagnosis.split('\n').map(line => `  ${line}`),
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `_Generado automaticamente a las ${REPORT_TIME_LABEL}_`,
  );

  return lines.join('\n');
}

function fmt(n) {
  return n.toLocaleString(STORE_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n) {
  return n.toLocaleString(STORE_LOCALE);
}

function conv(n) {
  if (!cachedRate || META_CURRENCY === STORE_CURRENCY) return '';
  return ` (${STORE_CURRENCY}${fmt(n * cachedRate)})`;
}
