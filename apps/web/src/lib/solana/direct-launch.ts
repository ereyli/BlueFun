import { AnchorProvider, BN, Program, type Idl, type Wallet } from "@coral-xyz/anchor";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  CpAmm,
  derivePositionAddress,
  derivePositionNftAccount,
  deriveTokenVaultAddress,
  getBaseFeeParams
} from "@meteora-ag/cp-amm-sdk";
import {
  createV1,
  findMetadataPda,
  mplTokenMetadata,
  TokenStandard
} from "@metaplex-foundation/mpl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { none, percentAmount, publicKey as umiPublicKey } from "@metaplex-foundation/umi";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
import { toWeb3JsInstruction } from "@metaplex-foundation/umi-web3js-adapters";
import type { WalletAdapter } from "@solana/wallet-adapter-base";
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
  getMint,
  getAssociatedTokenAddressSync
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type Signer
} from "@solana/web3.js";
import bluefunIdl from "./bluefun-idl.json";

export const BLUEFUN_SOLANA_PROGRAM_ID = new PublicKey("CqjRfYuDzJgQUBF6BzRnNQfV5Gc4DT9a4pxrTQReX6f5");
export const METEORA_DAMM_V2_PROGRAM_ID = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
export const SOLANA_LAUNCH_FEE = 0.05;
export const SOLANA_TOKEN_SUPPLY_RAW = 1_000_000_000_000_000_000n;
export const SOLANA_MAX_INITIAL_BUY_RAW = SOLANA_TOKEN_SUPPLY_RAW / 20n;
export const SOLANA_TOKEN_DECIMALS = 9;
export const SOLANA_PLATFORM_SPLIT_NUMERATOR = 700_000_000;
// Measured from a production Meteora DAMM v2 BlueFun launch. This covers the
// mint/metadata, registry, pool, position and token-account rent deposits. The
// accounts and SDK layout are fixed, but the UI deliberately labels it as an
// estimate so a future Meteora layout change cannot understate the total.
export const SOLANA_ACCOUNT_RENT_ESTIMATE_LAMPORTS = 55_908_161n;

type BrowserWallet = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>;
};

export type SolanaLaunchProgress = {
  key: "approval" | "mint" | "metadata" | "registry" | "pool" | "split" | "buy" | "verify";
  label: string;
  signature?: string;
};

export type SolanaLaunchCostEstimate = {
  transactionCount: number;
  networkFeeLamports: bigint;
  accountRentLamports: bigint;
  launchFeeLamports: bigint;
  initialBuyLamports: bigint;
  minimumTotalLamports: bigint;
};

export type SolanaDirectLaunchInput = {
  connection: Connection;
  endpoint: string;
  wallet: BrowserWallet;
  walletAdapter: WalletAdapter;
  name: string;
  symbol: string;
  metadataUri: string;
  initialBuyLamports: bigint;
  existingMint?: PublicKey;
  onProgress?: (progress: SolanaLaunchProgress) => void;
  onEstimate?: (estimate: SolanaLaunchCostEstimate) => void;
};

export type SolanaDirectLaunchResult = {
  mint: string;
  pool: string;
  launch: string;
  creatorPosition: string;
  platformPosition: string;
  signature: string;
};

