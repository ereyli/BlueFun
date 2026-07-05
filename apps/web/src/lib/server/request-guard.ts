const WINDOW_MS = 60_000;
const MAX_REQUESTS = 18;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;

  const host = request.headers.get("host");
  if (!host) throw new Error("Invalid request.");

  const expectedHttp = `http://${host}`;
  const expectedHttps = `https://${host}`;
  if (origin !== expectedHttp && origin !== expectedHttps) {
    throw new Error("Invalid request origin.");
  }
}

export function assertRateLimit(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  const now = Date.now();
  const current = buckets.get(ip);

  if (!current || current.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }

  current.count += 1;
  if (current.count > MAX_REQUESTS) {
    throw new Error("Too many upload attempts. Please wait a minute and try again.");
  }
}
