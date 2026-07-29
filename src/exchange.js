import { FX_FALLBACK_STORE_PER_REPORT } from './config.js';

const rateCache = new Map();

// Devuelve cuantas unidades de `toISO` vale 1 `fromISO`, o `null` si no se pudo
// obtener. NUNCA devuelve 0 ni 1 "por si acaso": un tipo de cambio inventado
// convierte MXN en EUR sin convertir nada y multiplica el MER-ROAS por ~20 sin
// que nada falle. Quien llama decide, y la decision correcta es no publicar.
// `allowFallback` solo debe activarse para la direccion store -> report, que es
// la que describe FX_FALLBACK_STORE_PER_REPORT. Aplicarlo a otro par (p.ej. el
// EUR->USD del parentesis) daria un numero sin relacion con la realidad.
export async function fetchRate(fromISO, toISO, allowFallback = false) {
  if (fromISO === toISO) return 1;

  const key = `${fromISO}/${toISO}`;
  if (rateCache.has(key)) return rateCache.get(key);

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${fromISO}&to=${toISO}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rate = data.rates?.[toISO];
    if (!rate) throw new Error(`sin cotizacion para ${toISO}`);
    console.log(`[FX] Tipo de cambio en vivo: 1 ${fromISO} = ${rate} ${toISO}`);
    rateCache.set(key, rate);
    return rate;
  } catch (err) {
    console.warn(`[FX] Fallo al obtener ${key}: ${err.message}`);
    const fallback = allowFallback ? FX_FALLBACK_STORE_PER_REPORT : 0;
    if (fallback > 0) {
      const inverted = 1 / fallback;
      console.log(`[FX] Usando fallback: 1 ${fromISO} ~ ${inverted.toFixed(6)} ${toISO}`);
      return inverted;
    }
    console.error(`[FX] Sin fallback configurado (FX_FALLBACK_STORE_PER_REPORT)`);
    return null;
  }
}
