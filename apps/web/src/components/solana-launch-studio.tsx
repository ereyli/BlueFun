"use client";

import { useMemo, useRef, useState } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import type { WalletAdapter } from "@solana/wallet-adapter-base";
import { CheckCircle2, ExternalLink, ImagePlus, Loader2, Rocket } from "@/components/bluefun-icons";
import { DexProviderIcon } from "@/components/dex-provider-icon";
import { NetworkIcon } from "@/components/network-icon";
import {
  SOLANA_LAUNCH_FEE,
  launchSolanaDirect,
  type SolanaDirectLaunchResult,
  type SolanaLaunchProgress
} from "@/lib/solana/direct-launch";

type Step = 1 | 2 | 3;

export function SolanaLaunchStudio() {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const solanaWallet = useWallet();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");
  const [initialBuy, setInitialBuy] = useState("0");
  const [imagePreview, setImagePreview] = useState("");
  const [imageUri, setImageUri] = useState("");
  const [isImageUploading, setIsImageUploading] = useState(false);
  const imageUploadRequest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<SolanaLaunchProgress[]>([]);
  const [result, setResult] = useState<SolanaDirectLaunchResult>();

  const identityReady = Boolean(name.trim() && symbol.trim() && imageUri && !isImageUploading);
  const initialBuyLamports = useMemo(() => parseSolToLamports(initialBuy), [initialBuy]);
  const adapter = solanaWallet.wallet?.adapter as WalletAdapter | undefined;

  async function selectImage(file?: File) {
    const requestId = imageUploadRequest.current + 1;
    imageUploadRequest.current = requestId;
    setError("");
    setImageUri("");
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview("");
    if (!file) {
      setStatus("");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Use a square PNG, JPG or WEBP image up to 5 MB.");
      return;
    }
    const localPreview = URL.createObjectURL(file);
    setImagePreview(localPreview);
    setIsImageUploading(true);
    setStatus("Uploading artwork to IPFS…");
    try {
      const form = new FormData();
      form.append("image", file);
      const response = await fetch("/api/pinata/image", { method: "POST", body: form });
      const payload = await response.json() as { imageUri?: string; error?: string };
      if (!response.ok || !payload.imageUri) throw new Error(payload.error || "Image upload failed.");
      if (requestId !== imageUploadRequest.current) return;
      setImageUri(payload.imageUri);
      setStatus("Artwork ready.");
    } catch (uploadError) {
      if (requestId !== imageUploadRequest.current) return;
      setError(uploadError instanceof Error ? uploadError.message : "Image upload failed.");
      setImageUri("");
      setStatus("");
    } finally {
      if (requestId === imageUploadRequest.current) setIsImageUploading(false);
    }
  }

  async function submit() {
    if (!anchorWallet || !adapter || !identityReady || busy) return;
    setBusy(true);
    setError("");
    setResult(undefined);
    setProgress([]);
    try {
      setStatus("Preparing immutable token metadata…");
      const metadataUri = await uploadMetadata({
        name: name.trim(), symbol: symbol.trim(), imageUri, description, website, twitter, telegram, discord
      });
      const launched = await launchSolanaDirect({
        connection,
        endpoint: connection.rpcEndpoint,
        wallet: anchorWallet,
        walletAdapter: adapter,
        name: name.trim(),
        symbol: symbol.trim(),
        metadataUri,
        initialBuyLamports,
        onProgress: (item) => {
          setProgress((current) => [...current.filter((entry) => entry.key !== item.key), item]);
          setStatus(item.label);
        }
      });
      setResult(launched);
      setStatus("Token and permanently locked Meteora market are live.");
    } catch (launchError) {
      setError(friendlySolanaError(launchError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="launch-page solana-launch-page">
      <aside className="launch-intro">
        <section className="launch-hero-panel solana-launch-hero">
          <span className="launch-network-chip"><NetworkIcon chainId={101} size={22} /><strong>Solana</strong> · Direct only</span>
          <div><h1>Launch once.<br />Trade immediately.</h1><p className="muted">No bonding threshold. BlueFun creates the SPL token and its one-sided Meteora market, then locks every unit of liquidity permanently.</p></div>
          <div className="launch-preview-card">
            <div className="launch-preview-art">{imagePreview ? <img alt="Token preview" src={imagePreview} /> : <Rocket size={30} />}</div>
            <div><small>Launch manifest</small><h2>{name || "Your Solana token"}</h2><p>${symbol || "SYMBOL"} · SPL · Meteora DAMM v2</p></div>
            <div className="launch-preview-stat"><span>Supply</span><strong>1B</strong></div>
          </div>
        </section>
        <div className="launch-feature-grid">
          <div><DexProviderIcon provider="meteora" size={26} /><span><strong>Meteora</strong><small>Direct concentrated-liquidity market</small></span></div>
          <div><CheckCircle2 size={25} /><span><strong>Locked forever</strong><small>No creator or platform LP withdrawal</small></span></div>
          <div><span className="solana-fee-glyph">%</span><span><strong>1% total</strong><small>Protocol share included · remainder 70/30</small></span></div>
        </div>
      </aside>

      <section className="launch-form-card">
        <header className="launch-form-header"><div><span className="eyebrow">SOLANA DIRECT</span><h2>Create market</h2></div><DexProviderIcon provider="meteora" size={34} /></header>
        <div className="launch-stepper">
          {([1, 2, 3] as const).map((item) => <button className={step === item ? "active" : item < step ? "complete" : ""} disabled={item > 1 && !identityReady} key={item} onClick={() => setStep(item)} type="button"><span>{item < step ? <CheckCircle2 size={15} /> : item}</span><small>{item === 1 ? "Identity" : item === 2 ? "Details" : "Review"}</small></button>)}
        </div>

        {step === 1 ? <section className="launch-step-panel">
          <div className="launch-field-grid">
            <div className="field"><label htmlFor="sol-name">Name <small>{name.length}/40</small></label><input id="sol-name" maxLength={40} placeholder="Token name" value={name} onChange={(event) => setName(event.target.value)} /></div>
            <div className="field"><label htmlFor="sol-symbol">Symbol <small>{symbol.length}/10</small></label><input id="sol-symbol" maxLength={10} placeholder="Ticker" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} /></div>
          </div>
          <div className="field"><label htmlFor="sol-image">Token image</label><label className={imagePreview ? "upload-box has-preview" : "upload-box"} htmlFor="sol-image">{imagePreview ? <img alt="Token preview" src={imagePreview} /> : <span><ImagePlus size={22} />Select logo or meme image</span>}<input accept="image/png,image/jpeg,image/webp" disabled={isImageUploading} id="sol-image" onChange={(event) => void selectImage(event.target.files?.[0])} type="file" /></label><span className="field-help">{isImageUploading ? "Uploading image to IPFS…" : imageUri ? "Image ready on IPFS." : "Square image · PNG, JPG or WEBP · max 5 MB"}</span></div>
          {error ? <p className="launch-notice danger">{error}</p> : null}
          <button className="button primary wide" disabled={!identityReady || isImageUploading} onClick={() => setStep(2)} type="button">{isImageUploading ? <Loader2 className="spin" size={16} /> : null}{isImageUploading ? "Uploading image…" : imageUri ? "Continue" : "Add an image to continue"}</button>
        </section> : null}

        {step === 2 ? <section className="launch-step-panel">
          <div className="field"><label htmlFor="sol-description">Description <small>Optional</small></label><textarea id="sol-description" maxLength={500} placeholder="Tell the market what this token is about." value={description} onChange={(event) => setDescription(event.target.value)} /></div>
          <details className="social-details"><summary>Add community links <span>Optional</span></summary><div className="social-input-grid">
            <div className="field"><label>Website</label><input placeholder="https://project.xyz" value={website} onChange={(event) => setWebsite(event.target.value)} /></div>
            <div className="field"><label>X</label><input placeholder="https://x.com/project" value={twitter} onChange={(event) => setTwitter(event.target.value)} /></div>
            <div className="field"><label>Telegram</label><input placeholder="https://t.me/project" value={telegram} onChange={(event) => setTelegram(event.target.value)} /></div>
            <div className="field"><label>Discord</label><input placeholder="https://discord.gg/project" value={discord} onChange={(event) => setDiscord(event.target.value)} /></div>
          </div></details>
          <div className="launch-step-actions"><button className="button" onClick={() => setStep(1)} type="button">Back</button><button className="button primary" onClick={() => setStep(3)} type="button">Review launch</button></div>
        </section> : null}

        {step === 3 ? <section className="launch-step-panel">
          <div className="field"><label htmlFor="sol-buy">Optional creator first buy</label><input id="sol-buy" inputMode="decimal" placeholder="0" value={initialBuy} onChange={(event) => setInitialBuy(sanitizeSol(event.target.value))} /><span className="field-help">SOL · maximum 50M tokens (5% of supply), enforced from the pool vault onchain</span></div>
          <div className="launch-review-card"><div className="launch-review-head"><strong>{name} <span>${symbol}</span></strong><span><NetworkIcon chainId={101} size={16} />Solana</span></div><dl>
            <div><dt>Market</dt><dd><DexProviderIcon provider="meteora" size={16} /> Meteora DAMM v2</dd></div>
            <div><dt>Supply / creator allocation</dt><dd>1B / 0%</dd></div>
            <div><dt>Liquidity</dt><dd>One-sided · permanently locked</dd></div>
            <div><dt>Trading fee</dt><dd>1% total</dd></div>
            <div><dt>Claimable LP fees</dt><dd>70% platform · 30% creator</dd></div>
            <div><dt>Launch fee</dt><dd>{SOLANA_LAUNCH_FEE} SOL initially · timelocked</dd></div>
            <div><dt>Initial buy</dt><dd>{initialBuy || "0"} SOL</dd></div>
          </dl></div>
          {!anchorWallet ? <p className="launch-notice info">Connect a Solana wallet from the top-right corner.</p> : null}
          {progress.length ? <div className="solana-progress">{progress.map((item) => <span key={item.key}><CheckCircle2 size={14} />{item.label}</span>)}</div> : null}
          {error ? <p className="launch-notice danger">{error}</p> : status ? <p className="launch-notice info">{status}</p> : null}
          {result ? <div className="launch-notice success"><CheckCircle2 size={17} /><span>Market live. <a href={`https://solscan.io/token/${result.mint}`} rel="noreferrer" target="_blank">View token <ExternalLink size={12} /></a> · <a href={`https://solscan.io/tx/${result.signature}`} rel="noreferrer" target="_blank">transaction <ExternalLink size={12} /></a></span></div> : null}
          <div className="launch-step-actions"><button className="button" disabled={busy} onClick={() => setStep(2)} type="button">Back</button><button className="button primary launch-submit" disabled={!anchorWallet || !identityReady || busy || Boolean(result)} onClick={() => void submit()} type="button">{busy ? <Loader2 className="spin" size={16} /> : <Rocket size={16} />}{busy ? status || "Launching on Solana…" : result ? "Market is live" : "Launch direct to Meteora"}</button></div>
        </section> : null}
      </section>
    </div>
  );
}

async function uploadMetadata(input: { name: string; symbol: string; imageUri: string; description: string; website: string; twitter: string; telegram: string; discord: string }) {
  const form = new FormData();
  for (const [key, value] of Object.entries(input)) form.append(key, value);
  form.append("chainId", "101");
  form.append("launchMode", "direct");
  const response = await fetch("/api/pinata/metadata", { method: "POST", body: form });
  const payload = await response.json() as { metadataUri?: string; error?: string };
  if (!response.ok || !payload.metadataUri) throw new Error(payload.error || "Metadata upload failed.");
  return payload.metadataUri;
}

function parseSolToLamports(value: string) {
  const [whole = "0", decimals = ""] = (value || "0").split(".");
  return BigInt(whole || "0") * 1_000_000_000n + BigInt(decimals.padEnd(9, "0").slice(0, 9) || "0");
}

function sanitizeSol(value: string) {
  const clean = value.replace(",", ".").replace(/[^0-9.]/g, "");
  const [whole, ...fraction] = clean.split(".");
  return fraction.length ? `${whole}.${fraction.join("").slice(0, 9)}` : whole;
}

function friendlySolanaError(value: unknown) {
  const message = value instanceof Error ? value.message : "Solana launch failed.";
  if (/reject|cancel|denied/i.test(message)) return "Request cancelled in wallet.";
  if (/wallet.*disconnect|not connected/i.test(message)) return "The Solana wallet disconnected. Reconnect the same wallet before continuing.";
  if (/insufficient|0x1/i.test(message)) return "Wallet does not have enough SOL for the launch fee, initial buy and Solana account rent.";
  if (/blockhash|expired/i.test(message)) return "The Solana transaction expired before confirmation. Please try again.";
  if (/403|forbidden/i.test(message)) return "The configured Solana RPC rejected the request. Check the Solana RPC environment variable and redeploy the web app.";
  return compactError(message, "Solana launch failed. Please try again.");
}

function compactError(message: string, fallback: string) {
  const clean = message.replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  return clean.length > 240 ? `${clean.slice(0, 237)}…` : clean;
}