export async function launchSolanaDirect(input: SolanaDirectLaunchInput): Promise<SolanaDirectLaunchResult> {
  const { connection, endpoint, wallet, walletAdapter } = input;
  if (!wallet.publicKey) throw new Error("Connect a Solana wallet before launching.");
  const creator = wallet.publicKey;
  const provider = new AnchorProvider(connection, wallet as Wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  const program = new Program(bluefunIdl as Idl, provider);
  const cpAmm = new CpAmm(connection);
  const [configAddress] = PublicKey.findProgramAddressSync([Buffer.from("config")], BLUEFUN_SOLANA_PROGRAM_ID);
  const configClient = (program.account as unknown as { config: { fetch(address: PublicKey): Promise<unknown> } }).config;
  const config = await configClient.fetch(configAddress) as {
    treasury: PublicKey;
    paused: boolean;
    launchFeeLamports: BN;
    initialSqrtPrice: BN;
    maxSqrtPrice: BN;
  };
  if (config.paused) throw new Error("Solana launches are temporarily paused.");
  // The config PDA is authoritative. The initial launch fee is 0.05 SOL, but
  // governance can change it through the program's timelocked update flow.

  const mintSigner = input.existingMint ? undefined : Keypair.generate();
  const mint = input.existingMint ?? mintSigner!.publicKey;
  const creatorTokenAccount = getAssociatedTokenAddressSync(mint, creator);
  const umi = createUmi(endpoint).use(mplTokenMetadata()).use(walletAdapterIdentity(walletAdapter));
  const umiMint = umiPublicKey(mint.toBase58());
  const metadata = findMetadataPda(umi, { mint: umiMint });
  const metadataBuilder = () => createV1(umi, {
    metadata,
    mint: umiMint,
    authority: umi.identity,
    payer: umi.identity,
    updateAuthority: umi.identity,
    name: input.name,
    symbol: input.symbol,
    uri: input.metadataUri,
    sellerFeeBasisPoints: percentAmount(0),
    tokenStandard: TokenStandard.Fungible,
    creators: none(),
    isMutable: false,
    collectionDetails: none()
  });
  const prepared: PreparedLaunchTransaction[] = [];
  if (mintSigner) {
    const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
    const mintTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: creator,
        newAccountPubkey: mint,
        lamports: rent,
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID
      }),
      createInitializeMintInstruction(mint, SOLANA_TOKEN_DECIMALS, creator, creator),
      createAssociatedTokenAccountIdempotentInstruction(creator, creatorTokenAccount, creator, mint),
      createMintToInstruction(mint, creatorTokenAccount, creator, SOLANA_TOKEN_SUPPLY_RAW),
      ...metadataBuilder().getInstructions().map(toWeb3JsInstruction)
    );
    prepared.push({
      key: "mint",
      label: "1B fixed supply and immutable metadata created",
      transaction: mintTx,
      signers: [mintSigner]
    });
  } else {
    const state = await getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID);
    if (state.decimals !== SOLANA_TOKEN_DECIMALS || state.supply !== SOLANA_TOKEN_SUPPLY_RAW) {
      throw new Error("The recovery mint does not match the fixed 1B BlueFun supply.");
    }
    if (!state.mintAuthority?.equals(creator) || !state.freezeAuthority?.equals(creator)) {
      throw new Error("The recovery mint is not controlled by the connected creator.");
    }
    input.onProgress?.({ key: "mint", label: "Existing 1B mint recovered" });
  }

  const revokeTx = new Transaction().add(
    createSetAuthorityInstruction(mint, creator, AuthorityType.MintTokens, null),
    createSetAuthorityInstruction(mint, creator, AuthorityType.FreezeAccount, null)
  );
  prepared.push({ key: "metadata", label: "Mint and freeze authorities revoked", transaction: revokeTx });

  const [launchAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("launch"), mint.toBuffer()],
    BLUEFUN_SOLANA_PROGRAM_ID
  );
  const reserveTx = await program.methods
    .reserveLaunch(input.name, input.symbol, input.metadataUri, new BN(input.initialBuyLamports.toString()))
    .accounts({
      creator,
      config: configAddress,
      mint,
      launch: launchAddress,
      systemProgram: SystemProgram.programId
    })
    .transaction();
  prepared.push({ key: "registry", label: "BlueFun launch reserved", transaction: reserveTx });

  const tokenAAmount = new BN(SOLANA_TOKEN_SUPPLY_RAW.toString());
  const tokenBAmount = new BN(0);
  const initSqrtPrice = new BN(config.initialSqrtPrice.toString());
  const maxSqrtPrice = new BN(config.maxSqrtPrice.toString());
  const liquidityDelta = cpAmm.preparePoolCreationSingleSide({
    tokenAAmount,
    initSqrtPrice,
    minSqrtPrice: initSqrtPrice,
    maxSqrtPrice,
    collectFeeMode: CollectFeeMode.OnlyB
  });
  const creatorPositionNft = Keypair.generate();
  const poolFees = {
    baseFee: getBaseFeeParams({
      baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear,
      feeTimeSchedulerParam: {
        startingFeeBps: 100,
        endingFeeBps: 100,
        numberOfPeriod: 0,
        totalDuration: 0
      }
    }, SOLANA_TOKEN_DECIMALS, ActivationType.Slot),
    compoundingFeeBps: 0,
    padding: 0,
    dynamicFee: null
  };
  const poolCreation = await cpAmm.createCustomPool({
    payer: creator,
    creator,
    positionNft: creatorPositionNft.publicKey,
    tokenAMint: mint,
    tokenBMint: NATIVE_MINT,
    tokenAAmount,
    tokenBAmount,
    sqrtMinPrice: initSqrtPrice,
    sqrtMaxPrice: maxSqrtPrice,
    liquidityDelta,
    initSqrtPrice,
    poolFees,
    hasAlphaVault: false,
    activationType: ActivationType.Slot,
    collectFeeMode: CollectFeeMode.OnlyB,
    activationPoint: null,
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: true
  });
  prepared.push({
    key: "pool",
    label: "Meteora market created and LP locked",
    transaction: poolCreation.tx,
    signers: [creatorPositionNft]
  });

  const platformPositionNft = Keypair.generate();
  const platformPosition = derivePositionAddress(platformPositionNft.publicKey);
  const platformPositionNftAccount = derivePositionNftAccount(platformPositionNft.publicKey);
  const createPlatformPositionTx = await cpAmm.createPosition({
    owner: creator,
    payer: creator,
    pool: poolCreation.pool,
    positionNft: platformPositionNft.publicKey
  });
  prepared.push({
    key: "split",
    label: "Platform fee position created",
    transaction: createPlatformPositionTx,
    signers: [platformPositionNft]
  });

  const creatorPositionNftAccount = derivePositionNftAccount(creatorPositionNft.publicKey);
  const splitTx = await cpAmm.splitPosition2({
    firstPositionOwner: creator,
    secondPositionOwner: creator,
    pool: poolCreation.pool,
    firstPosition: poolCreation.position,
    firstPositionNftAccount: creatorPositionNftAccount,
    secondPosition: platformPosition,
    secondPositionNftAccount: platformPositionNftAccount,
    numerator: SOLANA_PLATFORM_SPLIT_NUMERATOR
  });
  prepared.push({ key: "split", label: "Locked fee positions split 70/30", transaction: splitTx });

  const treasuryPositionNftAccount = getAssociatedTokenAddressSync(
    platformPositionNft.publicKey,
    config.treasury,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  const transferPositionTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      creator,
      treasuryPositionNftAccount,
      config.treasury,
      platformPositionNft.publicKey,
      TOKEN_2022_PROGRAM_ID
    ),
    createTransferInstruction(
      platformPositionNftAccount,
      treasuryPositionNftAccount,
      creator,
      1,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );
  prepared.push({ key: "split", label: "Platform fee position secured in treasury", transaction: transferPositionTx });

  const finalizeTx = await program.methods.finalizeLaunch().accounts({
    creator,
    config: configAddress,
    treasury: config.treasury,
    launch: launchAddress,
    mint,
    pool: poolCreation.pool,
    creatorPosition: poolCreation.position,
    platformPosition,
    poolTokenAVault: deriveTokenVaultAddress(mint, poolCreation.pool),
    creatorPositionNft: creatorPositionNftAccount,
    platformPositionNft: treasuryPositionNftAccount,
    creatorTokenAccount,
    systemProgram: SystemProgram.programId
  }).transaction();
  prepared.push({ key: "verify", label: "Onchain verification complete", transaction: finalizeTx });

  input.onProgress?.({ key: "approval", label: `Review and approve ${prepared.length} launch transactions once` });
  const batchResult = await signAndSendBatch(connection, wallet, prepared, {
    launchFeeLamports: BigInt(config.launchFeeLamports.toString()),
    initialBuyLamports: input.initialBuyLamports,
    onEstimate: input.onEstimate,
    onProgress: input.onProgress
  });

  // A first buy needs the newly-created pool state for its slippage-safe quote,
  // so it is intentionally prepared only after the launch batch has landed.
  // This is the sole optional second wallet approval in the launch flow.

  if (input.initialBuyLamports > 0n) {
    const poolState = await cpAmm.fetchPoolState(poolCreation.pool);
    const slot = await connection.getSlot("confirmed");
    const quote = cpAmm.getQuote({
      inAmount: new BN(input.initialBuyLamports.toString()),
      inputTokenMint: NATIVE_MINT,
      slippage: 0.02,
      poolState,
      currentTime: Math.floor(Date.now() / 1_000),
      currentSlot: slot,
      tokenADecimal: SOLANA_TOKEN_DECIMALS,
      tokenBDecimal: SOLANA_TOKEN_DECIMALS
    });
    if (BigInt(quote.swapOutAmount.toString()) > SOLANA_MAX_INITIAL_BUY_RAW) {
      throw new Error("Initial buy would exceed the 50M token (5%) limit. Reduce the SOL amount.");
    }
    const buyTx = await cpAmm.swap({
      payer: creator,
      pool: poolCreation.pool,
      inputTokenMint: NATIVE_MINT,
      outputTokenMint: mint,
      amountIn: new BN(input.initialBuyLamports.toString()),
      minimumAmountOut: quote.minSwapOutAmount,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount: null,
      poolState
    });
    input.onProgress?.({ key: "approval", label: "Approve the optional creator first buy" });
    const buySignature = await sendTransaction(connection, wallet, buyTx);
    input.onProgress?.({ key: "buy", label: "Optional first buy completed", signature: buySignature });
  }

  const signature = batchResult.signatures.at(-1)!;

  return {
    mint: mint.toBase58(),
    pool: poolCreation.pool.toBase58(),
    launch: launchAddress.toBase58(),
    creatorPosition: poolCreation.position.toBase58(),
    platformPosition: platformPosition.toBase58(),
    signature
  };
}

