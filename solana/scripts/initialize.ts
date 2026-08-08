import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import { getSqrtPriceFromPrice } from "@meteora-ag/cp-amm-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";

const keypairPath = expandHome(process.env.SOLANA_WALLET || "~/.config/solana/bluefun-mainnet-deployer.json");
const rpc = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const solUsd = Number(process.env.SOL_USD);
const targetFdvUsd = Number(process.env.TARGET_FDV_USD || "2750");
const rangeMultiplier = Number(process.env.PRICE_RANGE_MULTIPLIER || "1000");
if (!Number.isFinite(solUsd) || solUsd <= 0) throw new Error("Set a current, verified SOL_USD value before initialization.");
if (!Number.isFinite(targetFdvUsd) || targetFdvUsd <= 0) throw new Error("TARGET_FDV_USD must be positive.");

const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")) as number[]));
const connection = new Connection(rpc, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(keypair), { commitment: "confirmed" });
const idl = JSON.parse(fs.readFileSync(path.resolve("idl/bluefun_solana.json"), "utf8")) as Idl;
const program = new Program(idl, provider);
const tokenPriceSol = targetFdvUsd / 1_000_000_000 / solUsd;
const initialSqrtPrice = getSqrtPriceFromPrice(tokenPriceSol.toPrecision(16), 9, 9);
const maxSqrtPrice = getSqrtPriceFromPrice((tokenPriceSol * rangeMultiplier).toPrecision(16), 9, 9);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

const existing = await connection.getAccountInfo(config, "confirmed");
if (existing) throw new Error(`Config already initialized: ${config.toBase58()}`);

const signature = await program.methods.initialize(initialSqrtPrice, maxSqrtPrice).accounts({
  admin: keypair.publicKey,
  guardian: keypair.publicKey,
  treasury: keypair.publicKey,
  config
}).rpc();

console.log(JSON.stringify({
  programId: program.programId.toBase58(),
  config: config.toBase58(),
  admin: keypair.publicKey.toBase58(),
  launchFeeSol: 0.05,
  targetFdvUsd,
  solUsd,
  initialSqrtPrice: initialSqrtPrice.toString(),
  maxSqrtPrice: maxSqrtPrice.toString(),
  signature
}, null, 2));

function expandHome(value: string) {
  return value.startsWith("~/") ? path.join(process.env.HOME || "", value.slice(2)) : value;
}
