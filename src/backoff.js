/** Retry a fetch on HTTP 429 with exponential backoff. */

export function waitMs(ms, sleep = defaultSleep) {
  return sleep(ms);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithBackoff(fetchImpl, url, init, { retries = 3, baseMs = 300, sleep = defaultSleep } = {}) {
  const run = fetchImpl || fetch;
  let res;
  for (let i = 0; i <= retries; i++) {
    res = await run(url, init);
    if (!res || res.status !== 429 || i === retries) return res;
    await sleep(baseMs * 2 ** i);
  }
  return res;
}
