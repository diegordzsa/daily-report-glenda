import { fetchShopifyOrders, getYesterday } from './shopify.js';
import { fetchMetaAds, fetchAdAccountTimezone } from './meta.js';
import { hoursSinceDayClose } from './freshness.js';
import { generateDiagnosis } from './claude.js';
import { sendToSlack, formatReport } from './slack.js';
import { fetchRate } from './exchange.js';
import {
  STORE_NAME, META_ACCESS_TOKEN, SHOPIFY_ACCESS_TOKEN,
  SLACK_WEBHOOK_URL, SUBSCRIPTION_TAGS,
  STORE_CURRENCY_ISO, META_CURRENCY_ISO, REPORT_CURRENCY_ISO,
  META_ACCOUNT_TIMEZONE, MIN_HOURS_AFTER_CLOSE,
} from './config.js';

// Meta sigue agregando gasto durante horas despues de que cierra el dia en la
// timezone de la cuenta. Publicar antes de tiempo subestima el spend, lo que
// infla ROAS y MER. Preferimos no publicar a publicar cifras incorrectas.
async function assertMetaDataIsSettled(reportDate, timeZone) {
  const hours = hoursSinceDayClose(reportDate, timeZone);

  console.log(
    `[Freshness] ${reportDate} cerro hace ${hours.toFixed(2)} h en ${timeZone} ` +
    `(minimo requerido: ${MIN_HOURS_AFTER_CLOSE} h)`
  );

  if (hours >= MIN_HOURS_AFTER_CLOSE) return hours;

  const reason = hours < 0
    ? `el dia todavia no termina en ${timeZone} (faltan ${(-hours).toFixed(1)} h)`
    : `solo han pasado ${hours.toFixed(1)} h desde el cierre, el minimo es ${MIN_HOURS_AFTER_CLOSE} h`;

  console.error(`Datos de Meta sin consolidar: ${reason}`);
  await sendToSlack(SLACK_WEBHOOK_URL,
    `:hourglass_flowing_sand: *${STORE_NAME} — Reporte Diario NO publicado*\n${reportDate}\n\n` +
    `Meta aun no consolida el gasto: ${reason}.\n` +
    `No se publica el reporte para no dar cifras incorrectas ` +
    `(un gasto subestimado infla ROAS y MER).`
  );
  process.exit(1);
}

// Aborta antes que publicar cifras sin convertir. Si el gasto de Meta no viene
// en la moneda que creemos, o si no hay tipo de cambio, los numeros del reporte
// serian falsos sin que nada fallara.
async function abortWithCurrencyError(reportDate, detail) {
  console.error(`Moneda inconsistente: ${detail}`);
  await sendToSlack(SLACK_WEBHOOK_URL,
    `:heavy_dollar_sign: *${STORE_NAME} — Reporte Diario NO publicado*\n${reportDate}\n\n` +
    `Problema de moneda: ${detail}.\n` +
    `No se publica el reporte para no dar cifras sin convertir.`
  );
  process.exit(1);
}

