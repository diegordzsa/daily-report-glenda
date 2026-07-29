import { SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION } from './config.js';
import { yesterdayInZone } from './freshness.js';

// `timeZone` es la de la cuenta de Meta (que aqui coincide con la de la tienda,
// medido: ambas America/Mexico_City). Calcularla en UTC hacia que una ejecucion
// a las 03:00 UTC pidiera un dia que en la tienda aun no habia empezado.
export function getYesterday(timeZone) {
  if (process.env.REPORT_DATE) return process.env.REPORT_DATE;
  return yesterdayInZone(timeZone);
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export async function fetchShopifyOrders(accessToken, reportDate) {
  const yesterday = reportDate;

  // Ventana holgada a proposito. Shopify interpreta una fecha sin offset en la
  // hora de la tienda, y `created_at` vuelve con el offset local; el filtro real
  // es el prefijo de abajo, que ya trabaja en hora de tienda. El margen de un
  // dia por lado evita depender de como resuelva Shopify los limites.
  const params = new URLSearchParams({
    status: 'any',
    created_at_min: `${shiftDate(yesterday, -1)}T00:00:00`,
    created_at_max: `${shiftDate(yesterday, 2)}T00:00:00`,
    limit: '250',
    fields: 'id,created_at,subtotal_price,total_discounts,tags,line_items',
  });

  const allOrders = [];
  let url = `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/orders.json?${params}`;

  while (url) {
    console.log(`[Shopify] Fetching orders...`);
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Shopify API error: ${res.status} ${res.statusText} — ${body.substring(0, 200)}`);
    }

    const json = await res.json();
    allOrders.push(...(json.orders || []));

    const link = res.headers.get('link');
    const next = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  console.log(`[Shopify] Got ${allOrders.length} total orders`);

  const yesterdayOrders = allOrders.filter(o => o.created_at?.slice(0, 10) === yesterday);
  console.log(`[Shopify] ${yesterdayOrders.length} orders for ${yesterday}`);

  return yesterdayOrders.map(order => ({
    date: yesterday,
    order_count: 1,
    order_net_sales: parseFloat(order.subtotal_price) || 0,
    order_tags: order.tags || '',
  }));
}
