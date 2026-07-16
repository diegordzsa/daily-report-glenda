import { META_TO_STORE_RATE_FALLBACK } from './config.js';

const SYMBOL_TO_ISO = { '€': 'EUR', '£': 'GBP', '$': 'MXN' };
const rateCache = new Map();

export function resolveISO(symbol) {
  return SYMBOL_TO_ISO[symbol] || null;
}

export async function fetchRate(fromISO, toISO) {
  if (fromISO === toISO) return 1;

  const key = `${fromISO}/${toISO}`;
  if (rateCache.has(key)) return rateCache.get(key);

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${fromISO}&to=${toISO}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate = data.rates?.[toISO];
    if (!rate) throw new Error(`No rate for ${toISO}`);
    console.log(`[FX] Live rate: 1 ${fromISO} = ${rate} ${toISO}`);
    rateCache.set(key, rate);
    return rate;
  } catch (err) {
    console.warn(`[FX] Failed to fetch ${key}: ${err.message}, using fallback`);
    const fallback = META_TO_STORE_RATE_FALLBACK;
    if (fallback > 0) {
      const inverted = 1 / fallback;
      console.log(`[FX] Fallback rate: 1 ${fromISO} ≈ ${inverted.toFixed(6)} ${toISO}`);
      return inverted;
    }
    return 0;
  }
}
