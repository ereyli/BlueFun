"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { decodeEventLog, parseEther, keccak256, toBytes } from "viem";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { BadgeCheck, CheckCircle2, ImagePlus, Info, Loader2, LockKeyhole, Rocket, ShieldCheck, UploadCloud } from "lucide-react";
import { addresses, FAIR_GRADUATION_TARGET_ETH, launchFactoryAbi } from "@/lib/contracts";
import { WalletButton } from "@/components/wallet-button";

export default function LaunchPage() {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [imageFile, setImageFile] = useState<File | undefined>();
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
  const { isConnected } = useAccount();
  const { data: hash, error, writeContract, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });

  const salt = useMemo(() => keccak256(toBytes(`${name}:${symbol}:${Date.now()}`)), [name, symbol]);
  const initialBuyEth = parsePositiveEther(initialBuy);
  const initialBuyTooLarge = initialBuyEth > parseEther("1");
  const metadataKey = imageUri
    ? `${name.trim()}:${symbol.trim()}:${imageUri}:${description.trim()}:${website.trim()}:${twitter.trim()}:${telegram.trim()}:${discord.trim()}`
    : "";
  const disabled = !addresses.launchFactory || !name.trim() || !symbol.trim() || !imageUri || !metadataUri || initialBuyTooLarge;
  const disabledReason = getDisabledReason({
    hasFactory: Boolean(addresses.launchFactory),
    hasName: Boolean(name.trim()),
    hasSymbol: Boolean(symbol.trim()),
    hasImage: Boolean(imagePreview),
    imageReady: Boolean(imageUri),
    metadataReady: Boolean(metadataUri),
    imageUploading: isImageUploading,
    metadataUploading: isMetadataUploading,
    initialBuyTooLarge,
    isConnected
  });
  const isWorking = isImageUploading || isMetadataUploading || isPending || receipt.isLoading;

  useEffect(() => {
    if (!name.trim() || !symbol.trim() || !imageUri || metadataUploadKey === metadataKey) return;
    const timeout = window.setTimeout(() => {
      prepareMetadata(name.trim(), symbol.trim(), imageUri, metadataKey);
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [name, symbol, imageUri, metadataKey, metadataUploadKey]);

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
        launchMetadataUri = await uploadMetadata(name.trim(), symbol.trim(), imageUri, getProjectDetails());
        setMetadataUri(launchMetadataUri);
        setMetadataUploadKey(metadataKey);
      } catch (metadataError) {
        setUploadError(metadataError instanceof Error ? metadataError.message : "Launch media could not be prepared.");
        return;
      }
    }

    writeContract({
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
      value: initialBuyEth
    });
  }

  async function selectImage(file?: File) {
    setUploadError("");
    setImageUri("");
    setMetadataUri("");
    setMetadataUploadKey("");
    setImageFile(file);
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

  async function prepareMetadata(tokenName: string, tokenSymbol: string, uploadedImageUri: string, nextMetadataKey: string) {
    try {
      setIsMetadataUploading(true);
      setUploadError("");
      const preparedMetadataUri = await uploadMetadata(tokenName, tokenSymbol, uploadedImageUri, getProjectDetails());
      setMetadataUri(preparedMetadataUri);
      setMetadataUploadKey(nextMetadataKey);
    } catch (metadataError) {
      setUploadError(metadataError instanceof Error ? metadataError.message : "Launch media could not be prepared.");
    } finally {
      setIsMetadataUploading(false);
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
              <h2>{name.trim() || "Your B20 token"}</h2>
              <p className="muted">${symbol.trim() || "SYMBOL"} · creator first buy {initialBuy || "0"} ETH</p>
            </div>
            <div className="launch-preview-stat">
              <span>Target</span>
              <strong>{FAIR_GRADUATION_TARGET_ETH} ETH</strong>
            </div>
          </div>
        </div>
        <section className="launch-feature-grid">
          <div><ShieldCheck /><strong>Safe defaults</strong></div>
          <div><LockKeyhole /><strong>LP lock flow</strong></div>
          <div><BadgeCheck /><strong>Role transparency</strong></div>
        </section>
      </section>
      <section className="launch-form-card">
        <div className="launch-form-header">
          <span className="pill">Launch setup</span>
          <h2>Create token</h2>
        </div>
        <div className="form">
          {!isConnected ? (
            <div className="notice">
              <strong>Connect wallet to launch</strong>
              <span>Transactions are sent on Base Sepolia and require a connected wallet.</span>
              <WalletButton />
            </div>
          ) : null}
          <div className="field">
            <label>Name</label>
            <input placeholder="Token name" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="field">
            <label>Symbol</label>
            <input placeholder="Ticker" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} />
          </div>
          <div className="project-details-card">
            <div className="project-details-head">
              <strong>Project details</strong>
              <span>Shown on the market page</span>
            </div>
            <div className="field">
              <label>Description</label>
              <textarea
                maxLength={500}
                placeholder="What is this token about?"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="social-input-grid">
              <div className="field">
                <label>Website</label>
                <input placeholder="funblue.xyz" value={website} onChange={(event) => setWebsite(event.target.value)} />
              </div>
              <div className="field">
                <label>X</label>
                <input placeholder="x.com/project" value={twitter} onChange={(event) => setTwitter(event.target.value)} />
              </div>
              <div className="field">
                <label>Telegram</label>
                <input placeholder="t.me/project" value={telegram} onChange={(event) => setTelegram(event.target.value)} />
              </div>
              <div className="field">
                <label>Discord</label>
                <input placeholder="discord.gg/project" value={discord} onChange={(event) => setDiscord(event.target.value)} />
              </div>
            </div>
          </div>
          <div className="field">
            <label>Token image</label>
            <label className={imagePreview ? "upload-box has-preview" : "upload-box"}>
              {imagePreview ? (
                <img src={imagePreview} alt="Token preview" />
              ) : (
                <span>
                  <ImagePlus size={22} />
                  Select logo or meme image
                </span>
              )}
              <input
                accept="image/*"
                onChange={(event) => selectImage(event.target.files?.[0])}
                type="file"
              />
            </label>
            <span className="field-help">
              {isImageUploading ? "Uploading image..." : imageUri ? "Image ready." : "Uploaded to Pinata automatically. Max 5 MB."}
            </span>
          </div>
          <div className="field">
            <label>Creator initial buy ETH</label>
            <input placeholder="0" value={initialBuy} onChange={(event) => setInitialBuy(event.target.value)} />
          </div>
          <div className="fixed-rule">
            <strong>Bonding target is fixed</strong>
            <span>{FAIR_GRADUATION_TARGET_ETH} ETH graduation, then DEX LP lock.</span>
          </div>
          {initialBuyTooLarge ? <p className="danger-text">Creator initial buy is capped at the 5 ETH graduation target.</p> : null}
          <button className="button primary" disabled={disabled || isWorking || !isConnected} onClick={submit}>
            {isWorking ? <Loader2 className="spin" size={16} /> : metadataUri ? <Rocket size={16} /> : <UploadCloud size={16} />}
            {isImageUploading || isMetadataUploading ? "Preparing launch" : isPending ? "Confirm in wallet" : receipt.isLoading ? "Launching" : "Launch B20"}
          </button>
          <div className="launch-status-stack">
            {disabledReason ? <LaunchNotice tone="info">{disabledReason}</LaunchNotice> : null}
            {metadataUri && !receipt.isSuccess ? <LaunchNotice tone="success">Media is ready. You can launch whenever you are set.</LaunchNotice> : null}
            {hash && !receipt.isSuccess ? <LaunchNotice tone="info">Launch submitted. Waiting for confirmation.</LaunchNotice> : null}
            {receipt.isSuccess ? (
              <LaunchNotice tone="success">
                {confirmedLaunchId ? (
                  <>
                    Launch is live. Opening market page.{" "}
                    <Link href={`/launch/${confirmedLaunchId}`}>View now</Link>
                  </>
                ) : (
                  "Launch is live. Opening market page."
                )}
              </LaunchNotice>
            ) : null}
            {uploadError ? <LaunchNotice tone="danger">{uploadError}</LaunchNotice> : null}
            {error ? <LaunchNotice tone="danger">{friendlyWalletError(error.message)}</LaunchNotice> : null}
            {!addresses.launchFactory ? <LaunchNotice tone="danger">Launch creation is temporarily unavailable.</LaunchNotice> : null}
          </div>
          {receipt.isSuccess ? (
            <LaunchChecklist
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
  hasInitialBuy,
  launchId,
  metadataReady,
  token
}: {
  hasInitialBuy: boolean;
  launchId: string;
  metadataReady: boolean;
  token: string;
}) {
  const marketHref = launchId ? `/launch/${launchId}` : "";
  const basescanHref = token ? `https://sepolia.basescan.org/token/${token}` : "";
  const items = [
    { label: "Token deployed", done: Boolean(token) },
    { label: "Initial buy processed", done: hasInitialBuy || Boolean(launchId) },
    { label: "Metadata pinned", done: metadataReady },
    { label: "Market indexed", done: Boolean(launchId) },
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
          View on BaseScan
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

function getDisabledReason(input: {
  hasFactory: boolean;
  hasName: boolean;
  hasSymbol: boolean;
  hasImage: boolean;
  imageReady: boolean;
  metadataReady: boolean;
  imageUploading: boolean;
  metadataUploading: boolean;
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
  if (input.metadataUploading) return "Preparing launch media.";
  if (!input.metadataReady) return "Launch media is being prepared.";
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
  details?: { description: string; website: string; twitter: string; telegram: string; discord: string }
) {
  const form = new FormData();
  form.append("imageUri", imageUri);
  form.append("name", name);
  form.append("symbol", symbol);
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
