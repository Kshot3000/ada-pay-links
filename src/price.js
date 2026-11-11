/**
 * Approximate ADA/USD rate from a free public API. No API key.
 * Always label the result as approximate — it is not a quote or lock-in price.
 */

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Price HTTP ' + res.status);
  return res.json();
}

export async function fetchAdaUsdRate() {
  try {
    const data = await getJson('https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd');
    const rate = Number(data && data.cardano && data.cardano.usd);
    if (!(rate > 0) || !Number.isFinite(rate)) throw new Error('bad coingecko rate');
    return { rate, source: 'CoinGecko', quotedAt: new Date().toISOString() };
  } catch {
    const data = await getJson('https://api.coinbase.com/v2/prices/ADA-USD/spot');
    const rate = Number(data && data.data && data.data.amount);
    if (!(rate > 0) || !Number.isFinite(rate)) throw new Error('Price unavailable from CoinGecko and Coinbase');
    return { rate, source: 'Coinbase', quotedAt: new Date().toISOString() };
  }
}
