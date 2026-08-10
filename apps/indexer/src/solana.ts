import "dotenv/config";
import { createServer } from "node:http";
import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, type ConfirmedSignatureInfo, type ParsedTransactionWithMeta } from "@solana/web3.js";
import idl from "../../../solana/idl/bluefun_solana.json" with { type: "json" };
import { closeDatabase, ensureSchema, insertTrade, updateLaunchState, upsertLaunch } from "./db.js";

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
const tradeCursors = new Map<string, string>();
const WSOL = "So11111111111111111111111111111111111111112";
const SPL_TO_DATABASE_DECIMALS = 1_000_000_000n;
const TOKEN_SUPPLY_RAW = 1_000_000_000_000_000_000n;
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
    const tradeErrors: string[] = [];
    for (const entry of accounts) {
      const account = entry.account as SolanaLaunchAccount;
      if (!account.finalized) continue;
      const mint = account.mint.toBase58();
      const launchId = BigInt(account.id.toString());
      if (!seen.has(mint)) {
        const signatures = await connection.getSignaturesForAddress(entry.publicKey, { limit: 1 }, "confirmed");
        const signature = signatures[0];
        const metadata = await readMetadata(account.metadataUri);
        await upsertLaunch(scope, {
          id: launchId, token: mint, creator: account.creator.toBase58(),
          name: account.name, symbol: account.symbol, contractURI: account.metadataUri,
          imageUri: metadata.image, description: metadata.description, website: metadata.website,
          twitter: metadata.twitter, telegram: metadata.telegram, discord: metadata.discord,
          launchMode: "direct", dexProvider: "meteora", poolFee: 10_000, tickSpacing: 0,
          liquidityLocker: account.pool.toBase58(),
          txHash: signature?.signature || entry.publicKey.toBase58(), blockNumber: BigInt(signature?.slot || 0)
        });
        await updateLaunchState(scope, {
          id: launchId, status: "live", raisedEth: 0n, graduationTargetEth: 0n,
          progress: 100, creatorAllocation: BigInt(account.initialCreatorTokenBalance.toString()),
          tokenCreatedAt: BigInt(account.finalizedAt.toString())
        });
        seen.add(mint);
      }
      try {
        await indexPoolTrades({ launchId, mint, pool: account.pool });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        tradeErrors.push(`${account.pool.toBase58()}: ${message}`);
        console.error(`Solana Meteora trade indexing failed for ${mint}`, error);
      }
    }
    indexed = seen.size;
    lastSuccess = Date.now();
    lastError = tradeErrors.length ? `${tradeErrors.length} Meteora market(s) could not be refreshed: ${tradeErrors[0]}` : "";
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

async function indexPoolTrades(input: { launchId: bigint; mint: string; pool: PublicKey }) {
  const poolAddress = input.pool.toBase58();
  const cursor = tradeCursors.get(poolAddress);
  const signatures = await readNewPoolSignatures(input.pool, cursor);
  if (!signatures.length) return;
  const successful = signatures.filter((item) => !item.err);
  for (let offset = 0; offset < successful.length; offset += 50) {
    const page = successful.slice(offset, offset + 50);
    const transactions = await connection.getParsedTransactions(page.map((item) => item.signature), {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    });
    for (let index = 0; index < page.length; index += 1) {
      const trade = parseMeteoraTrade(page[index], transactions[index], input.mint);
      if (!trade) continue;
      const nativeAmount = trade.nativeAmount * SPL_TO_DATABASE_DECIMALS;
      const tokenAmount = trade.tokenAmount * SPL_TO_DATABASE_DECIMALS;
      await insertTrade(scope, {
        launchId: input.launchId,
        trader: trade.trader,
        side: trade.side,
        source: "meteora",
        ethAmount: nativeAmount,
        tokenAmount,
        marketCapEth: tokenAmount > 0n ? nativeAmount * TOKEN_SUPPLY_RAW / trade.tokenAmount : undefined,
        txHash: page[index].signature,
        blockNumber: BigInt(page[index].slot)
      });
    }
  }
  tradeCursors.set(poolAddress, signatures[0].signature);
}

async function readNewPoolSignatures(pool: PublicKey, until: string | undefined) {
  const rows: ConfirmedSignatureInfo[] = [];
  let before: string | undefined;
  for (let pageIndex = 0; pageIndex < 25; pageIndex += 1) {
    const page = await connection.getSignaturesForAddress(pool, { limit: 1_000, before, until }, "confirmed");
    if (!page.length) break;
    rows.push(...page);
    const last = page.at(-1)!;
    if (page.length < 1_000) break;
    before = last.signature;
  }
  return rows;
}

function parseMeteoraTrade(signature: ConfirmedSignatureInfo, transaction: ParsedTransactionWithMeta | null, mint: string) {
  if (!transaction?.meta || transaction.meta.err) return;
  const signer = transaction.transaction.message.accountKeys.find((key) => key.signer);
  const trader = signer?.pubkey.toBase58();
  if (!trader) return;
  const tokenDelta = ownerTokenDelta(transaction.meta.preTokenBalances, transaction.meta.postTokenBalances, mint, trader);
  const nativeDelta = largestMintDelta(transaction.meta.preTokenBalances, transaction.meta.postTokenBalances, WSOL);
  const tokenAmount = absolute(tokenDelta);
  const nativeAmount = absolute(nativeDelta);
  if (tokenAmount <= 0n || nativeAmount <= 1_000n) return;
  return { trader, side: tokenDelta > 0n ? "buy" as const : "sell" as const, tokenAmount, nativeAmount, signature: signature.signature };
}

type TransactionTokenBalance = NonNullable<NonNullable<ParsedTransactionWithMeta["meta"]>["postTokenBalances"]>[number];
function ownerTokenDelta(pre: TransactionTokenBalance[] | null | undefined, post: TransactionTokenBalance[] | null | undefined, mint: string, owner: string) {
  return sumBalances(post, mint, owner) - sumBalances(pre, mint, owner);
}
function largestMintDelta(pre: TransactionTokenBalance[] | null | undefined, post: TransactionTokenBalance[] | null | undefined, mint: string) {
  const indexes = new Set([...(pre || []), ...(post || [])].filter((row) => row.mint === mint).map((row) => row.accountIndex));
  let largest = 0n;
  for (const index of indexes) {
    const delta = balanceAt(post, mint, index) - balanceAt(pre, mint, index);
    if (absolute(delta) > absolute(largest)) largest = delta;
  }
  return largest;
}
function sumBalances(rows: TransactionTokenBalance[] | null | undefined, mint: string, owner: string) {
  return (rows || []).filter((row) => row.mint === mint && row.owner === owner).reduce((total, row) => total + BigInt(row.uiTokenAmount.amount || "0"), 0n);
}
function balanceAt(rows: TransactionTokenBalance[] | null | undefined, mint: string, index: number) {
  return BigInt((rows || []).find((row) => row.mint === mint && row.accountIndex === index)?.uiTokenAmount.amount || "0");
}
function absolute(value: bigint) { return value < 0n ? -value : value; }

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
