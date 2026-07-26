"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Download, Share2, X } from "@/components/bluefun-icons";
import type { DeployedLaunch } from "@/lib/onchain-launches";
import { chainSlug } from "@/lib/chain-slug";
import { tokenPath } from "@/lib/token-url";
import { networkMeta } from "@/components/network-icon";

export function TokenShareDialog({
  launch,
  open,
  onClose
}: {
  launch: DeployedLaunch;
  open: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [origin, setOrigin] = useState("");
  const [cacheKey] = useState(() => Math.floor(Date.now() / 30_000));
  const network = networkMeta(launch.chainId);

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    document.body.classList.add("token-share-open");
    return () => {
      document.removeEventListener("keydown", close);
      document.body.classList.remove("token-share-open");
    };
  }, [open, onClose]);

  const tokenUrl = origin ? `${origin}${tokenPath(launch)}` : "";
  const xShareUrl = tokenUrl ? `${tokenUrl}?ref=x-card-v3` : "";
  const cardUrl = `/api/token/share-card?chain=${launch.chainId}&token=${encodeURIComponent(launch.token)}&v=${cacheKey}`;
  const shareText = useMemo(() => {
    const route = launch.launchMode === "direct" ? "Direct DEX · LP locked" : `${launch.status} · Bond curve`;
    return `${launch.name} ($${launch.symbol}) is live on BlueFun.\n${network.name} · ${route}\nCA: ${launch.token}\nDiscover the story and trade onchain 👇`;
  }, [launch.launchMode, launch.name, launch.status, launch.symbol, launch.token, network.name]);
  const xUrl = tokenUrl
    ? `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(xShareUrl)}`
    : "#";

  async function copyLink() {
    if (!tokenUrl) return;
    await navigator.clipboard.writeText(tokenUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function downloadCard() {
    setDownloading(true);
    try {
      const response = await fetch(cardUrl);
      if (!response.ok) throw new Error("Card download failed");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${chainSlug(launch.chainId)}-${launch.symbol.toLowerCase()}-bluefun.png`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloading(false);
    }
  }

  async function nativeShare() {
    if (!tokenUrl || !navigator.share) return;
    setSharing(true);
    try {
      const response = await fetch(cardUrl);
      const blob = response.ok ? await response.blob() : undefined;
      const file = blob ? new File([blob], `${launch.symbol}-bluefun.png`, { type: "image/png" }) : undefined;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `${launch.name} on BlueFun`, text: shareText, url: tokenUrl, files: [file] });
      } else {
        await navigator.share({ title: `${launch.name} on BlueFun`, text: shareText, url: tokenUrl });
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    } finally {
      setSharing(false);
    }
  }

  if (!open) return null;
  return (
    <div className="token-share-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-labelledby="token-share-title" aria-modal="true" className={`token-share-dialog token-share-${network.tone}`} role="dialog">
        <header>
          <div>
            <span><Share2 /></span>
            <div><small>SOCIAL MEDIA KIT</small><h2 id="token-share-title">Share ${launch.symbol}</h2></div>
          </div>
          <button aria-label="Close share dialog" onClick={onClose}><X /></button>
        </header>
        <div className="token-share-preview"><img alt={`${launch.name} social share card`} src={cardUrl}/></div>
        <div className="token-share-detail">
          <span><i />Live token data</span>
          <p>Premium 1200×630 card with logo, story, network identity, route, market cap and volume.</p>
        </div>
        <footer>
          <button className="button token-share-copy" onClick={() => void copyLink()}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy link"}</button>
          <button className="button token-share-download" disabled={downloading} onClick={() => void downloadCard()}><Download />{downloading ? "Preparing…" : "Download PNG"}</button>
          {typeof navigator !== "undefined" && "share" in navigator
            ? <button className="button token-share-native" disabled={sharing} onClick={() => void nativeShare()}><Share2 />{sharing ? "Opening…" : "Share"}</button>
            : null}
          <a className="button primary token-share-x" href={xUrl} target="_blank" rel="noreferrer"><b>𝕏</b>Share on X</a>
        </footer>
      </section>
    </div>
  );
}
