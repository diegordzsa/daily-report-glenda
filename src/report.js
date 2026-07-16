import { fetchShopifyOrders, getYesterday } from './shopify.js';
import { fetchMetaAds } from './meta.js';
import { generateDiagnosis } from './claude.js';
import { sendToSlack, formatReport } from './slack.js';
import { fetchRate, resolveISO } from './exchange.js';
import {
  STORE_NAME, META_ACCESS_TOKEN, SHOPIFY_ACCESS_TOKEN,
  SLACK_WEBHOOK_URL, SUBSCRIPTION_TAGS, STORE_CURRENCY, REPORT_CURRENCY,
} from './config.js';

async function run() {
  const [metaResult, shopifyResult] = await Promise.allSettled([
    fetchMetaAds(META_ACCESS_TOKEN),
    fetchShopifyOrders(SHOPIFY_ACCESS_TOKEN),
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

  const yesterday = getYesterday();

  console.log(`[Debug] Yesterday: ${yesterday}`);
  console.log(`[Debug] Meta rows: ${metaData.length}, Shopify rows: ${shopifyData.length}`);

  if (metaData.length === 0 && shopifyData.length === 0) {
    console.warn('Both APIs returned 0 rows — sending warning to Slack');
    await sendToSlack(SLACK_WEBHOOK_URL,
      `:warning: *${STORE_NAME} — Reporte Diario*\n${yesterday}\n\nNo se obtuvieron datos de Meta ni de Shopify. Verifica que los tokens de acceso siguen activos.`
    );
    process.exit(1);
  }

  const metrics = calculateMetrics(metaData, shopifyData);

  if (STORE_CURRENCY !== REPORT_CURRENCY) {
    const fromISO = resolveISO(STORE_CURRENCY);
    const toISO = resolveISO(REPORT_CURRENCY);
    if (fromISO && toISO) {
      const rate = await fetchRate(fromISO, toISO);
      if (rate > 0) {
        metrics.shopifyRevenue *= rate;
        metrics.shopifyAOV *= rate;
      }
    }
  }

  metrics.merROAS = metrics.adSpend > 0 ? metrics.shopifyRevenue / metrics.adSpend : 0;

  const subDebug = metrics.subscriptionCounts.map(s => `${s.label}: ${s.count}`).join(', ');
  console.log(`[Debug] Orders: ${metrics.shopifyOrders}, Net Sales (EUR): ${metrics.shopifyRevenue.toFixed(2)}, MER-ROAS: ${metrics.merROAS.toFixed(2)}x${subDebug ? `, ${subDebug}` : ''}`);

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