type PreparedLaunchTransaction = {
  key: SolanaLaunchProgress["key"];
  label: string;
  transaction: Transaction;
  signers?: Signer[];
};

type BatchOptions = {
  launchFeeLamports: bigint;
  initialBuyLamports: bigint;
  onEstimate?: (estimate: SolanaLaunchCostEstimate) => void;
  onProgress?: (progress: SolanaLaunchProgress) => void;
};

async function signAndSendBatch(
  connection: Connection,
  wallet: BrowserWallet,
  prepared: PreparedLaunchTransaction[],
  options: BatchOptions
) {
  if (typeof wallet.signAllTransactions !== "function") {
    throw new Error("This wallet does not support one-tap batch signing. Use Phantom or Solflare, then try again.");
  }
  const latest = await connection.getLatestBlockhash("confirmed");
  let networkFeeLamports = 0n;
  for (const item of prepared) {
    item.transaction.feePayer = wallet.publicKey;
    item.transaction.recentBlockhash = latest.blockhash;
    if (item.signers?.length) item.transaction.partialSign(...item.signers);
    const fee = await connection.getFeeForMessage(item.transaction.compileMessage(), "confirmed");
    networkFeeLamports += BigInt(fee.value ?? 5_000);
  }
  options.onEstimate?.({
    transactionCount: prepared.length,
    networkFeeLamports,
    launchFeeLamports: options.launchFeeLamports,
    initialBuyLamports: options.initialBuyLamports,
    accountRentLamports: SOLANA_ACCOUNT_RENT_ESTIMATE_LAMPORTS,
    minimumTotalLamports: networkFeeLamports + SOLANA_ACCOUNT_RENT_ESTIMATE_LAMPORTS + options.launchFeeLamports + options.initialBuyLamports
  });
  const signatures: string[] = [];
  let completed = 0;
  let currentBlockhash = latest;
  while (completed < prepared.length) {
    const remaining = prepared.slice(completed);
    for (const item of remaining) {
      item.transaction.feePayer = wallet.publicKey;
      item.transaction.recentBlockhash = currentBlockhash.blockhash;
      for (const signature of item.transaction.signatures) signature.signature = null;
      if (item.signers?.length) item.transaction.partialSign(...item.signers);
    }
    if (completed > 0) {
      options.onProgress?.({
        key: "approval",
        label: `The previous blockhash expired. Approve only the ${remaining.length} unfinished transactions to resume`
      });
    }
    const signed = await wallet.signAllTransactions(remaining.map((item) => item.transaction));
    let expired = false;
    for (let index = 0; index < signed.length; index += 1) {
      const item = remaining[index];
      try {
        const signature = await sendSignedTransaction(connection, signed[index], currentBlockhash.lastValidBlockHeight);
        signatures.push(signature);
        completed += 1;
        options.onProgress?.({ key: item.key, label: item.label, signature });
      } catch (error) {
        if (!(error instanceof BatchBlockhashExpiredError)) throw error;
        currentBlockhash = await connection.getLatestBlockhash("confirmed");
        expired = true;
        break;
      }
    }
    if (!expired && completed < prepared.length) {
      throw new Error("The Solana launch batch stopped before every transaction was submitted.");
    }
  }
  return { signatures };
}

