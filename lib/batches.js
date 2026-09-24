/**
 * Sending a long list to the server a batch at a time.
 *
 * The bulk product route accepts up to 500 ids per call, so picking a thousand
 * products and pressing Archive failed outright instead of doing the work. Splitting
 * the list here also keeps each request small enough to finish inside a request
 * timeout, and lets the page show progress while it works.
 */

export const DEFAULT_BATCH_SIZE = 200;

export function chunkList(items = [], size = DEFAULT_BATCH_SIZE) {
  const step = Number(size) > 0 ? Math.floor(size) : DEFAULT_BATCH_SIZE;
  const list = Array.isArray(items) ? items : [];
  const chunks = [];
  for (let i = 0; i < list.length; i += step) chunks.push(list.slice(i, i + step));
  return chunks;
}

/**
 * Run `worker` over the list in batches, one after another.
 *
 * A batch that fails does not stop the rest: the work already done stands, and what
 * failed is reported, rather than leaving the caller unsure what went through.
 *
 * @param {Array} items
 * @param {(batch: Array, index: number) => Promise<any>} worker
 * @param {{ size?: number, onProgress?: (state) => void }} [options]
 * @returns {Promise<{ total, succeeded, failed, batches, errors: string[], results: any[] }>}
 */
export async function runInBatches(items, worker, { size = DEFAULT_BATCH_SIZE, onProgress } = {}) {
  const chunks = chunkList(items, size);
  const results = [];
  const errors = [];
  let succeeded = 0;
  let failed = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    const batch = chunks[index];
    onProgress?.({ done: succeeded + failed, total: items.length, batch: index + 1, batches: chunks.length });
    try {
      results.push(await worker(batch, index));
      succeeded += batch.length;
    } catch (error) {
      failed += batch.length;
      errors.push(error?.response?.data?.error || error?.message || "Request failed");
    }
  }

  onProgress?.({ done: succeeded + failed, total: items.length, batch: chunks.length, batches: chunks.length });

  return { total: items.length, succeeded, failed, batches: chunks.length, errors: [...new Set(errors)], results };
}
