import { META_AD_ACCOUNT_ID, META_API_VERSION } from './config.js';

const ACTION_MAP = {
  'link_click': 'actions_link_click',
  'offsite_conversion.fb_pixel_add_to_cart': 'actions_offsite_conversion_fb_pixel_add_to_cart',
  'offsite_conversion.fb_pixel_initiate_checkout': 'actions_offsite_conversion_fb_pixel_initiate_checkout',
  'offsite_conversion.fb_pixel_purchase': 'actions_offsite_conversion_fb_pixel_purchase',
};

const ACTION_VALUE_MAP = {
  'offsite_conversion.fb_pixel_purchase': 'action_values_offsite_conversion_fb_pixel_purchase',
};

function extractActions(actionsArray, map) {
  const result = {};
  for (const key of Object.values(map)) {
    result[key] = 0;
  }
  if (!Array.isArray(actionsArray)) return result;

  for (const entry of actionsArray) {
    const mapped = map[entry.action_type];
    if (mapped) {
      result[mapped] = parseFloat(entry.value) || 0;
    }
  }
  return result;
}

// La timezone de la cuenta define cuando cierra el dia para Meta, y por tanto la
// hora mas temprana a la que puede existir un reporte fiable. Se lee en cada
// ejecucion en vez de confiar en una constante: si alguien la cambia en el
// Business Manager, el guard de frescura debe enterarse solo.
export async function fetchAdAccountTimezone(accessToken) {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'timezone_name',
  });
  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${META_AD_ACCOUNT_ID}?${params}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[Meta] No se pudo leer la timezone de la cuenta: ${res.status}`);
      return null;
    }
    const json = await res.json();
    return json.timezone_name || null;
  } catch (err) {
    console.warn(`[Meta] No se pudo leer la timezone de la cuenta: ${err.message}`);
    return null;
  }
}

export async function fetchMetaAds(accessToken, reportDate) {
  const fields = 'spend,impressions,clicks,actions,action_values,cpc,cpm,ctr,frequency,account_currency';
  const params = new URLSearchParams({
    access_token: accessToken,
    time_range: JSON.stringify({ since: reportDate, until: reportDate }),
    level: 'account',
    fields,
  });

  const url = `https://graph.facebook.com/${META_API_VERSION}/act_${META_AD_ACCOUNT_ID}/insights?${params}`;

  console.log(`[Meta] Fetching ad insights...`);
  const res = await fetch(url);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Meta API error: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
  }

  const json = await res.json();

  if (json.error) {
    throw new Error(`Meta API error: ${json.error.message}`);
  }

  const data = json.data || [];
  console.log(`[Meta] Got ${data.length} rows`);
  if (data.length > 0) {
    console.log(`[Meta] Account-level spend for ${reportDate}: ${data[0].spend}`);
  }

  if (data.length === 0) return [];

  return data.map(row => ({
    date: row.date_start,
    account_currency: row.account_currency || '',
    spend: parseFloat(row.spend) || 0,
    impressions: parseInt(row.impressions) || 0,
    clicks: parseInt(row.clicks) || 0,
    cpc: parseFloat(row.cpc) || 0,
    cpm: parseFloat(row.cpm) || 0,
    ctr: parseFloat(row.ctr) || 0,
    frequency: parseFloat(row.frequency) || 0,
    ...extractActions(row.actions, ACTION_MAP),
    ...extractActions(row.action_values, ACTION_VALUE_MAP),
  }));
}