class BatchBlockhashExpiredError extends Error {}

async function sendSignedTransaction(connection: Connection, transaction: Transaction, lastValidBlockHeight: number) {
  const raw = transaction.serialize();
  const knownSignature = transaction.signature ? base58Signature(transaction.signature) : undefined;
  let signature = knownSignature;
  let lastSend = 0;
  while (await connection.getBlockHeight("confirmed") <= lastValidBlockHeight) {
    if (Date.now() - lastSend > 2_500) {
      try {
        signature = await connection.sendRawTransaction(raw, { maxRetries: 4, skipPreflight: false });
      } catch (error) {
        const status = signature
          ? (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0]
          : null;
        if (status?.err) throw new Error(`Solana transaction failed: ${JSON.stringify(status.err)}`);
        if (!status && !isRetryableSendError(error)) throw error;
      }
      lastSend = Date.now();
    }
    if (signature) {
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (status?.err) throw new Error(`Solana transaction failed: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new BatchBlockhashExpiredError("The signed launch batch expired before every step landed.");
}

function isRetryableSendError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);
  return /blockhash|timeout|timed out|429|rate|fetch|network|already processed|node is behind/i.test(message);
}

async function sendTransaction(connection: Connection, wallet: BrowserWallet, transaction: Transaction, signers: Signer[] = []) {
  if (!wallet.publicKey) throw new Error("Solana wallet disconnected.");
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  if (signers.length) transaction.partialSign(...signers);
  const signed = await wallet.signTransaction(transaction);
  return sendSignedTransaction(connection, signed as Transaction, latest.lastValidBlockHeight);
}

function base58Signature(signature: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of signature) value = value * 256n + BigInt(byte);
  let output = "";
  while (value > 0) {
    const remainder = Number(value % 58n);
    value /= 58n;
    output = alphabet[remainder] + output;
  }
  for (const byte of signature) {
    if (byte !== 0) break;
    output = `1${output}`;
  }
  return output;
}
