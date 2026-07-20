type CachedResponse = {
  body: string;
  status: number;
  headers: [string, string][];
};

type CacheEntry = {
  expiresAt: number;
  promise: Promise<CachedResponse>;
};

const MAX_ENTRIES = 250;
const responseCache = new Map<string, CacheEntry>();

export async function cachedResponse(key: string, ttlMs: number, loader: () => Promise<Response>) {
  const now = Date.now();
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > now) return materialize(await cached.promise);
  if (cached) responseCache.delete(key);

  prune(now);
  const promise = loader().then(async (response) => ({
    body: await response.text(),
    status: response.status,
    headers: Array.from(response.headers.entries())
  }));
  responseCache.set(key, { expiresAt: now + ttlMs, promise });

  try {
    return materialize(await promise);
  } catch (error) {
    responseCache.delete(key);
    throw error;
  }
}

function materialize(cached: CachedResponse) {
  return new Response(cached.body, { status: cached.status, headers: cached.headers });
}

function prune(now: number) {
  for (const [key, value] of responseCache) {
    if (value.expiresAt <= now) responseCache.delete(key);
  }
  while (responseCache.size >= MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (!oldest) break;
    responseCache.delete(oldest);
  }
}