async function run() {
  // La timezone de la cuenta gobierna tanto la fecha a reportar como el guard.
  const timeZone = await fetchAdAccountTimezone(META_ACCESS_TOKEN) || META_ACCOUNT_TIMEZONE;
  const yesterday = getYesterday(timeZone);
  const hoursSettled = await assertMetaDataIsSettled(yesterday, timeZone);

  const [metaResult, shopifyResult] = await Promise.allSettled([
    fetchMetaAds(META_ACCESS_TOKEN, yesterday),
    fetchShopifyOrders(SHOPIFY_ACCESS_TOKEN, yesterday),
  ]);

  const metaData = metaResult.status === 'fulfilled' ? metaResult.value : [];
  const shopifyData = shopifyResult.status === 'fulfilled' ? shopifyResult.value : [];

  if (metaResult.status === 'rejected') console.error('[Meta] Failed:', metaResult.reason.message);
  if (shopifyResult.status === 'rejected') console.error('[Shopify] Failed:', shopifyResult.reason.message);

  if (metaResult.status === 'rejected' && shopifyResult.status === 'rejected') {
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *${STORE_NAME} — Reporte Diario FALLIDO*\nNo se pudieron obtener datos.\nMeta: ${metaResult.reason.message}\nShopify: ${shopifyResult.reason.message}`
    );
    process.exit(1);
  }

  console.log(`[Debug] Yesterday: ${yesterday}`);
  console.log(`[Debug] Meta rows: ${metaData.length}, Shopify rows: ${shopifyData.length}`);

  if (metaData.length === 0 && shopifyData.length === 0) {
    console.warn('Both APIs returned 0 rows — sending warning to Slack');
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *${STORE_NAME} — Reporte Diario*\n${yesterday}\n\nNo se obtuvieron datos de Meta ni de Shopify. Verifica que los tokens de acceso siguen activos.`
    );
    process.exit(1);
  }

  // La moneda de la cuenta viene en la respuesta de insights: comprobamos lo que
  // Meta dice, no lo que asumimos. El gasto se usa tal cual, asi que si la cuenta
  // dejara de facturar en REPORT_CURRENCY_ISO todo el ROAS quedaria mal.
  const reportedCurrency = metaData.find(r => r.account_currency)?.account_currency;
  if (reportedCurrency && reportedCurrency !== META_CURRENCY_ISO) {
    await abortWithCurrencyError(yesterday,
      `Meta reporta el gasto en ${reportedCurrency} pero META_CURRENCY_ISO dice ${META_CURRENCY_ISO}`);
  }
  if (META_CURRENCY_ISO !== REPORT_CURRENCY_ISO) {
    await abortWithCurrencyError(yesterday,
      `el gasto de Meta esta en ${META_CURRENCY_ISO} y el reporte en ${REPORT_CURRENCY_ISO}, ` +
      `pero el gasto se usa sin convertir`);
  }

  const metrics = calculateMetrics(metaData, shopifyData);

  // Shopify factura en STORE_CURRENCY_ISO; el reporte se lee en REPORT_CURRENCY_ISO.
  if (STORE_CURRENCY_ISO !== REPORT_CURRENCY_ISO) {
    const rate = await fetchRate(STORE_CURRENCY_ISO, REPORT_CURRENCY_ISO, true);
    if (!(rate > 0)) {
      await abortWithCurrencyError(yesterday,
        `no se pudo obtener el tipo de cambio ${STORE_CURRENCY_ISO} -> ${REPORT_CURRENCY_ISO} ` +
        `y no hay FX_FALLBACK_STORE_PER_REPORT configurado`);
    }
    metrics.shopifyRevenue *= rate;
    metrics.shopifyAOV *= rate;
  }

  // Parentesis informativo en USD. Si falla, se omite: no altera ninguna cifra.
  if (REPORT_CURRENCY_ISO !== 'USD') {
    const usdRate = await fetchRate(REPORT_CURRENCY_ISO, 'USD');
    if (usdRate > 0) metrics.adSpendUSD = metrics.adSpend * usdRate;
  }

  metrics.merROAS = metrics.adSpend > 0 ? metrics.shopifyRevenue / metrics.adSpend : 0;

  const subDebug = metrics.subscriptionCounts.map(s => `${s.label}: ${s.count}`).join(', ');
  console.log(`[Debug] Orders: ${metrics.shopifyOrders}, Net Sales (${REPORT_CURRENCY_ISO}): ${metrics.shopifyRevenue.toFixed(2)}, MER-ROAS: ${metrics.merROAS.toFixed(2)}x${subDebug ? `, ${subDebug}` : ''}`);

  let diagnosis;
  try {
    diagnosis = await generateDiagnosis(metrics);
  } catch (err) {
    console.error('Claude diagnosis failed:', err.message, err.status ?? '', err.error ?? '');
    diagnosis = 'Diagnostico no disponible — error al generar analisis.';
  }

  const reportText = formatReport({
    date: yesterday,
    metrics,
    diagnosis,
    hoursSettled,
  });

  try {
    await sendToSlack(SLACK_WEBHOOK_URL, reportText);
    console.log('Report sent to Slack successfully.');
  } catch (err) {
    console.error('Failed to send to Slack:', err.message);
    process.exit(1);
  }
}

function sum(rows, field) {
  return rows.reduce((acc, row) => acc + (Number(row[field]) || 0), 0);
}

function hasTag(row, tag) {
  const tags = row.order_tags || '';
  return tags.includes(tag);
}

function calculateMetrics(metaRows, shopifyRows) {
  const adSpend = sum(metaRows, 'spend');
  const impressions = sum(metaRows, 'impressions');
  const clicks = sum(metaRows, 'clicks');
  const linkClicks = sum(metaRows, 'actions_link_click');
  const addToCarts = sum(metaRows, 'actions_offsite_conversion_fb_pixel_add_to_cart');
  const checkoutsInitiated = sum(metaRows, 'actions_offsite_conversion_fb_pixel_initiate_checkout');
  const metaOrders = sum(metaRows, 'actions_offsite_conversion_fb_pixel_purchase');
  const metaAttributedRevenue = sum(metaRows, 'action_values_offsite_conversion_fb_pixel_purchase');

  const metaROAS = adSpend > 0 ? metaAttributedRevenue / adSpend : 0;
  const cpo = metaOrders > 0 ? adSpend / metaOrders : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const addToCartRate = linkClicks > 0 ? (addToCarts / linkClicks) * 100 : 0;
  const checkoutRate = addToCarts > 0 ? (checkoutsInitiated / addToCarts) * 100 : 0;
  const purchaseRate = checkoutsInitiated > 0 ? (metaOrders / checkoutsInitiated) * 100 : 0;

  const shopifyRevenue = sum(shopifyRows, 'order_net_sales');
  const shopifyOrders = sum(shopifyRows, 'order_count');
  const shopifyAOV = shopifyOrders > 0 ? shopifyRevenue / shopifyOrders : 0;

  const orderRows = shopifyRows.filter(r => Number(r.order_count) > 0);
  const subscriptionCounts = SUBSCRIPTION_TAGS.map(({ tag, label }) => ({
    label,
    count: orderRows.filter(r => hasTag(r, tag)).length,
  }));

  return {
    adSpend, impressions, clicks, linkClicks, addToCarts,
    checkoutsInitiated, metaOrders, metaAttributedRevenue,
    metaROAS, cpo, ctr, addToCartRate, checkoutRate, purchaseRate,
    shopifyRevenue, shopifyOrders, shopifyAOV,
    subscriptionCounts,
  };
}

run();
