import "dotenv/config";
import { createServer } from "node:http";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import idl from "../../../solana/idl/bluefun_solana.json" with { type: "json" };
import { closeDatabase, ensureSchema, updateLaunchState, upsertLaunch } from "./db.js";

const rpc = process.env.SOLANA_RPC_URL || process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const programId = new PublicKey(process.env.SOLANA_PROGRAM_ID || "CqjRfYuDzJgQUBF6BzRnNQfV5Gc4DT9a4pxrTQReX6f5");
const scope = `solana:101:${programId.toBase58()}`;
const pollMs = Math.max(2_000, Number(process.env.POLL_MS || "5000"));
const healthPort = Number(process.env.HEALTH_PORT || "3000");
const connection = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: false });
const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()), { commitment: "confirmed" });
const program = new Program(idl as Idl, provider);
const launchClient = (program.account as unknown as {
  launch: { all(): Promise<Array<{ publicKey: PublicKey; account: unknown }>> }
}).launch;
const seen = new Set<string>();
let lastSuccess = 0;
let lastError = "";
let indexed = 0;
let running = false;
let stopped = false;

await ensureSchema();

createServer((_request, response) => {
  const healthy = !lastSuccess || Date.now() - lastSuccess < Math.max(180_000, pollMs * 6);
  response.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
  response.end(JSON.stringify({ status: healthy ? lastSuccess ? "ok" : "starting" : "stale", chainId: 101, programId: programId.toBase58(), scope, indexed, running, lastSuccess, lastError }));
}).listen(healthPort, "0.0.0.0");

async function poll() {
  if (running || stopped) return;
  running = true;
  try {
    const accounts = await launchClient.all();
    for (const entry of accounts) {
      const account = entry.account as SolanaLaunchAccount;
      if (!account.finalized) continue;
      const mint = account.mint.toBase58();
      if (seen.has(mint)) continue;
      const signatures = await connection.getSignaturesForAddress(entry.publicKey, { limit: 1 }, "confirmed");
      const signature = signatures[0];
      const metadata = await readMetadata(account.metadataUri);
      await upsertLaunch(scope, {
        id: BigInt(account.id.toString()), token: mint, creator: account.creator.toBase58(),
        name: account.name, symbol: account.symbol, contractURI: account.metadataUri,
        imageUri: metadata.image, description: metadata.description, website: metadata.website,
        twitter: metadata.twitter, telegram: metadata.telegram, discord: metadata.discord,
        launchMode: "direct", dexProvider: "meteora", poolFee: 10_000, tickSpacing: 0,
        liquidityLocker: account.pool.toBase58(),
        txHash: signature?.signature || entry.publicKey.toBase58(), blockNumber: BigInt(signature?.slot || 0)
      });
      await updateLaunchState(scope, {
        id: BigInt(account.id.toString()), status: "live", raisedEth: 0n, graduationTargetEth: 0n,
        progress: 100, creatorAllocation: BigInt(account.initialCreatorTokenBalance.toString()),
        tokenCreatedAt: BigInt(account.finalizedAt.toString())
      });
      seen.add(mint);
    }
    indexed = seen.size;
    lastSuccess = Date.now();
    lastError = "";
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("Solana indexer poll failed", error);
  } finally {
    running = false;
    if (!stopped) setTimeout(() => void poll(), pollMs);
  }
}

void poll();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => {
  stopped = true;
  await closeDatabase();
  process.exit(0);
});

type SolanaLaunchAccount = {
  id: { toString(): string }; creator: PublicKey; mint: PublicKey; pool: PublicKey;
  name: string; symbol: string; metadataUri: string;
  initialCreatorTokenBalance: { toString(): string };
  finalizedAt: { toString(): string }; finalized: boolean;
};

async function readMetadata(uri: string) {
  const empty: Metadata = {};
  if (!uri.startsWith("ipfs://") && !uri.startsWith("https://")) return empty;
  try {
    const url = uri.startsWith("ipfs://") ? `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}` : uri;
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return empty;
    const data = await response.json() as Record<string, unknown>;
    const socials = data.socials && typeof data.socials === "object" ? data.socials as Record<string, unknown> : {};
    return {
      image: typeof data.image === "string" ? data.image : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
      website: typeof data.external_url === "string" ? data.external_url : typeof socials.website === "string" ? socials.website : undefined,
      twitter: typeof socials.twitter === "string" ? socials.twitter : undefined,
      telegram: typeof socials.telegram === "string" ? socials.telegram : undefined,
      discord: typeof socials.discord === "string" ? socials.discord : undefined
    };
  } catch { return empty; }
}

type Metadata = { image?: string; description?: string; website?: string; twitter?: string; telegram?: string; discord?: string };
