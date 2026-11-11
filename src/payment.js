/**
 * Status-check entry point used by the UI.
 * Browser lookups go through the Worker proxy when configured; otherwise we
 * do not call public Koios (CORS would hide the body) and return the
 * Cardanoscan fallback instead.
 */
import { lookupPayment as lookupPaymentKoios } from './koios.js';
import { lookupPaymentBlockfrost } from './blockfrost.js';
import { resolveCheckerConfig, checkerFailure } from './checker.js';

export async function checkPaymentStatus(request, options = {}) {
  const config = resolveCheckerConfig(options.config, request && request.network);
  const allowDirect = options.allowDirect === true || config.mode === 'proxy';
  if (!allowDirect) {
    return checkerFailure(
      request,
      new Error('Public Koios cannot be read from a browser because actual responses omit CORS headers. Deploy /worker and set proxyBase.')
    );
  }
  try {
    if (config.provider === 'blockfrost') {
      return await lookupPaymentBlockfrost(request, {
        baseUrl: config.baseUrl,
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        projectId: config.projectId,
      });
    }
    return await lookupPaymentKoios(request, {
      baseUrl: config.baseUrl,
      fetchImpl: options.fetchImpl,
      sleep: options.sleep,
    });
  } catch (error) {
    return checkerFailure(request, error);
  }
}
