"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { decodeEventLog, formatEther, parseEther, keccak256, toBytes } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { CheckCircle2, ChevronLeft, ChevronRight, Coins, ImagePlus, Info, Loader2, LockKeyhole, Rocket, TimerReset, UploadCloud } from "lucide-react";
import { contractsForChain, FAIR_GRADUATION_TARGET_ETH, FAIR_LAUNCH_FEE_ETH, launchFactoryAbi } from "@/lib/contracts";
import { useSearchParams } from "next/navigation";
import { NetworkIcon } from "@/components/network-icon";
import { chainIdFromParam, chainSlug } from "@/lib/chain-slug";

export default function LaunchPage() {
  return <Suspense fallback={<div className="empty">Loading launch form...</div>}><LaunchPageContent /></Suspense>;
}

function LaunchPageContent() {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [imageUri, setImageUri] = useState("");
  const [metadataUri, setMetadataUri] = useState("");
  const [metadataUploadKey, setMetadataUploadKey] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [isMetadataUploading, setIsMetadataUploading] = useState(false);
  const [initialBuy, setInitialBuy] = useState("0");
  const [confirmedLaunchId, setConfirmedLaunchId] = useState("");
  const [confirmedToken, setConfirmedToken] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const { isConnected, chainId } = useAccount();
  const requestedChain = useSearchParams().get("chain");
  const activeChainId = requestedChain ? chainIdFromParam(requestedChain) : chainId === 4663 ? 4663 : 8453;
  const { addresses, chain } = contractsForChain(activeChainId);
  const isRobinhood = chain.id === 4663;
  const { data: hash, error, writeContract, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  const salt = useMemo(() => keccak256(toBytes(`${name}:${symbol}:${Date.now()}`)), [name, symbol]);
  const initialBuyEth = parsePositiveEther(initialBuy);
  const initialBuyTooLarge = initialBuyEth > parseEther(FAIR_GRADUATION_TARGET_ETH);
  const metadataKey = imageUri
    ? `${name.trim()}:${symbol.trim()}:${imageUri}:${description.trim()}:${website.trim()}:${twitter.trim()}:${telegram.trim()}:${discord.trim()}`
    : "";
  const disabled = !addresses.launchFactory || !name.trim() || !symbol.trim() || !imageUri || initialBuyTooLarge;
  const disabledReason = getDisabledReason({
    hasFactory: Boolean(addresses.launchFactory),
    hasName: Boolean(name.trim()),
    hasSymbol: Boolean(symbol.trim()),
    hasImage: Boolean(imagePreview),
    imageReady: Boolean(imageUri),
    imageUploading: isImageUploading,
    initialBuyTooLarge,
    isConnected
  });
  const isWorking = isImageUploading || isMetadataUploading || isPending || receipt.isLoading;
  const launchFeeEth = parseEther(FAIR_LAUNCH_FEE_ETH);
  const totalLaunchValue = launchFeeEth + initialBuyEth;
  const identityReady = Boolean(name.trim() && symbol.trim() && imageUri && !isImageUploading);
  const launchStatus = getLaunchStatus({
    disabledReason,
    error: error?.message,
    hash: Boolean(hash),
    isImageUploading,
    isMetadataUploading,
    isPending,
    isReceiptLoading: receipt.isLoading,
    isSuccess: receipt.isSuccess,
    metadataReady: Boolean(metadataUri),
    uploadError
  });

  useEffect(() => {
    if (!receipt.isSuccess || !receipt.data?.logs.length || confirmedLaunchId) return;

    for (const log of receipt.data.logs) {
      try {
        const decoded = decodeEventLog({
          abi: launchFactoryAbi,
          data: log.data,
          topics: log.topics
        });
        if (decoded.eventName === "LaunchCreated") {
          const launchId = decoded.args.launchId.toString();
          setConfirmedLaunchId(launchId);
          setConfirmedToken(decoded.args.token);
          return;
        }
      } catch {
        // Ignore unrelated logs.
      }
    }
  }, [receipt.isSuccess, receipt.data?.logs, confirmedLaunchId]);

  async function submit() {
    if (!addresses.launchFactory || disabled || !isConnected) return;
    setUploadError("");

    let launchMetadataUri = metadataUri;
    if (!launchMetadataUri || metadataUploadKey !== metadataKey) {
      if (!imageUri) return;
      try {
        setIsMetadataUploading(true);
        launchMetadataUri = await uploadMetadata(name.trim(), symbol.trim(), imageUri, activeChainId, getProjectDetails());
        setMetadataUri(launchMetadataUri);
        setMetadataUploadKey(metadataKey);
      } catch (metadataError) {
        setUploadError(metadataError instanceof Error ? metadataError.message : "Launch media could not be prepared.");
        return;
      } finally {
        setIsMetadataUploading(false);
      }
    }

    writeContract({
      chainId: activeChainId,
      address: addresses.launchFactory,
      abi: launchFactoryAbi,
      functionName: "createLaunch",
      args: [
        { name: name.trim(), symbol: symbol.trim(), contractURI: launchMetadataUri, salt },
        {
          virtualTokenReserve: parseEther("1000000000"),
          virtualEthReserve: parseEther("1.25"),
          graduationEthTarget: parseEther(FAIR_GRADUATION_TARGET_ETH),
          maxSupply: parseEther("1000000000")
        },
        {
          perWalletCap: parseEther("900000000"),
          creatorAllocation: 0n,
          platformFeeBps: 70,
          creatorFeeBps: 30,
          antiSnipingDuration: 60n,
          antiSnipingMaxBuy: parseEther("500000000")
        }
      ],
      value: totalLaunchValue
    });
  }

  async function selectImage(file?: File) {
    setUploadError("");
    setImageUri("");
    setMetadataUri("");
    setMetadataUploadKey("");
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(file ? URL.createObjectURL(file) : "");
    if (!file) return;

    try {
      setIsImageUploading(true);
      const uploadedImageUri = await uploadImage(file);
      setImageUri(uploadedImageUri);
    } catch (imageError) {
      setUploadError(imageError instanceof Error ? imageError.message : "Image could not be uploaded. Please try again.");
    } finally {
      setIsImageUploading(false);
    }
  }

  function getProjectDetails() {
    return {
      description: description.trim(),
      website: website.trim(),
      twitter: twitter.trim(),
      telegram: telegram.trim(),
      discord: discord.trim()
    };
  }

  return (
    <div className="launch-page">
      <section className="launch-intro">
        <div className="launch-hero-panel">
          <div className="launch-network-chip"><NetworkIcon chainId={activeChainId} size={22} /><span>Launching on <strong>{chain.name}</strong></span></div>
          <h1>Create a fair launch.</h1>
          <p className="muted">
            Add metadata, choose an optional first buy, and publish directly to the bonding curve.
          </p>
          <div className="launch-preview-card">
            <div className="launch-preview-art">
              {imagePreview ? <img src={imagePreview} alt="Token preview" /> : <Rocket size={36} />}
            </div>
            <div>
              <span className="muted">Preview</span>
              <h2>{name.trim() || (isRobinhood ? "Your ERC-20 token" : "Your B20 token")}</h2>
              <p className="muted">${symbol.trim() || "SYMBOL"} · first buy {initialBuy || "0"} ETH · fee {FAIR_LAUNCH_FEE_ETH} ETH</p>
            </div>
            <div className="launch-preview-stat">
              <span>Target</span>
              <strong>{FAIR_GRADUATION_TARGET_ETH} ETH</strong>
            </div>
          </div>
        </div>
        <section className="launch-feature-grid">
          <div><Coins /><span><strong>1B fixed supply</strong><small>0% creator allocation</small></span></div>
          <div><TimerReset /><span><strong>60s launch guard</strong><small>Fair early access</small></span></div>
          <div><LockKeyhole /><span><strong>Liquidity locked</strong><small>After graduation</small></span></div>
        </section>
      </section>
      <section className="launch-form-card">
        <div className="launch-form-header">
          <span className="pill">Launch setup</span>
          <h2>Create token</h2>
        </div>
        <div className="form">
          {!isConnected ? (
            <div className="launch-wallet-gate">
              <span className="wallet-status-dot" />
              <div><strong>Connect wallet to launch</strong><small>Use the wallet button in the header. Transactions will be sent on {chain.name}.</small></div>
            </div>
          ) : null}
          <div className="launch-stepper" aria-label="Launch progress">
            {([1, 2, 3] as const).map((item) => {
              const complete = item === 1 ? identityReady : item === 2 ? step === 3 : receipt.isSuccess;
              return (
                <button
                  aria-current={step === item ? "step" : undefined}
                  className={step === item ? "active" : complete ? "complete" : ""}
                  disabled={item === 3 && !identityReady}
                  key={item}
                  onClick={() => setStep(item)}
                  type="button"
                >
                  <span>{complete ? <CheckCircle2 size={15} /> : item}</span>
                  <small>{item === 1 ? "Identity" : item === 2 ? "Details" : "Review"}</small>
                </button>
              );
            })}
          </div>

          {step === 1 ? (
            <section className="launch-step-panel" aria-labelledby="launch-step-identity">
              <div className="launch-form-section-head"><span>01</span><div><strong id="launch-step-identity">Token identity</strong><small>Name, ticker and artwork</small></div></div>
              <div className="launch-field-grid">
                <div className="field">
                  <label htmlFor="token-name">Name <small>{name.length}/40</small></label>
                  <input id="token-name" required maxLength={40} autoComplete="off" placeholder="Token name" value={name} onChange={(event) => setName(event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="token-symbol">Symbol <small>{symbol.length}/10</small></label>
                  <input id="token-symbol" required maxLength={10} autoComplete="off" placeholder="Ticker" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="token-image">Token image</label>
                <label className={imagePreview ? "upload-box has-preview" : "upload-box"} htmlFor="token-image">
                  {imagePreview ? <img src={imagePreview} alt="Token preview" /> : <span><ImagePlus size={22} />Select logo or meme image</span>}
                  <input accept="image/*" id="token-image" required onChange={(event) => selectImage(event.target.files?.[0])} type="file" />
                </label>
                <span className="field-help">{isImageUploading ? "Uploading image…" : imageUri ? "Image ready." : "Square image · max 5 MB · stored on IPFS"}</span>
              </div>
              <div className="launch-step-actions single">
                <button className="button primary" disabled={!identityReady} onClick={() => setStep(2)} type="button">Continue <ChevronRight size={16} /></button>
              </div>
            </section>
          ) : null}

          {step === 2 ? (
            <section className="launch-step-panel" aria-labelledby="launch-step-details">
              <div className="launch-form-section-head"><span>02</span><div><strong id="launch-step-details">Story & community</strong><small>Optional, but helps traders understand the launch</small></div></div>
              <div className="project-details-card">
                <div className="project-details-head"><strong>Project details</strong><span>Shown on the market page</span></div>
                <div className="field">
                  <label htmlFor="token-description">Description</label>
                  <textarea id="token-description" maxLength={500} placeholder="What is this token about?" value={description} onChange={(event) => setDescription(event.target.value)} />
                </div>
                <details className="social-details">
                  <summary>Add community links <span>Optional</span></summary>
                  <div className="social-input-grid">
                    <div className="field"><label htmlFor="token-website">Website</label><input id="token-website" inputMode="url" placeholder="funblue.xyz" value={website} onChange={(event) => setWebsite(event.target.value)} /></div>
                    <div className="field"><label htmlFor="token-x">X</label><input id="token-x" inputMode="url" placeholder="x.com/project" value={twitter} onChange={(event) => setTwitter(event.target.value)} /></div>
                    <div className="field"><label htmlFor="token-telegram">Telegram</label><input id="token-telegram" inputMode="url" placeholder="t.me/project" value={telegram} onChange={(event) => setTelegram(event.target.value)} /></div>
                    <div className="field"><label htmlFor="token-discord">Discord</label><input id="token-discord" inputMode="url" placeholder="discord.gg/project" value={discord} onChange={(event) => setDiscord(event.target.value)} /></div>
                  </div>
                </details>
              </div>
              <div className="launch-step-actions"><button className="button" onClick={() => setStep(1)} type="button"><ChevronLeft size={16} />Back</button><button className="button primary" disabled={!identityReady} onClick={() => setStep(3)} type="button">{identityReady ? "Review launch" : "Complete identity first"} <ChevronRight size={16} /></button></div>
            </section>
          ) : null}

          {step === 3 ? (
            <section className="launch-step-panel" aria-labelledby="launch-step-review">
              <div className="launch-form-section-head"><span>03</span><div><strong id="launch-step-review">Review & launch</strong><small>Confirm the transaction details</small></div></div>
              <div className="field"><label htmlFor="initial-buy">Optional first buy</label><input aria-describedby="initial-buy-help" id="initial-buy" inputMode="decimal" placeholder="0" value={initialBuy} onChange={(event) => setInitialBuy(sanitizeDecimal(event.target.value))} /><span className="field-help" id="initial-buy-help">ETH · maximum {FAIR_GRADUATION_TARGET_ETH}</span></div>
              <div className="launch-review-card">
                <div className="launch-review-head"><strong>{name} <span>${symbol}</span></strong><span><NetworkIcon chainId={activeChainId} size={16} />{chain.name}</span></div>
                <dl>
                  <div><dt>Token standard</dt><dd>{isRobinhood ? "ERC-20" : "B20"}</dd></div>
                  <div><dt>Supply / creator allocation</dt><dd>1B / 0%</dd></div>
                  <div><dt>Trading fee</dt><dd>1% total</dd></div>
                  <div><dt>Graduation</dt><dd>{FAIR_GRADUATION_TARGET_ETH} ETH → Uniswap v4</dd></div>
                  <div><dt>Launch fee</dt><dd>{FAIR_LAUNCH_FEE_ETH} ETH</dd></div>
                  <div><dt>Initial buy</dt><dd>{formatEth(initialBuyEth)} ETH</dd></div>
                </dl>
                <div className="launch-review-total"><span>Total wallet confirmation</span><strong>{formatEth(totalLaunchValue)} ETH</strong></div>
              </div>
              {initialBuyTooLarge ? <p className="danger-text">Creator initial buy is capped at the {FAIR_GRADUATION_TARGET_ETH} ETH graduation target.</p> : null}
              <div className="launch-step-actions"><button className="button" disabled={isWorking} onClick={() => setStep(2)} type="button"><ChevronLeft size={16} />Back</button><button className="button primary launch-submit" disabled={disabled || isWorking || !isConnected} onClick={submit}>{isWorking ? <Loader2 className="spin" size={16} /> : metadataUri ? <Rocket size={16} /> : <UploadCloud size={16} />}{isImageUploading || isMetadataUploading ? "Preparing launch" : isPending ? "Confirm in wallet" : receipt.isLoading ? "Launching" : isRobinhood ? "Launch ERC-20" : "Launch B20"}</button></div>
              {launchStatus ? <LaunchNotice tone={launchStatus.tone}>{launchStatus.message}</LaunchNotice> : null}
              {receipt.isSuccess && confirmedLaunchId ? <Link className="button wide launch-live-link" href={`/launch/${confirmedLaunchId}?chain=${chainSlug(activeChainId)}`}>Open live market <ChevronRight size={16} /></Link> : null}
            </section>
          ) : null}
          {receipt.isSuccess ? (
            <LaunchChecklist
              activeChainId={activeChainId}
              hasInitialBuy={initialBuyEth > 0n}
              launchId={confirmedLaunchId}
              metadataReady={Boolean(metadataUri)}
              token={confirmedToken}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function LaunchChecklist({
  activeChainId,
  hasInitialBuy,
  launchId,
  metadataReady,
  token
}: {
  activeChainId: number;
  hasInitialBuy: boolean;
  launchId: string;
  metadataReady: boolean;
  token: string;
}) {
  const { chain } = contractsForChain(activeChainId);
  const marketHref = launchId ? `/launch/${launchId}?chain=${chainSlug(activeChainId)}` : "";
  const basescanHref = token ? `${chain.blockExplorers.default.url}/token/${token}` : "";
  const items = [
    { label: "Token deployed", done: Boolean(token) },
    { label: "Initial buy processed", done: hasInitialBuy || Boolean(launchId) },
    { label: "Metadata pinned", done: metadataReady },
    { label: "Launch event confirmed", done: Boolean(launchId) },
    { label: "Trade page ready", done: Boolean(marketHref) }
  ];

  return (
    <section className="launch-checklist">
      <div className="launch-checklist-head">
        <strong>Launch verification</strong>
        {marketHref ? <Link href={marketHref}>Open market</Link> : null}
      </div>
      <div className="launch-checklist-grid">
        {items.map((item) => (
          <span className={item.done ? "done" : ""} key={item.label}>
            <CheckCircle2 size={15} />{item.label}
          </span>
        ))}
      </div>
      {basescanHref ? (
        <a className="button wide" href={basescanHref} target="_blank" rel="noreferrer">
          View on {chain.name === "Base" ? "BaseScan" : "Robinhood Explorer"}
        </a>
      ) : null}
    </section>
  );
}

function LaunchNotice({ children, tone }: { children: React.ReactNode; tone: "info" | "success" | "danger" }) {
  return (
    <p className={`launch-notice ${tone}`}>
      {tone === "success" ? <CheckCircle2 size={16} /> : tone === "info" ? <Info size={16} /> : null}
      <span>{children}</span>
    </p>
  );
}

function getLaunchStatus(input: {
  disabledReason: string;
  error?: string;
  hash: boolean;
  isImageUploading: boolean;
  isMetadataUploading: boolean;
  isPending: boolean;
  isReceiptLoading: boolean;
  isSuccess: boolean;
  metadataReady: boolean;
  uploadError: string;
}): { tone: "info" | "success" | "danger"; message: string } | null {
  if (input.uploadError) return { tone: "danger", message: input.uploadError };
  if (input.error) return { tone: "danger", message: friendlyWalletError(input.error) };
  if (input.isSuccess) return { tone: "success", message: "Launch confirmed and market is live." };
  if (input.hash || input.isReceiptLoading) return { tone: "info", message: "Transaction submitted. Waiting for confirmation…" };
  if (input.isPending) return { tone: "info", message: "Confirm the launch transaction in your wallet." };
  if (input.isImageUploading) return { tone: "info", message: "Uploading token artwork to IPFS…" };
  if (input.isMetadataUploading) return { tone: "info", message: "Preparing launch metadata…" };
  if (input.metadataReady) return { tone: "success", message: "Launch media is ready for wallet confirmation." };
  if (input.disabledReason) return { tone: "info", message: input.disabledReason };
  return null;
}

function getDisabledReason(input: {
  hasFactory: boolean;
  hasName: boolean;
  hasSymbol: boolean;
  hasImage: boolean;
  imageReady: boolean;
  imageUploading: boolean;
  initialBuyTooLarge: boolean;
  isConnected: boolean;
}) {
  if (!input.isConnected) return "Connect your wallet to launch.";
  if (!input.hasFactory) return "Launch factory address is missing.";
  if (!input.hasName) return "Enter a token name.";
  if (!input.hasSymbol) return "Enter a token symbol.";
  if (!input.hasImage) return "Select a token image.";
  if (input.imageUploading) return "Preparing your image.";
  if (!input.imageReady) return "Image is being prepared.";
  if (input.initialBuyTooLarge) return "Creator initial buy must be 5 ETH or less.";
  return "";
}

function parsePositiveEther(value: string) {
  try {
    const parsed = parseEther(value || "0");
    return parsed > 0n ? parsed : 0n;
  } catch {
    return 0n;
  }
}

function sanitizeDecimal(value: string) {
  const clean = value.replace(",", ".").replace(/[^0-9.]/g, "");
  const [whole, ...fraction] = clean.split(".");
  return fraction.length ? `${whole}.${fraction.join("").slice(0, 18)}` : whole;
}

function formatEth(value: bigint) {
  const [whole, fraction = ""] = formatEther(value).split(".");
  const trimmed = fraction.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

async function uploadImage(file: File) {
  const form = new FormData();
  form.append("image", file);

  const response = await fetch("/api/pinata/image", {
    method: "POST",
    body: form
  });
  const result = (await response.json()) as { imageUri?: string; error?: string };
  if (!response.ok || !result.imageUri) {
    throw new Error(result.error || "Image could not be uploaded. Please try again.");
  }
  return result.imageUri;
}

async function uploadMetadata(
  name: string,
  symbol: string,
  imageUri: string,
  chainId: number,
  details?: { description: string; website: string; twitter: string; telegram: string; discord: string }
) {
  const form = new FormData();
  form.append("imageUri", imageUri);
  form.append("name", name);
  form.append("symbol", symbol);
  form.append("chainId", String(chainId));
  form.append("description", details?.description || "");
  form.append("website", details?.website || "");
  form.append("twitter", details?.twitter || "");
  form.append("telegram", details?.telegram || "");
  form.append("discord", details?.discord || "");

  const response = await fetch("/api/pinata/metadata", {
    method: "POST",
    body: form
  });
  const result = (await response.json()) as { metadataUri?: string; error?: string };
  if (!response.ok || !result.metadataUri) {
    throw new Error(result.error || "Launch media could not be prepared.");
  }
  return result.metadataUri;
}

function friendlyWalletError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("rejected") || lower.includes("denied")) {
    return "Request cancelled in wallet.";
  }
  return "Launch could not be completed. Please check your wallet and try again.";
}
