import { performance } from "node:perf_hooks";

const baseUrl = (process.env.LOAD_TEST_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const path = process.env.LOAD_TEST_PATH || "/";
const stages = (process.env.LOAD_TEST_STAGES || "10,25,50")
  .split(",")
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
const stageSeconds = Math.max(5, Number(process.env.LOAD_TEST_STAGE_SECONDS || 15));
const requestTimeoutMs = Math.max(1_000, Number(process.env.LOAD_TEST_TIMEOUT_MS || 12_000));
const maxErrorRate = Math.min(1, Math.max(0, Number(process.env.LOAD_TEST_MAX_ERROR_RATE || 0.25)));

if (!stages.length) throw new Error("LOAD_TEST_STAGES must contain at least one positive integer");

console.log(JSON.stringify({ baseUrl, path, stages, stageSeconds, requestTimeoutMs, maxErrorRate }));

let stoppedEarly = false;
for (const concurrency of stages) {
  const result = await runStage(concurrency);
  console.log(JSON.stringify(result));
  if (result.requests >= 20 && result.errorRate > maxErrorRate) {
    console.error(`Stopping: error rate ${(result.errorRate * 100).toFixed(1)}% exceeded limit ${(maxErrorRate * 100).toFixed(1)}%`);
    stoppedEarly = true;
    break;
  }
}

process.exitCode = stoppedEarly ? 2 : 0;

async function runStage(concurrency) {
  const deadline = performance.now() + stageSeconds * 1_000;
  const latencies = [];
  const statuses = new Map();
  let bytes = 0;
  let networkErrors = 0;

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < deadline) {
      const started = performance.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          headers: { accept: "application/json,text/html;q=0.9,*/*;q=0.8", "user-agent": "BlueFun-Controlled-Load-Test/1.0" },
          redirect: "manual",
          signal: controller.signal
        });
        const body = await response.arrayBuffer();
        bytes += body.byteLength;
        statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
      } catch {
        networkErrors += 1;
      } finally {
        clearTimeout(timeout);
        latencies.push(performance.now() - started);
      }
    }
  }));

  latencies.sort((a, b) => a - b);
  const requests = latencies.length;
  const httpErrors = Array.from(statuses.entries()).reduce((sum, [status, count]) => sum + (status >= 400 ? count : 0), 0);
  const errors = httpErrors + networkErrors;
  return {
    concurrency,
    durationSeconds: stageSeconds,
    requests,
    requestsPerSecond: round(requests / stageSeconds),
    errorRate: requests ? errors / requests : 1,
    networkErrors,
    statuses: Object.fromEntries(statuses),
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: round(latencies.at(-1) || 0)
    },
    megabytes: round(bytes / 1024 / 1024)
  };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  return round(values[Math.min(values.length - 1, Math.floor(values.length * ratio))]);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
