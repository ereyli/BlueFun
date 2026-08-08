import { AnchorProvider, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  CpAmm,
  derivePositionAddress,
  derivePositionNftAccount,
  deriveTokenVaultAddress,
  getBaseFeeParams,
  getSqrtPriceFromPrice
} from "@meteora-ag/cp-amm-sdk";
import {
  AuthorityType,
  MINT_SIZE,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";

const PROGRAM_ID = new PublicKey("CqjRfYuDzJgQUBF6BzRnNQfV5Gc4DT9a4pxrTQReX6f5");
const SUPPLY = 1_000_000_000_000_000_000n;
const DECIMALS = 9;
const PLATFORM_SPLIT = 700_000_000;
const rpc = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const walletPath = process.env.SOLANA_WALLET;
if (!walletPath) throw new Error("Set SOLANA_WALLET to a funded local validator keypair.");

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")) as number[]));
const treasury = Keypair.generate();
const connection = new Connection(rpc, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" });
const idl = JSON.parse(fs.readFileSync(path.resolve("idl/bluefun_solana.json"), "utf8")) as Idl;
const program = new Program(idl, provider);
const cpAmm = new CpAmm(connection);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);

const initialSqrtPrice = getSqrtPriceFromPrice((2_750 / 1_000_000_000 / 180).toPrecision(16), DECIMALS, DECIMALS);
const maxSqrtPrice = getSqrtPriceFromPrice((2_750 / 1_000_000_000 / 180 * 1_000).toPrecision(16), DECIMALS, DECIMALS);
await program.methods.initialize(initialSqrtPrice, maxSqrtPrice).accounts({
  admin: payer.publicKey,
  guardian: payer.publicKey,
  treasury: treasury.publicKey,
  config,
  systemProgram: SystemProgram.programId
}).rpc();

const mint = Keypair.generate();
const creatorTokenAccount = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey);
const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
await sendAndConfirmTransaction(connection, new Transaction().add(
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: mint.publicKey,
    lamports: mintRent,
    space: MINT_SIZE,
    programId: TOKEN_PROGRAM_ID
  }),
  createInitializeMintInstruction(mint.publicKey, DECIMALS, payer.publicKey, payer.publicKey),
  createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, creatorTokenAccount, payer.publicKey, mint.publicKey),
  createMintToInstruction(mint.publicKey, creatorTokenAccount, payer.publicKey, SUPPLY),
  createSetAuthorityInstruction(mint.publicKey, payer.publicKey, AuthorityType.MintTokens, null),
  createSetAuthorityInstruction(mint.publicKey, payer.publicKey, AuthorityType.FreezeAccount, null)
), [payer, mint], { commitment: "confirmed" });

const [launch] = PublicKey.findProgramAddressSync([Buffer.from("launch"), mint.publicKey.toBuffer()], PROGRAM_ID);
await program.methods.reserveLaunch("BlueFun Local", "BLUE", "https://blue.fun/local.json", new BN(0)).accounts({
  creator: payer.publicKey,
  config,
  mint: mint.publicKey,
  launch,
  systemProgram: SystemProgram.programId
}).rpc();

const tokenAAmount = new BN(SUPPLY.toString());
const liquidityDelta = cpAmm.preparePoolCreationSingleSide({
  tokenAAmount,
  initSqrtPrice: initialSqrtPrice,
  minSqrtPrice: initialSqrtPrice,
  maxSqrtPrice,
  collectFeeMode: CollectFeeMode.OnlyB
});
const creatorPositionNft = Keypair.generate();
const poolCreation = await cpAmm.createCustomPool({
  payer: payer.publicKey,
  creator: payer.publicKey,
  positionNft: creatorPositionNft.publicKey,
  tokenAMint: mint.publicKey,
  tokenBMint: NATIVE_MINT,
  tokenAAmount,
  tokenBAmount: new BN(0),
  sqrtMinPrice: initialSqrtPrice,
  sqrtMaxPrice: maxSqrtPrice,
  liquidityDelta,
  initSqrtPrice: initialSqrtPrice,
  poolFees: {
    baseFee: getBaseFeeParams({
      baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear,
      feeTimeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 }
    }, DECIMALS, ActivationType.Slot),
    compoundingFeeBps: 0,
    padding: 0,
    dynamicFee: null
  },
  hasAlphaVault: false,
  activationType: ActivationType.Slot,
  collectFeeMode: CollectFeeMode.OnlyB,
  activationPoint: null,
  tokenAProgram: TOKEN_PROGRAM_ID,
  tokenBProgram: TOKEN_PROGRAM_ID,
  isLockLiquidity: true
});
await sendAndConfirmTransaction(connection, poolCreation.tx, [payer, creatorPositionNft], { commitment: "confirmed" });

