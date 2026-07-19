import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;
const MAX_MEMORY_BUCKETS = 10_000;
const buckets = new Map<string, { count: number; resetAt: number }>();
let pool: pg.Pool | undefined;
let supabase: SupabaseClient | undefined;

export class RequestGuardError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 413 | 429) {
    super(message);
  }
}

export function assertRequestSize(request: Request, maxBytes: number) {
  const raw = request.headers.get("content-length");
  if (!raw) return;
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length < 0) throw new RequestGuardError("Invalid request size.", 400);
  if (length > maxBytes) throw new RequestGuardError("This upload is too large.", 413);
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    if (process.env.NODE_ENV === "production") throw new RequestGuardError("Invalid request origin.", 403);
    return;
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  if (!host) throw new RequestGuardError("Invalid request.", 403);

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "http" ? "http" : "https";
  const expected = `${protocol}://${host}`;
  const localHttp = process.env.NODE_ENV !== "production" ? `http://${host}` : "";
  if (origin !== expected && origin !== localHttp) throw new RequestGuardError("Invalid request origin.", 403);
}

export async function assertRateLimit(request: Request, namespace = "default") {
  const key = rateLimitKey(request, namespace);
  const persistent = await consumePersistentLimit(key).catch((error) => {
    console.error("Persistent rate limit unavailable; using process fallback", error);
    return undefined;
  });
  if (persistent === false) throw new RequestGuardError("Too many attempts. Please wait a minute and try again.", 429);
  if (persistent === true) return;

  consumeMemoryLimit(key);
}

function rateLimitKey(request: Request, namespace: string) {
  const ip =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local";
  const userAgent = request.headers.get("user-agent") || "unknown";
  const salt = process.env.RATE_LIMIT_SALT || "bluefun-rate-limit";
  return createHash("sha256").update(`${salt}:${namespace}:${ip}:${userAgent}`).digest("hex");
}

async function consumePersistentLimit(key: string): Promise<boolean | undefined> {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabase ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });
    const { data, error } = await supabase.rpc("consume_api_rate_limit", {
      p_key: key,
      p_limit: MAX_REQUESTS,
      p_window_seconds: Math.floor(WINDOW_MS / 1000)
    });
    if (error) throw error;
    return Boolean(data);
  }

  if (!process.env.DATABASE_URL) return undefined;
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const result = await pool.query<{ allowed: boolean }>(
    "select consume_api_rate_limit($1, $2, $3) as allowed",
    [key, MAX_REQUESTS, Math.floor(WINDOW_MS / 1000)]
  );
  return Boolean(result.rows[0]?.allowed);
}

function consumeMemoryLimit(key: string) {
  const now = Date.now();
  if (buckets.size >= MAX_MEMORY_BUCKETS) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
    if (buckets.size >= MAX_MEMORY_BUCKETS) buckets.clear();
  }

  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > MAX_REQUESTS) throw new RequestGuardError("Too many attempts. Please wait a minute and try again.", 429);
}
