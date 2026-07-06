const STORAGE_KEY = "offline_pos_transaction_queue_v1";

function getStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function readQueue() {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

function generateExternalId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `offline-${crypto.randomUUID()}`;
  }
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function queuePosTransaction(payload) {
  const queue = readQueue();
  const externalId = payload?.externalId || generateExternalId();
  const createdAt = payload?.createdAt || new Date().toISOString();

  queue.push({
    id: externalId,
    createdAt,
    payload: {
      ...payload,
      externalId,
      dedupeKey: payload?.dedupeKey || externalId,
      createdAt,
    },
    attempts: 0,
    queuedAt: new Date().toISOString(),
  });

  writeQueue(queue);

  return {
    queued: true,
    externalId,
    queueLength: queue.length,
  };
}

export async function flushQueuedPosTransactions(fetchImpl = fetch) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { flushed: 0, remaining: readQueue().length };
  }

  const queue = readQueue();
  if (!queue.length) return { flushed: 0, remaining: 0 };

  const remaining = [];
  let flushed = 0;

  for (const entry of queue) {
    try {
      const response = await fetchImpl("/api/transactions/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(entry.payload),
      });

      if (!response.ok) {
        remaining.push({ ...entry, attempts: (entry.attempts || 0) + 1 });
        continue;
      }

      flushed += 1;
    } catch {
      remaining.push({ ...entry, attempts: (entry.attempts || 0) + 1 });
    }
  }

  writeQueue(remaining);
  return { flushed, remaining: remaining.length };
}

export function setupOfflinePosQueueSync(fetchImpl = fetch) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onOnline = () => {
    flushQueuedPosTransactions(fetchImpl).catch(() => {});
  };

  window.addEventListener("online", onOnline);
  onOnline();

  return () => {
    window.removeEventListener("online", onOnline);
  };
}
