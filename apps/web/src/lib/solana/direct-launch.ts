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
  createMetadataAccountV3,
  findMetadataPda,
  mplTokenMetadata
} from "@metaplex-foundation/mpl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { none, publicKey as umiPublicKey } from "@metaplex-foundation/umi";
import { walletAdapterIdentity } from "@metaplex-foundation/umi-signer-wallet-adapters";
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

type BrowserWallet = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>;
};

export type SolanaLaunchProgress = {
  key: "mint" | "metadata" | "registry" | "pool" | "split" | "buy" | "verify";
  label: string;
  signature?: string;
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
  onProgress?: (progress: SolanaLaunchProgress) => void;
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

  const mint = Keypair.generate();
  const creatorTokenAccount = getAssociatedTokenAddressSync(mint.publicKey, creator);
  const rent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const mintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: creator,
      newAccountPubkey: mint.publicKey,
      lamports: rent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID
    }),
    createInitializeMintInstruction(mint.publicKey, SOLANA_TOKEN_DECIMALS, creator, creator),
    createAssociatedTokenAccountIdempotentInstruction(creator, creatorTokenAccount, creator, mint.publicKey),
    createMintToInstruction(mint.publicKey, creatorTokenAccount, creator, SOLANA_TOKEN_SUPPLY_RAW)
  );
  const mintSignature = await sendTransaction(connection, wallet, mintTx, [mint]);
  input.onProgress?.({ key: "mint", label: "1B fixed supply minted", signature: mintSignature });

  const umi = createUmi(endpoint).use(mplTokenMetadata()).use(walletAdapterIdentity(walletAdapter));
  const umiMint = umiPublicKey(mint.publicKey.toBase58());
  const metadata = findMetadataPda(umi, { mint: umiMint });
  const metadataResult = await createMetadataAccountV3(umi, {
    metadata,
    mint: umiMint,
    mintAuthority: umi.identity,
    payer: umi.identity,
    updateAuthority: umi.identity,
    data: {
      name: input.name,
      symbol: input.symbol,
      uri: input.metadataUri,
      sellerFeeBasisPoints: 0,
      creators: none(),
      collection: none(),
      uses: none()
    },
    isMutable: false,
    collectionDetails: none()
  }).sendAndConfirm(umi, { confirm: { commitment: "confirmed" } });
  input.onProgress?.({ key: "metadata", label: "Immutable token metadata created", signature: base58Signature(metadataResult.signature) });

  const revokeTx = new Transaction().add(
    createSetAuthorityInstruction(mint.publicKey, creator, AuthorityType.MintTokens, null),
    createSetAuthorityInstruction(mint.publicKey, creator, AuthorityType.FreezeAccount, null)
  );
  await sendTransaction(connection, wallet, revokeTx);

  const [launchAddress] = PublicKey.findProgramAddressSync(
    [Buffer.from("launch"), mint.publicKey.toBuffer()],
    BLUEFUN_SOLANA_PROGRAM_ID
  );
  const reserveTx = await program.methods
    .reserveLaunch(input.name, input.symbol, input.metadataUri, new BN(input.initialBuyLamports.toString()))
    .accounts({
      creator,
      config: configAddress,
      mint: mint.publicKey,
      launch: launchAddress,
      systemProgram: SystemProgram.programId
    })
    .transaction();
  const reserveSignature = await sendTransaction(connection, wallet, reserveTx);
  input.onProgress?.({ key: "registry", label: "BlueFun launch reserved", signature: reserveSignature });

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
    tokenAMint: mint.publicKey,
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
  const poolSignature = await sendTransaction(connection, wallet, poolCreation.tx, [creatorPositionNft]);
  input.onProgress?.({ key: "pool", label: "Meteora market created and LP locked", signature: poolSignature });

  const platformPositionNft = Keypair.generate();
  const platformPosition = derivePositionAddress(platformPositionNft.publicKey);
  const platformPositionNftAccount = derivePositionNftAccount(platformPositionNft.publicKey);
  const createPlatformPositionTx = await cpAmm.createPosition({
    owner: creator,
    payer: creator,
    pool: poolCreation.pool,
    positionNft: platformPositionNft.publicKey
  });
  await sendTransaction(connection, wallet, createPlatformPositionTx, [platformPositionNft]);

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
  await sendTransaction(connection, wallet, splitTx);

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
  const splitSignature = await sendTransaction(connection, wallet, transferPositionTx);
  input.onProgress?.({ key: "split", label: "Locked fee positions split 70/30", signature: splitSignature });

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
      outputTokenMint: mint.publicKey,
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
    const buySignature = await sendTransaction(connection, wallet, buyTx);
    input.onProgress?.({ key: "buy", label: "Optional first buy completed", signature: buySignature });
  }

  const finalizeTx = await program.methods.finalizeLaunch().accounts({
    creator,
    config: configAddress,
    treasury: config.treasury,
    launch: launchAddress,
    mint: mint.publicKey,
    pool: poolCreation.pool,
    creatorPosition: poolCreation.position,
    platformPosition,
    poolTokenAVault: deriveTokenVaultAddress(mint.publicKey, poolCreation.pool),
    creatorPositionNft: creatorPositionNftAccount,
    platformPositionNft: treasuryPositionNftAccount,
    creatorTokenAccount,
    systemProgram: SystemProgram.programId
  }).transaction();
  const signature = await sendTransaction(connection, wallet, finalizeTx);
  input.onProgress?.({ key: "verify", label: "Onchain verification complete", signature });

  return {
    mint: mint.publicKey.toBase58(),
    pool: poolCreation.pool.toBase58(),
    launch: launchAddress.toBase58(),
    creatorPosition: poolCreation.position.toBase58(),
    platformPosition: platformPosition.toBase58(),
    signature
  };
}

async function sendTransaction(connection: Connection, wallet: BrowserWallet, transaction: Transaction, signers: Signer[] = []) {
  if (!wallet.publicKey) throw new Error("Solana wallet disconnected.");
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  if (signers.length) transaction.partialSign(...signers);
  const signed = await wallet.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 4, skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  if (confirmation.value.err) throw new Error(`Solana transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  return signature;
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
