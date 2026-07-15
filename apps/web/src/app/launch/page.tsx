"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { decodeEventLog, formatEther, parseEther, keccak256, toBytes } from "viem";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Coins, Copy, ExternalLink, ImagePlus, Info, LayoutDashboard, Loader2, LockKeyhole, Rocket, TimerReset, UploadCloud, X, Zap } from "lucide-react";
import { contractsForChain, DIRECT_LAUNCH_FEE_FALLBACK_ETH, directLaunchFactoryAbi, FAIR_GRADUATION_TARGET_ETH, FAIR_LAUNCH_FEE_ETH, launchFactoryAbi } from "@/lib/contracts";
import { useSearchParams } from "next/navigation";
import { NetworkIcon } from "@/components/network-icon";
import { chainIdFromParam } from "@/lib/chain-slug";
import { tokenPath } from "@/lib/token-url";

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
  const [launchMode, setLaunchMode] = useState<"bond" | "direct">("bond");
  const [confirmedLaunchId, setConfirmedLaunchId] = useState("");
  const [confirmedToken, setConfirmedToken] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const { isConnected, chainId } = useAccount();
  const requestedChain = useSearchParams().get("chain");
  const activeChainId = requestedChain ? chainIdFromParam(requestedChain) : chainId === 4663 ? 4663 : 8453;
  const { addresses, chain } = contractsForChain(activeChainId);
  const isRobinhood = chain.id === 4663;
  const selectedFactory = launchMode === "direct" ? addresses.directLaunchFactory : addresses.launchFactory;
  const { data: hash, error, writeContract, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const directLaunchFee = useReadContract({
    chainId: activeChainId,
    address: addresses.directLaunchFactory,
    abi: directLaunchFactoryAbi,
    functionName: "launchFee",
    query: { enabled: launchMode === "direct" && Boolean(addresses.directLaunchFactory) }
  });
  const directLaunchConfig = useReadContract({
    chainId: activeChainId,
    address: addresses.directLaunchFactory,
    abi: directLaunchFactoryAbi,
    functionName: "launchConfig",
    query: { enabled: launchMode === "direct" && Boolean(addresses.directLaunchFactory) }
  });
  const directLaunchConfigHash = useReadContract({
    chainId: activeChainId,
    address: addresses.directLaunchFactory,
    abi: directLaunchFactoryAbi,
    functionName: "launchConfigHash",
    query: { enabled: launchMode === "direct" && Boolean(addresses.directLaunchFactory) }
  });
  const directPoolFee = Number(directLaunchConfig.data?.[0] ?? 10_000);
  const directPlatformShare = Number(directLaunchConfig.data?.[5] ?? 7_000);
  const directCreatorShare = Number(directLaunchConfig.data?.[6] ?? 3_000);
  const directConfigReady = launchMode !== "direct" || Boolean(directLaunchConfigHash.data);

  const salt = useMemo(() => keccak256(toBytes(`${name}:${symbol}:${Date.now()}`)), [name, symbol]);
  const initialBuyEth = parsePositiveEther(initialBuy);
  const initialBuyTooLarge = launchMode === "bond" && initialBuyEth > parseEther(FAIR_GRADUATION_TARGET_ETH);
  const metadataKey = imageUri
    ? `${name.trim()}:${symbol.trim()}:${imageUri}:${description.trim()}:${website.trim()}:${twitter.trim()}:${telegram.trim()}:${discord.trim()}`
    : "";
  const disabled = !selectedFactory || !name.trim() || !symbol.trim() || !imageUri || initialBuyTooLarge || !directConfigReady;
  const disabledReason = getDisabledReason({
    hasFactory: Boolean(selectedFactory),
    hasName: Boolean(name.trim()),
    hasSymbol: Boolean(symbol.trim()),
    hasImage: Boolean(imagePreview),
    imageReady: Boolean(imageUri),
    imageUploading: isImageUploading,
    initialBuyTooLarge,
    isConnected
  });
  const isWorking = isImageUploading || isMetadataUploading || isPending || receipt.isLoading;
  const launchFeeEth = launchMode === "direct"
    ? directLaunchFee.data ?? parseEther(DIRECT_LAUNCH_FEE_FALLBACK_ETH)
    : parseEther(FAIR_LAUNCH_FEE_ETH);
  const totalLaunchValue = launchFeeEth + (launchMode === "bond" ? initialBuyEth : 0n);
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
  const confirmedMarketHref = confirmedToken
    ? tokenPath({ chainId: activeChainId, name, symbol, token: confirmedToken })
    : "";

  useEffect(() => {
    if (receipt.isSuccess) setShowSuccess(true);
  }, [receipt.isSuccess]);

  useEffect(() => {
    if (!receipt.isSuccess || !receipt.data?.logs.length || confirmedLaunchId) return;

    for (const log of receipt.data.logs) {
      try {
        const decoded = decodeEventLog({
          abi: launchMode === "direct" ? directLaunchFactoryAbi : launchFactoryAbi,
          data: log.data,
          topics: log.topics
        });
        if (decoded.eventName === "LaunchCreated" || decoded.eventName === "DirectLaunchCreated") {
          const launchId = decoded.args.launchId.toString();
          setConfirmedLaunchId(launchId);
          setConfirmedToken(decoded.args.token);
          return;
        }
      } catch {
        // Ignore unrelated logs.
      }
    }
  }, [receipt.isSuccess, receipt.data?.logs, confirmedLaunchId, launchMode]);

  async function submit() {
    if (!selectedFactory || disabled || !isConnected) return;
    setUploadError("");
    setShowSuccess(false);

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

    const metadata = { name: name.trim(), symbol: symbol.trim(), contractURI: launchMetadataUri, salt };
    if (launchMode === "direct") {
      if (!directLaunchConfigHash.data) return;
      writeContract({
        chainId: activeChainId,
        address: selectedFactory,
        abi: directLaunchFactoryAbi,
        functionName: "createLaunch",
        args: [metadata, directLaunchConfigHash.data, BigInt(Math.floor(Date.now() / 1000) + 20 * 60)],
        value: launchFeeEth
      });
      return;
    }
    writeContract({
      chainId: activeChainId,
      address: selectedFactory,
      abi: launchFactoryAbi,
      functionName: "createLaunch",
      args: [
        metadata,
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
          <div className="launch-signal-kicker"><i />BlueFun launch studio <span>Live</span></div>
          <div className="launch-network-chip"><NetworkIcon chainId={activeChainId} size={22} /><span>Launching on <strong>{chain.name}</strong></span></div>
          <h1>Create a fair launch.</h1>
          <p className="muted">
            {launchMode === "direct"
              ? "Create the token and its permanently locked Uniswap v4 market in one transaction."
              : "Add metadata, choose an optional first buy, and publish directly to the bonding curve."}
          </p>
          <div className="launch-preview-card">
            <div className="launch-preview-art">
              {imagePreview ? <img src={imagePreview} alt="Token preview" /> : <Rocket size={36} />}
            </div>
            <div>
              <span className="muted">Preview</span>
              <h2>{name.trim() || (isRobinhood ? "Your ERC-20 token" : "Your B20 token")}</h2>
              <p className="muted">${symbol.trim() || "SYMBOL"} · {launchMode === "direct" ? "DEX live immediately" : `first buy ${initialBuy || "0"} ETH`} · fee {formatEth(launchFeeEth)} ETH</p>
            </div>
            <div className="launch-preview-stat">
              <span>{launchMode === "direct" ? "Route" : "Target"}</span>
              <strong>{launchMode === "direct" ? "Uniswap v4" : `${FAIR_GRADUATION_TARGET_ETH} ETH`}</strong>
            </div>
          </div>
        </div>
        <section className="launch-feature-grid">
          <div><Coins /><span><strong>1B fixed supply</strong><small>0% creator allocation</small></span></div>
          <div>{launchMode === "direct" ? <Zap /> : <TimerReset />}<span><strong>{launchMode === "direct" ? "Instant DEX market" : "60s launch guard"}</strong><small>{launchMode === "direct" ? "No bond threshold" : "Fair early access"}</small></span></div>
          <div><LockKeyhole /><span><strong>Liquidity locked</strong><small>{launchMode === "direct" ? "Forever from creation" : "After graduation"}</small></span></div>
        </section>
      </section>
      <section className="launch-form-card">
        <div className="launch-form-header">
          <div>
            <span className="pill">Launch setup</span>
            <h2>Create token</h2>
          </div>
          <span className="launch-form-network"><NetworkIcon chainId={activeChainId} size={14} />{chain.name}</span>
        </div>
        <div className="form">
          {!isConnected ? (
            <div className="launch-wallet-gate">
              <span className="wallet-status-dot" />
              <div><strong>Connect wallet to launch</strong><small>Use the wallet button in the header. Transactions will be sent on {chain.name}.</small></div>
            </div>
          ) : null}
          <div className="launch-mode-picker" role="radiogroup" aria-label="Launch route">
            <button aria-checked={launchMode === "bond"} className={launchMode === "bond" ? "active" : ""} disabled={isWorking} onClick={() => setLaunchMode("bond")} role="radio" type="button">
              <TimerReset size={19} /><span><strong>Bond launch</strong><small>Trade on the fair curve, then graduate at {FAIR_GRADUATION_TARGET_ETH} ETH.</small></span>{launchMode === "bond" ? <CheckCircle2 size={17} /> : null}
            </button>
            <button aria-checked={launchMode === "direct"} className={launchMode === "direct" ? "active" : ""} disabled={isWorking} onClick={() => setLaunchMode("direct")} role="radio" type="button">
              <Zap size={19} /><span><strong>Direct DEX launch</strong><small>Token-only v4 curve, permanent LP lock, {formatPercent(directPoolFee, 1_000_000)} swap fee.</small></span>{launchMode === "direct" ? <CheckCircle2 size={17} /> : null}
            </button>
          </div>
          {launchMode === "direct" && !addresses.directLaunchFactory ? <LaunchNotice tone="info">Direct DEX contracts are ready in the codebase but are not configured for {chain.name} yet.</LaunchNotice> : null}
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
              {launchMode === "bond" ? <div className="field"><label htmlFor="initial-buy">Optional first buy</label><input aria-describedby="initial-buy-help" id="initial-buy" inputMode="decimal" placeholder="0" value={initialBuy} onChange={(event) => setInitialBuy(sanitizeDecimal(event.target.value))} /><span className="field-help" id="initial-buy-help">ETH · maximum {FAIR_GRADUATION_TARGET_ETH}</span></div> : <LaunchNotice tone="info">The pool starts with token-only liquidity. The first buys add ETH depth; very early sells may have no quote until buy-side liquidity exists.</LaunchNotice>}
              <div className="launch-review-card">
                <div className="launch-review-head"><strong>{name} <span>${symbol}</span></strong><span><NetworkIcon chainId={activeChainId} size={16} />{chain.name}</span></div>
                <dl>
                  <div><dt>Token standard</dt><dd>{isRobinhood ? "ERC-20" : "B20"}</dd></div>
                  <div><dt>Supply / creator allocation</dt><dd>1B / 0%</dd></div>
                  <div><dt>Trading fee</dt><dd>{launchMode === "direct" ? `${formatPercent(directPoolFee, 1_000_000)} total · ${formatPercent(directPlatformShare, 10_000)} platform / ${formatPercent(directCreatorShare, 10_000)} creator` : "1% total · 70% platform / 30% creator"}</dd></div>
                  <div><dt>Launch route</dt><dd>{launchMode === "direct" ? "Immediate locked Uniswap v4 pool" : `${FAIR_GRADUATION_TARGET_ETH} ETH bond → Uniswap v4`}</dd></div>
                  <div><dt>Launch fee</dt><dd>{formatEth(launchFeeEth)} ETH</dd></div>
                  {launchMode === "bond" ? <div><dt>Initial buy</dt><dd>{formatEth(initialBuyEth)} ETH</dd></div> : null}
                </dl>
                <div className="launch-review-total"><span>Total wallet confirmation</span><strong>{formatEth(totalLaunchValue)} ETH</strong></div>
              </div>
              {initialBuyTooLarge ? <p className="danger-text">Creator initial buy is capped at the {FAIR_GRADUATION_TARGET_ETH} ETH graduation target.</p> : null}
              <div className="launch-step-actions"><button className="button" disabled={isWorking} onClick={() => setStep(2)} type="button"><ChevronLeft size={16} />Back</button><button className="button primary launch-submit" disabled={disabled || isWorking || !isConnected} onClick={submit}>{isWorking ? <Loader2 className="spin" size={16} /> : metadataUri ? <Rocket size={16} /> : <UploadCloud size={16} />}{isImageUploading || isMetadataUploading ? "Preparing launch" : isPending ? "Confirm in wallet" : receipt.isLoading ? "Launching" : launchMode === "direct" ? "Launch direct to DEX" : isRobinhood ? "Launch ERC-20" : "Launch B20"}</button></div>
              {launchStatus && !receipt.isSuccess ? <LaunchNotice tone={launchStatus.tone}>{launchStatus.message}</LaunchNotice> : null}
              {receipt.isSuccess ? <button className="button wide launch-live-link" onClick={() => setShowSuccess(true)} type="button"><CheckCircle2 size={16} />View launch result</button> : null}
            </section>
          ) : null}
        </div>
      </section>
      {receipt.isSuccess && showSuccess ? (
        <LaunchSuccessModal
          activeChainId={activeChainId}
          hasInitialBuy={launchMode === "bond" && initialBuyEth > 0n}
          imagePreview={imagePreview}
          launchId={confirmedLaunchId}
          launchMode={launchMode}
          marketHref={confirmedMarketHref}
          metadataReady={Boolean(metadataUri)}
          name={name}
          onClose={() => setShowSuccess(false)}
          symbol={symbol}
          token={confirmedToken}
          transactionHash={hash || ""}
        />
      ) : null}
    </div>
  );
}

function LaunchSuccessModal({
  activeChainId,
  hasInitialBuy,
  imagePreview,
  launchId,
  launchMode,
  marketHref,
  metadataReady,
  name,
  onClose,
  symbol,
  token,
  transactionHash
}: {
  activeChainId: number;
  hasInitialBuy: boolean;
  imagePreview: string;
  launchId: string;
  launchMode: "bond" | "direct";
  marketHref: string;
  metadataReady: boolean;
  name: string;
  onClose: () => void;
  symbol: string;
  token: string;
  transactionHash: string;
}) {
  const { chain } = contractsForChain(activeChainId);
  const [copied, setCopied] = useState(false);
  const tokenExplorerHref = token ? `${chain.blockExplorers.default.url}/token/${token}` : "";
  const transactionHref = transactionHash ? `${chain.blockExplorers.default.url}/tx/${transactionHash}` : "";
  const items = [
    { label: "Token deployed", done: Boolean(token) },
    { label: launchMode === "direct" ? "Uniswap v4 pool created" : "Bonding curve activated", done: Boolean(launchId) },
    { label: "Metadata pinned", done: metadataReady },
    { label: launchMode === "direct" ? "LP locked permanently" : hasInitialBuy ? "Initial buy processed" : "Market opened fairly", done: Boolean(launchId) }
  ];

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  async function copyToken() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="launch-success-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section aria-labelledby="launch-success-title" aria-modal="true" className="launch-success-modal" role="dialog">
        <button aria-label="Close launch result" className="launch-success-close" onClick={onClose} type="button"><X size={18} /></button>
        <header className="launch-success-hero">
          <div className="launch-success-mark"><Check size={29} /></div>
          <span>Launch confirmed</span>
          <h2 id="launch-success-title">Your market is live.</h2>
          <p>{launchMode === "direct" ? "The token, locked Uniswap v4 pool and creator fee share are now active." : "The token and bonding curve are active. Trading can begin immediately."}</p>
        </header>

        <div className="launch-success-token">
          <div className="launch-success-art">{imagePreview ? <img alt="" src={imagePreview} /> : <Rocket size={25} />}</div>
          <div><strong>{name}</strong><span>${symbol} · Launch #{launchId || "confirmed"}</span></div>
          <div className="launch-success-network"><NetworkIcon chainId={activeChainId} size={20} />{chain.name}</div>
        </div>

        <div className="launch-success-address">
          <span>Token contract</span>
          <div><code>{token || "Confirming token address…"}</code>{token ? <button aria-label="Copy token address" onClick={() => void copyToken()} type="button">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy"}</button> : null}</div>
        </div>

        <div className="launch-success-checks">
          {items.map((item) => <span className={item.done ? "done" : ""} key={item.label}><CheckCircle2 size={15} />{item.label}</span>)}
        </div>

        <div className="launch-success-actions">
          {marketHref ? <Link className="button primary" href={marketHref}>Open live market <ChevronRight size={16} /></Link> : <button className="button primary" disabled type="button"><Loader2 className="spin" size={16} />Preparing market link</button>}
          <Link className="button" href="/dashboard"><LayoutDashboard size={15} />Creator dashboard</Link>
        </div>
        <footer className="launch-success-links">
          {transactionHref ? <a href={transactionHref} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a> : null}
          {tokenExplorerHref ? <a href={tokenExplorerHref} target="_blank" rel="noreferrer">View token on explorer <ExternalLink size={12} /></a> : null}
          <span>Indexing may take a few seconds.</span>
        </footer>
      </section>
    </div>
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

function formatPercent(value: number, denominator: number) {
  return `${Number(((value * 100) / denominator).toFixed(3))}%`;
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