const platformPositionNft = Keypair.generate();
const platformPosition = derivePositionAddress(platformPositionNft.publicKey);
const platformPositionNftAccount = derivePositionNftAccount(platformPositionNft.publicKey);
const createPosition = await cpAmm.createPosition({
  owner: payer.publicKey,
  payer: payer.publicKey,
  pool: poolCreation.pool,
  positionNft: platformPositionNft.publicKey
});
await sendAndConfirmTransaction(connection, createPosition, [payer, platformPositionNft], { commitment: "confirmed" });

const creatorPositionNftAccount = derivePositionNftAccount(creatorPositionNft.publicKey);
const split = await cpAmm.splitPosition2({
  firstPositionOwner: payer.publicKey,
  secondPositionOwner: payer.publicKey,
  pool: poolCreation.pool,
  firstPosition: poolCreation.position,
  firstPositionNftAccount: creatorPositionNftAccount,
  secondPosition: platformPosition,
  secondPositionNftAccount: platformPositionNftAccount,
  numerator: PLATFORM_SPLIT
});
await sendAndConfirmTransaction(connection, split, [payer], { commitment: "confirmed" });

const treasuryPositionNftAccount = getAssociatedTokenAddressSync(
  platformPositionNft.publicKey,
  treasury.publicKey,
  true,
  TOKEN_2022_PROGRAM_ID
);
await sendAndConfirmTransaction(connection, new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey,
    treasuryPositionNftAccount,
    treasury.publicKey,
    platformPositionNft.publicKey,
    TOKEN_2022_PROGRAM_ID
  ),
  createTransferInstruction(
    platformPositionNftAccount,
    treasuryPositionNftAccount,
    payer.publicKey,
    1,
    [],
    TOKEN_2022_PROGRAM_ID
  )
), [payer], { commitment: "confirmed" });

const invalidTreasuryBefore = await connection.getBalance(treasury.publicKey, "confirmed");
let invalidFinalizeRejected = false;
try {
  await program.methods.finalizeLaunch().accounts({
    creator: payer.publicKey,
    config,
    treasury: treasury.publicKey,
    launch,
    mint: mint.publicKey,
    pool: poolCreation.pool,
    creatorPosition: poolCreation.position,
    platformPosition,
    creatorPositionNft: creatorPositionNftAccount,
    platformPositionNft: treasuryPositionNftAccount,
    poolTokenAVault: creatorTokenAccount,
    creatorTokenAccount,
    systemProgram: SystemProgram.programId
  }).rpc();
} catch {
  invalidFinalizeRejected = true;
}
if (!invalidFinalizeRejected) throw new Error("Invalid pool vault was accepted.");
if (await connection.getBalance(treasury.publicKey, "confirmed") !== invalidTreasuryBefore) {
  throw new Error("Launch fee moved before all verification checks passed.");
}

const treasuryBefore = await connection.getBalance(treasury.publicKey, "confirmed");
const signature = await program.methods.finalizeLaunch().accounts({
  creator: payer.publicKey,
  config,
  treasury: treasury.publicKey,
  launch,
  mint: mint.publicKey,
  pool: poolCreation.pool,
  creatorPosition: poolCreation.position,
  platformPosition,
  creatorPositionNft: creatorPositionNftAccount,
  platformPositionNft: treasuryPositionNftAccount,
  poolTokenAVault: deriveTokenVaultAddress(mint.publicKey, poolCreation.pool),
  creatorTokenAccount,
  systemProgram: SystemProgram.programId
}).rpc();
const treasuryAfter = await connection.getBalance(treasury.publicKey, "confirmed");
const launchState = await (program.account as unknown as {
  launch: { fetch(address: PublicKey): Promise<{ finalized: boolean; pool: PublicKey; initialCreatorTokenBalance: BN }> }
}).launch.fetch(launch);

if (!launchState.finalized) throw new Error("Launch did not finalize.");
if (!launchState.pool.equals(poolCreation.pool)) throw new Error("Verified pool was not persisted.");
if (launchState.initialCreatorTokenBalance.toString() !== "0") throw new Error("Unexpected creator token balance.");
if (treasuryAfter - treasuryBefore !== 50_000_000) throw new Error("Launch fee was not transferred exactly once.");

console.log(JSON.stringify({
  status: "ok",
  program: PROGRAM_ID.toBase58(),
  mint: mint.publicKey.toBase58(),
  pool: poolCreation.pool.toBase58(),
  launch: launch.toBase58(),
  creatorPosition: poolCreation.position.toBase58(),
  platformPosition: platformPosition.toBase58(),
  invalidFinalizeRejected,
  launchFeeLamports: treasuryAfter - treasuryBefore,
  signature
}, null, 2));
