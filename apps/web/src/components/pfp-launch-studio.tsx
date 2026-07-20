"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { unzip } from "fflate";
import { decodeEventLog, encodeAbiParameters, formatEther, keccak256, parseEther, toBytes, zeroAddress } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { ArrowLeft, BadgeCheck, CheckCircle2, FileArchive, FolderOpen, ImagePlus, Images, Layers3, Loader2, LockKeyhole, ShieldCheck, Sparkles, UploadCloud, WalletCards } from "lucide-react";
import { bluePFPAbi, nftAddresses, nftDropControllerAbi, nftFeePolicyAbi, nftPFPFactoryAbi, nftProtocolVersion, pfpLaunchpadEnabled } from "@/lib/nft-contracts";
import { defaultMintSchedule, emptyMintSchedule, mintScheduleIsValid, MintScheduleFields, resolveMintSchedule } from "@/components/nft-mint-schedule";
import { buildAllowlistTree, parseAllowlistCSV } from "@/lib/nft-allowlist";
import { clearLaunchRecovery, NFTLaunchRecoveryPanel, saveLaunchRecovery } from "@/components/nft-launch-recovery";

type AccessMode = "public" | "allowlist" | "both";
type RevealMode = "instant" | "delayed" | "scheduled";
type PreparedBatch = { itemCount: number; metadataBaseURI: string; placeholderURI: string; contractURI: string; provenanceHash: `0x${string}`; preview: Array<{ name: string; image: string; attributes: unknown[] }> };
type AllowlistManifest = { root: string; collection: string; phaseId: number; entries: Array<{ wallet: string; allowance: string; unitPrice: string; proof: string[] }> };

export function PFPLaunchStudio({ onSelectEdition }: { onSelectEdition: () => void }) {
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const { writeContractAsync } = useWriteContract();
  const [name, setName] = useState(""); const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState(""); const [website, setWebsite] = useState("");
  const [xUrl, setXUrl] = useState(""); const [telegramUrl, setTelegramUrl] = useState("");
  const [royalty, setRoyalty] = useState("5"); const [revealMode, setRevealMode] = useState<RevealMode>("delayed");
  const [revealAt, setRevealAt] = useState(""); const [creatorReserve, setCreatorReserve] = useState("0");
  const [logo, setLogo] = useState<File>(); const [logoPreview, setLogoPreview] = useState(""); const [logoTokenId, setLogoTokenId] = useState("");
  const [freezeOnReveal, setFreezeOnReveal] = useState(true); const [media, setMedia] = useState<File[]>([]);
  const [metadata, setMetadata] = useState<File[]>([]); const [placeholder, setPlaceholder] = useState<File>();
  const [placeholderPreview, setPlaceholderPreview] = useState("");
  const [localPreviews, setLocalPreviews] = useState<string[]>([]); const [prepared, setPrepared] = useState<PreparedBatch>();
  const [mode, setMode] = useState<AccessMode>("public"); const [price, setPrice] = useState("0");
  const [walletLimit, setWalletLimit] = useState("2"); const [allowlist, setAllowlist] = useState("");
  const [allowlistPrice, setAllowlistPrice] = useState("0"); const [allowlistLimit, setAllowlistLimit] = useState("2");
  const [publicPhaseCap, setPublicPhaseCap] = useState("0"); const [allowlistPhaseCap, setAllowlistPhaseCap] = useState("0");
  const [publicMaxPerTx, setPublicMaxPerTx] = useState("2"); const [allowlistMaxPerTx, setAllowlistMaxPerTx] = useState("2");
  const [publicCumulativeLimit, setPublicCumulativeLimit] = useState(true);
  const [mintSchedule, setMintSchedule] = useState(emptyMintSchedule);
  const [status, setStatus] = useState(""); const [error, setError] = useState(""); const [working, setWorking] = useState(false);
  const [step, setStep] = useState(1);
  const [collection, setCollection] = useState<`0x${string}`>(); const [manifest, setManifest] = useState<AllowlistManifest>();
  const [revealSecret, setRevealSecret] = useState<`0x${string}`>();
  const fee = useReadContract({ address: nftAddresses.feePolicy, abi: nftFeePolicyAbi, functionName: "collectionLaunchFee", chainId: 8453 });
  const launchFee = fee.data ?? parseEther("0.001");
  const royaltyBps = Math.round(Number(royalty || 0) * 100);
  const allowlistResult = useMemo(() => { try { return { entries: parseAllowlistCSV(allowlist, { allowance: safeBigInt(allowlistLimit), unitPrice: safeParseEth(allowlistPrice) }), error: "" }; } catch (cause) { return { entries: [], error: message(cause) }; } }, [allowlist, allowlistLimit, allowlistPrice]);
  const publicLimit = Number(walletLimit); const wlLimit = Number(allowlistLimit); const publicTxMax = Number(publicMaxPerTx); const wlTxMax = Number(allowlistMaxPerTx);
  const supply = BigInt(prepared?.itemCount || media.length || 0); const publicCap = safeBigInt(publicPhaseCap); const wlCap = safeBigInt(allowlistPhaseCap);
  const validMint = (mode === "allowlist" || (Number.isInteger(publicLimit) && publicLimit >= 0 && Number.isInteger(publicTxMax) && publicTxMax > 0 && publicTxMax <= 100 && (publicLimit === 0 || publicTxMax <= publicLimit) && publicCap >= 0n && (supply === 0n || publicCap <= supply)))
    && (mode === "public" || (Number.isInteger(wlLimit) && wlLimit > 0 && Number.isInteger(wlTxMax) && wlTxMax > 0 && wlTxMax <= 100 && wlTxMax <= wlLimit && wlCap >= 0n && (supply === 0n || wlCap <= supply) && allowlistResult.entries.length > 0 && !allowlistResult.error))
    && (mode === "allowlist" || isValidEth(price)) && (mode === "public" || isValidEth(allowlistPrice))
    && mintScheduleIsValid(mintSchedule, mode);
  const revealTimestamp = revealAt ? Math.floor(new Date(revealAt).getTime()/1000) : 0;
  const valid = Boolean(name.trim() && symbol.trim() && prepared && prepared.itemCount === media.length && royaltyBps >= 0 && royaltyBps <= 1000 && safeBigInt(creatorReserve)>=0n && safeBigInt(creatorReserve)<=supply && (revealMode!=="scheduled" || revealTimestamp > Date.now()/1000+300) && validMint);

  useEffect(() => () => { localPreviews.forEach((url) => URL.revokeObjectURL(url)); }, [localPreviews]);
  useEffect(() => () => { if (placeholderPreview) URL.revokeObjectURL(placeholderPreview); }, [placeholderPreview]);
  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); }, [logoPreview]);
  useEffect(() => { setMintSchedule(defaultMintSchedule()); }, []);

  async function selectFiles(files?: FileList | File[] | null) {
    if (!files?.length) return;
    setWorking(true); setError(""); setPrepared(undefined); setStatus("Reading collection files…");
    try {
      const incoming = Array.from(files);
      const expanded: File[] = [];
      for (const file of incoming) {
        if (file.name.toLowerCase().endsWith(".zip")) expanded.push(...await extractZip(file));
        else expanded.push(file);
      }
      const images = expanded.filter((file) => /\.(png|jpe?g|gif|webp)$/i.test(file.name)).sort(numericFileSort);
      const metadataFiles = expanded.filter((file) => /\.(json|csv)$/i.test(file.name)).sort(numericFileSort);
      if (!images.length) throw new Error("No PNG, JPG, GIF or WEBP media files were found.");
      if (images.length > 10_000) throw new Error("A PFP batch can contain at most 10,000 media files.");
      if (new Set(images.map((file) => file.name.toLowerCase())).size !== images.length) throw new Error("Media filenames must be unique after folders are flattened.");
      localPreviews.forEach(URL.revokeObjectURL);
      setMedia(images); setMetadata(metadataFiles); setLocalPreviews(images.slice(0, 8).map(URL.createObjectURL));
      setStatus(`${images.length.toLocaleString()} media files and ${metadataFiles.length || "auto-generated"} metadata source${metadataFiles.length === 1 ? "" : "s"} ready.`);
    } catch (cause) { setError(message(cause)); setStatus(""); } finally { setWorking(false); }
  }

  async function prepareBatch() {
    if (!address || !name.trim() || !symbol.trim() || !placeholder || !media.length) return;
    setWorking(true); setError(""); setStatus("Uploading media, normalizing traits and pinning metadata to IPFS…");
    try {
      const form = new FormData();
      form.append("collectionName", name.trim()); form.append("description", description); form.append("externalUrl", website); form.append("xUrl", xUrl); form.append("telegramUrl", telegramUrl); form.append("shuffle", "true");
      form.append("royaltyBps", String(royaltyBps)); form.append("royaltyRecipient", address); form.append("placeholder", placeholder, placeholder.name);
      if (logo) form.append("logo", logo, logo.name); else if (logoTokenId) form.append("logoArtworkIndex", logoTokenId);
      media.forEach((file) => form.append("media", file, file.name)); metadata.forEach((file) => form.append("metadata", file, file.name));
      const response = await fetch("/api/pinata/pfp-batch", { method: "POST", body: form });
      const result = await response.json() as PreparedBatch & { error?: string };
      if (!response.ok || !result.metadataBaseURI) throw new Error(result.error || "The PFP batch could not be prepared.");
      setPrepared(result); setStatus(`${result.itemCount.toLocaleString()} unique NFT records are pinned and launch-ready.`);
    } catch (cause) { setError(message(cause)); setStatus(""); } finally { setWorking(false); }
  }

  async function launch() {
    if (!address || !client || !valid || !pfpLaunchpadEnabled || !prepared) return;
    setWorking(true); setError(""); setCollection(undefined); setManifest(undefined);
    try {
      setStatus(`Deploying the creator-owned ERC-721 contract (${formatEther(launchFee)} ETH launch fee)…`);
      const revealed = revealMode === "instant"; const scheduled = revealMode === "scheduled";
      const scheduledSecret = scheduled && nftProtocolVersion === "v4" ? randomBytes32() : undefined;
      const scheduledCommitment = scheduledSecret
        ? keccak256(encodeAbiParameters([{ type: "string" }, { type: "bytes32" }], [prepared.metadataBaseURI, scheduledSecret]))
        : undefined;
      const hash = await writeContractAsync({ chainId: 8453, address: nftAddresses.pfpFactory, abi: nftPFPFactoryAbi,
        functionName: "createPFPCollection", value: launchFee, args: [{
          name: name.trim(), symbol: symbol.trim().toUpperCase(), contractURI: prepared.contractURI,
          baseURI: revealed
            ? prepared.metadataBaseURI
            : scheduled && nftProtocolVersion === "v4"
              ? scheduledCommitment!
              : scheduled
                ? prepared.metadataBaseURI
                : "",
          placeholderURI: prepared.placeholderURI,
          maxSupply: BigInt(prepared.itemCount), provenanceHash: prepared.provenanceHash, revealed,
          creatorReserve: safeBigInt(creatorReserve), revealTime: scheduled ? BigInt(revealTimestamp) : 0n, freezeOnReveal,
          royaltyRecipient: address, royaltyBps, salt: keccak256(toBytes(`${address}:${name}:${Date.now()}`))
        }] });
      const receipt = await client.waitForTransactionReceipt({ hash });
      let deployed: `0x${string}` | undefined;
      for (const log of receipt.logs) try {
        const decoded = decodeEventLog({ abi: nftPFPFactoryAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "PFPCollectionCreated") deployed = decoded.args.collection;
      } catch { /* unrelated log */ }
      if (!deployed) throw new Error("The PFP collection address could not be read from the receipt.");
      setCollection(deployed);
      if (scheduledSecret) {
        setRevealSecret(scheduledSecret);
        localStorage.setItem(`bluefun:nft-reveal:${deployed.toLowerCase()}`, JSON.stringify({ uri: prepared.metadataBaseURI, secret: scheduledSecret }));
      }
      const now = BigInt(Math.floor(Date.now() / 1000) + 300);
      const schedule = resolveMintSchedule(mintSchedule, mode, now);
      if (!schedule) throw new Error("Mint schedule is invalid. Check phase start and end times.");
      saveLaunchRecovery({version:1,kind:"pfp",wallet:address,collection:deployed,name:name.trim(),mode,allowlist:schedule.allowlist?{start:String(schedule.allowlist.start),end:String(schedule.allowlist.end),cap:String(wlCap),maxPerTx:wlTxMax,entries:allowlistResult.entries.map((entry)=>({wallet:entry.wallet,allowance:String(entry.allowance),unitPrice:String(entry.unitPrice)}))}:undefined,public:schedule.public?{start:String(schedule.public.start),end:String(schedule.public.end),cap:String(publicCap),maxPerTx:publicTxMax,walletLimit:publicLimit,price,cumulative:mode==="both"&&publicCumulativeLimit}:undefined});
      if (revealed && freezeOnReveal) {
        setStatus("Permanently freezing the revealed metadata…");
        const freezeHash = await writeContractAsync({ chainId: 8453, address: deployed, abi: bluePFPAbi, functionName: "freezeMetadata" });
        await client.waitForTransactionReceipt({ hash: freezeHash });
      }
      if (mode !== "public") {
        setStatus("Publishing the PFP allowlist phase onchain…");
        const tree = buildAllowlistTree(allowlistResult.entries, deployed, 1n, 1n);
        const wlSchedule = schedule.allowlist!;
        await createPhase(deployed, { phaseType: 1, limitMode: 0, price: 0n, start: wlSchedule.start, end: wlSchedule.end, cap: wlCap, limit: 0, max: wlTxMax, root: tree.root });
        setManifest({ root: tree.root, collection: deployed, phaseId: 1, entries: tree.entries.map((entry) => ({ wallet: entry.wallet, allowance: entry.allowance.toString(), unitPrice: formatEther(entry.unitPrice), proof: entry.proof })) });
        await saveAllowlist(deployed, 1n, 1n, tree);
        if (mode === "both") await createPhase(deployed, { phaseType: 0, limitMode: publicCumulativeLimit ? 1 : 0, price: parseEth(price), start: schedule.public!.start, end: schedule.public!.end, cap: publicCap, limit: publicLimit, max: publicTxMax, root: zeroHash });
      } else await createPhase(deployed, { phaseType: 0, limitMode: 0, price: parseEth(price), start: schedule.public!.start, end: schedule.public!.end, cap: publicCap, limit: publicLimit, max: publicTxMax, root: zeroHash });
      setStatus(revealed ? "PFP drop is live with instant metadata." : "PFP drop is live in pre-reveal mode. Download and securely back up the reveal manifest.");
      clearLaunchRecovery(address,"pfp");
    } catch (cause) { setError(message(cause)); setStatus(""); } finally { setWorking(false); }
  }

  async function createPhase(deployed: `0x${string}`, config: { phaseType: number; limitMode: number; price: bigint; start: bigint; end: bigint; cap: bigint; limit: number; max: number; root: `0x${string}` }) {
    const hash = await writeContractAsync({ chainId: 8453, address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "createPhase", args: [deployed, 1n, {
      phaseType: config.phaseType, limitMode: config.limitMode, currency: zeroAddress, mintPrice: config.price,
      startTime: config.start, endTime: config.end, phaseSupplyCap: config.cap,
      defaultWalletLimit: config.limit, maxPerTransaction: config.max, merkleRoot: config.root
    }] });
    await client!.waitForTransactionReceipt({ hash });
  }

  function downloadLaunchFiles() {
    if (!prepared) return;
    downloadJson(`${symbol || "pfp"}-reveal-manifest.json`, { collection, metadataBaseURI: prepared.metadataBaseURI, revealSecret: revealMode === "scheduled" ? revealSecret : undefined, provenanceHash: prepared.provenanceHash, freezeOnReveal, itemCount: prepared.itemCount });
    if (manifest) downloadJson(`${symbol || "pfp"}-allowlist-proofs.json`, manifest);
  }

  return <div className="nft-launch-page pfp-launch-page">
    <header className="nft-studio-header nft-studio-header-compact"><div><Link href="/nft"><ArrowLeft/>NFT Launchpad</Link><div className="nft-studio-compact-title"><span>GENERATIVE PFP STUDIO · BASE</span><h1>Create a PFP collection</h1><p>Unique artwork, traits and reveal controls.</p></div></div><div className="nft-studio-status"><i/><span>ERC‑721 ready</span><small>Up to 10,000 items</small></div></header>
    <div className="nft-type-switch" role="tablist" aria-label="Collection standard">
      <button aria-selected="false" onClick={onSelectEdition} role="tab" type="button"><Layers3/><span><strong>Edition / Multi-art</strong><small>ERC-1155 · Repeated editions</small></span></button>
      <button aria-selected="true" className="active" role="tab" type="button"><Sparkles/><span><strong>Generative PFP</strong><small>ERC-721 · Up to 10k unique trait items</small></span></button>
    </div>
    <NFTLaunchRecoveryPanel kind="pfp"/>
    <nav aria-label="PFP launch steps" className="nft-wizard-steps">{["Details", "Artwork", "Reveal", "Mint"].map((label, index) => <button aria-current={step === index + 1 ? "step" : undefined} className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""} key={label} onClick={() => setStep(index + 1)} type="button"><span>{index + 1}</span>{label}</button>)}</nav>
    {!pfpLaunchpadEnabled ? <section className="nft-disabled"><ShieldCheck/><div><h2>PFP contracts pending deployment</h2><p>The studio and IPFS preparation flow are ready. Verified PFP factory and marketplace addresses are required before the final onchain launch.</p></div></section> : null}
    <div className="nft-studio-layout">
      <section className="nft-form-card">
        <PFPSection active={step === 1} number="01" icon={<Images/>} title="Collection identity" detail="Permanent contract identity and creator-facing metadata.">
          <div className="nft-form-grid"><div className="field"><label>Collection name <small>Permanent onchain</small></label><input maxLength={64} placeholder="e.g. Blue Citizens" value={name} onChange={(event) => { setName(event.target.value); setPrepared(undefined); }} /></div><div className="field"><label>Symbol <small>Max 16 characters</small></label><input maxLength={16} placeholder="BCPFP" value={symbol} onChange={(event) => { setSymbol(event.target.value.toUpperCase()); setPrepared(undefined); }} /></div></div>
          <div className="field"><label>Description</label><textarea rows={3} placeholder="Tell collectors the collection story…" value={description} onChange={(event) => { setDescription(event.target.value); setPrepared(undefined); }} /></div>
          <div className="nft-form-grid"><div className="field"><label>Website <small>Optional</small></label><input inputMode="url" placeholder="https://your-site.com" value={website} onChange={(event) => { setWebsite(event.target.value); setPrepared(undefined); }} /></div><div className="field"><label>X account <small>Optional</small></label><input inputMode="url" placeholder="https://x.com/yourcollection" value={xUrl} onChange={(event) => { setXUrl(event.target.value); setPrepared(undefined); }} /></div><div className="field"><label>Telegram <small>Optional</small></label><input inputMode="url" placeholder="https://t.me/yourcollection" value={telegramUrl} onChange={(event) => { setTelegramUrl(event.target.value); setPrepared(undefined); }} /></div><div className="field"><label>Creator royalty <small>0–10%</small></label><div className="nft-input-suffix"><input min="0" max="10" step="0.1" type="number" value={royalty} onChange={(event) => { setRoyalty(event.target.value); setPrepared(undefined); }} /><span>%</span></div></div><div className="field"><label>Creator reserve <small>Optional · inside supply</small></label><input min="0" max={prepared?.itemCount||media.length||undefined} type="number" value={creatorReserve} onChange={(event)=>setCreatorReserve(event.target.value)}/></div></div>
        </PFPSection>

        <PFPSection active={step === 2} number="02" icon={<UploadCloud/>} title="Generative artwork & traits" detail="One unique image and metadata record per NFT — up to 10,000 items.">
          <div className="pfp-upload-options">
            <label><FolderOpen/><span><strong>Upload folder</strong><small>Images with JSON/CSV metadata</small></span><input hidden multiple type="file" onChange={(event) => void selectFiles(event.target.files)} {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} /></label>
            <label><FileArchive/><span><strong>Upload ZIP</strong><small>Complete collection package</small></span><input hidden type="file" accept=".zip" onChange={(event) => void selectFiles(event.target.files)} /></label>
          </div>
          <p className="nft-field-note"><ShieldCheck/>Use filenames 1.png…N.png with 1.json…N.json, one metadata array JSON, or a CSV with token_id, name, description, image and trait:* columns. BlueFun securely shuffles the final token-to-art assignment before pinning and commits its provenance hash.</p>
          <div className="pfp-template-links"><span>Need a template?</span><a download href="/nft/templates/pfp-metadata-example.csv">Download CSV example</a><a download href="/nft/templates/pfp-metadata-example.json">Download JSON example</a></div>
          {media.length ? <div className="pfp-batch-summary"><div><strong>{media.length.toLocaleString()}</strong><small>UNIQUE ITEMS</small></div><div><strong>{metadata.length || "AUTO"}</strong><small>METADATA SOURCES</small></div><div><strong>{formatBytes(media.reduce((sum, file) => sum + file.size, 0))}</strong><small>MEDIA SIZE</small></div><span>{prepared ? "IPFS READY" : "LOCAL REVIEW"}</span></div> : null}
          {localPreviews.length ? <div className="pfp-preview-strip">{localPreviews.map((url, index) => <div key={url}><img src={url} alt={`PFP preview ${index + 1}`}/><span>#{index + 1}</span></div>)}</div> : null}
          <div className="nft-form-grid"><div className="field"><label>Collection logo from artwork <small>Upload-order number</small></label><input min="1" max={media.length||undefined} placeholder="Random artwork if empty" type="number" value={logoTokenId} onChange={(event)=>{setLogoTokenId(event.target.value);setLogo(undefined);setLogoPreview("");setPrepared(undefined);}}/></div><label className={`nft-upload nft-upload-compact ${logoPreview?"has-preview":""}`}>{logoPreview?<img src={logoPreview} alt="Collection logo"/>:<ImagePlus/>}<span><strong>Or upload a custom logo</strong><small>Overrides the artwork selection</small></span><input hidden type="file" accept="image/*" onChange={(event)=>{const file=event.target.files?.[0];if(logoPreview)URL.revokeObjectURL(logoPreview);setLogo(file);setLogoPreview(file?URL.createObjectURL(file):"");setLogoTokenId("");setPrepared(undefined);}}/></label></div>
          <label className={`nft-upload ${placeholder ? "has-preview" : ""}`}>{placeholderPreview ? <img src={placeholderPreview} alt="Pre-reveal preview"/> : <span className="nft-upload-icon"><ImagePlus/></span>}<span><strong>{placeholder ? "Pre-reveal artwork selected" : "Upload pre-reveal artwork"}</strong><small>Shown for every token until the collection is revealed</small></span><b>{placeholder ? "READY" : "REQUIRED"}</b><input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (placeholderPreview) URL.revokeObjectURL(placeholderPreview); setPlaceholder(file); setPlaceholderPreview(file ? URL.createObjectURL(file) : ""); setPrepared(undefined); }} /></label>
          <button className="button pfp-prepare" disabled={!isConnected || !address || !name.trim() || !symbol.trim() || !placeholder || !media.length || working} onClick={() => void prepareBatch()} type="button">{working ? <Loader2 className="spin"/> : <UploadCloud/>}{prepared ? "Rebuild IPFS package" : "Validate & prepare IPFS package"}</button>
        </PFPSection>

        <PFPSection active={step === 3} number="03" icon={<LockKeyhole/>} title="Reveal & provenance" detail="Prevent rarity sniping and make the final ordering verifiable.">
          <div className="nft-segmented pfp-reveal-options"><button className={revealMode === "delayed" ? "active" : ""} onClick={() => setRevealMode("delayed")} type="button"><strong>Manual reveal</strong><small>Creator reveals from dashboard</small></button><button className={revealMode === "scheduled" ? "active" : ""} onClick={() => setRevealMode("scheduled")} type="button"><strong>Scheduled reveal</strong><small>Permissionless execution after time</small></button><button className={revealMode === "instant" ? "active" : ""} onClick={() => setRevealMode("instant")} type="button"><strong>Instant reveal</strong><small>Visible immediately</small></button></div>
          {revealMode==="scheduled"?<div className="field"><label>Reveal date and time</label><input type="datetime-local" value={revealAt} onChange={(event)=>setRevealAt(event.target.value)}/><small>Dashboard shows the countdown and execution reminder.</small></div>:null}
          <label className="pfp-check"><input checked={freezeOnReveal} onChange={(event) => setFreezeOnReveal(event.target.checked)} type="checkbox"/><span><strong>Freeze metadata when revealed</strong><small>Permanently prevents base URI changes after reveal.</small></span></label>
          {prepared ? <div className="pfp-provenance"><BadgeCheck/><span><strong>Metadata provenance committed</strong><code>{prepared.provenanceHash}</code></span></div> : null}
        </PFPSection>

        <PFPSection active={step === 4} number="04" icon={<WalletCards/>} title="Mint strategy" detail="Free or paid public mint, allowlist, or staged access.">
          <div className="field"><label>Access mode</label><div className="nft-segmented">{(["public","allowlist","both"] as const).map((value) => <button className={mode === value ? "active" : ""} key={value} onClick={() => setMode(value)} type="button"><strong>{value === "public" ? "Public mint" : value === "allowlist" ? "Allowlist only" : "Allowlist → Public"}</strong><small>{value === "public" ? "Open to every wallet" : value === "allowlist" ? "Merkle-gated access" : "Staged release"}</small></button>)}</div></div>
          {mode !== "allowlist" ? <><div className="nft-form-grid"><div className="field"><label>Public price <small>0 for free mint</small></label><div className="nft-input-suffix"><input min="0" step="0.001" type="number" value={price} onChange={(event) => setPrice(event.target.value)} /><span>ETH</span></div></div><div className="field"><label>Public allocation <small>0 = all remaining supply</small></label><input min="0" max={prepared?.itemCount || media.length || undefined} type="number" value={publicPhaseCap} onChange={(event) => setPublicPhaseCap(event.target.value)} /></div><div className="field"><label>Per-wallet limit <small>0 = unlimited</small></label><input min="0" type="number" value={walletLimit} onChange={(event) => setWalletLimit(event.target.value)} /></div><div className="field"><label>Max per transaction <small>Maximum 100</small></label><input min="1" max="100" type="number" value={publicMaxPerTx} onChange={(event) => setPublicMaxPerTx(event.target.value)} /></div></div>{mode === "both" ? <label className="pfp-check"><input checked={publicCumulativeLimit} onChange={(event) => setPublicCumulativeLimit(event.target.checked)} type="checkbox"/><span><strong>Count allowlist mints toward the public wallet limit</strong><small>Prevents allowlisted wallets from receiving a fresh public allowance.</small></span></label> : null}</> : null}
          {mode !== "public" ? <><div className="field"><label>Professional allowlist CSV <small>wallet, allowance, price</small></label><textarea className="nft-code-input" rows={6} placeholder={"wallet,allowance,price\n0x…,2,0.001"} value={allowlist} onChange={(event) => setAllowlist(event.target.value)} /><input type="file" accept=".csv,text/csv" onChange={(event)=>{const file=event.target.files?.[0];if(file)void file.text().then(setAllowlist);}}/>{allowlistResult.error?<small className="nft-error">{allowlistResult.error}</small>:<small>{allowlistResult.entries.length} wallets · per-wallet price and allowance supported</small>}</div><div className="nft-form-grid"><div className="field"><label>Default allowlist price</label><div className="nft-input-suffix"><input min="0" step="0.001" type="number" value={allowlistPrice} onChange={(event) => setAllowlistPrice(event.target.value)} /><span>ETH</span></div></div><div className="field"><label>Allowlist allocation <small>0 = all remaining supply</small></label><input min="0" max={prepared?.itemCount || media.length || undefined} type="number" value={allowlistPhaseCap} onChange={(event) => setAllowlistPhaseCap(event.target.value)} /></div><div className="field"><label>Default wallet allowance</label><input min="1" type="number" value={allowlistLimit} onChange={(event) => setAllowlistLimit(event.target.value)} /></div><div className="field"><label>Max per transaction <small>Maximum 100</small></label><input min="1" max="100" type="number" value={allowlistMaxPerTx} onChange={(event) => setAllowlistMaxPerTx(event.target.value)} /></div></div></> : null}
          <MintScheduleFields mode={mode} schedule={mintSchedule} onChange={setMintSchedule}/>
        </PFPSection>
        {error ? <p className="nft-error">{error}</p> : null}{status ? <p className="nft-status">{working ? <Loader2 className="spin"/> : <CheckCircle2/>}{status}</p> : null}
        <div className="nft-wizard-actions">{step > 1 ? <button className="button" disabled={working} onClick={() => setStep((value) => value - 1)} type="button">Back</button> : <span/>}{step < 4 ? <button className="button primary" disabled={working} onClick={() => setStep((value) => value + 1)} type="button">Continue</button> : <button className="button primary nft-submit" disabled={!pfpLaunchpadEnabled || !isConnected || !valid || working} onClick={() => void launch()} type="button">{working ? <Loader2 className="spin"/> : <Sparkles/>}{!isConnected ? "Connect wallet to launch" : !prepared ? "Prepare collection files first" : "Launch PFP collection"}</button>}</div>
        {collection ? <div className="nft-success"><code>{collection}</code><Link href={`/nft/${collection}/1`}>Open collection</Link><button onClick={downloadLaunchFiles} type="button">Download launch files</button></div> : null}
      </section>

      <aside className="nft-studio-aside">
        <div className="nft-live-preview pfp-live-preview"><div className="nft-preview-label"><span>COLLECTION PREVIEW</span><i>ERC-721</i></div><div className="pfp-preview-mosaic">{localPreviews.slice(0, 4).map((url, index) => <img src={url} alt={`Collection item ${index + 1}`} key={url}/>)}{!localPreviews.length ? <><Sparkles/><span>UPLOAD YOUR PFP SET</span></> : null}</div><div className="nft-preview-copy"><small>{symbol || "PFP"}</small><h2>{name || "Untitled PFP collection"}</h2><p>{description || "Your collection story and trait-driven artwork will appear here."}</p><div><span>UNIQUE SUPPLY <b>{media.length || "—"}</b></span><span>REVEAL <b>{revealMode === "delayed" ? "DELAYED" : "INSTANT"}</b></span></div></div></div>
        <div className="nft-launch-summary"><div className="nft-summary-title"><WalletCards/><div><strong>PFP launch summary</strong><small>Creator-owned, mint-on-demand</small></div></div><dl><div><dt>Network</dt><dd>Base mainnet</dd></div><div><dt>Standard</dt><dd>ERC‑721 + ERC‑2981</dd></div><div><dt>Supply</dt><dd>{media.length || "—"}</dd></div><div><dt>Metadata</dt><dd>IPFS {freezeOnReveal ? "+ Freeze" : "Editable"}</dd></div><div><dt>Access</dt><dd>{mode === "both" ? "WL → Public" : mode}</dd></div><div><dt>Launch fee</dt><dd>{formatEther(launchFee)} ETH</dd></div></dl><div className="nft-summary-total"><span>Due at launch</span><strong>{formatEther(launchFee)} ETH</strong><small>Free mints have no primary fee. Paid mints use the shared BlueFun fee policy.</small></div><p><BadgeCheck/>OpenSea-compatible token and royalty metadata</p></div>
      </aside>
    </div>
  </div>;
}

function PFPSection({ active, number, icon, title, detail, children }: { active: boolean; number: string; icon: React.ReactNode; title: string; detail: string; children: React.ReactNode }) {
  return <section className="nft-studio-section" hidden={!active}><header><span>{icon}</span><div><small>{number}</small><h2>{title}</h2><p>{detail}</p></div></header><div className="nft-studio-fields">{children}</div></section>;
}

async function extractZip(file: File): Promise<File[]> {
  if (file.size > 250 * 1024 * 1024) throw new Error("ZIP files must be 250 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) => unzip(bytes, (error, result) => error ? reject(error) : resolve(result)));
  return Object.entries(entries).filter(([path, data]) => data.length && !path.includes("__MACOSX") && !path.endsWith("/")).map(([path, data]) => new File([new Uint8Array(data)], path.split("/").pop() || "file", { type: mime(path) }));
}

function numericFileSort(a: File, b: File) { const an = Number(a.name.match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER); const bn = Number(b.name.match(/\d+/)?.[0] || Number.MAX_SAFE_INTEGER); return an - bn || a.name.localeCompare(b.name); }
function mime(name: string) { const ext = name.split(".").pop()?.toLowerCase(); return ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : ext === "json" ? "application/json" : ext === "csv" ? "text/csv" : "application/octet-stream"; }
function parseEth(value: string) { return parseEther(value && Number(value) >= 0 ? value : "0"); }
function isValidEth(value: string) { try { return Number(value) >= 0 && parseEther(value || "0") >= 0n; } catch { return false; } }
function safeBigInt(value: string) { try { return BigInt(value || "0"); } catch { return -1n; } }
function safeParseEth(value:string){try{return parseEth(value);}catch{return -1n;}}
function message(error: unknown) { return error instanceof Error ? error.message.split("Request Arguments:")[0].slice(0, 300) : "The operation failed."; }
function formatBytes(value: number) { return value > 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`; }
function downloadJson(name: string, value: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url); }
function randomBytes32() { const bytes = crypto.getRandomValues(new Uint8Array(32)); return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}` as `0x${string}`; }
const zeroHash = `0x${"0".repeat(64)}` as `0x${string}`;
async function saveAllowlist(collection:`0x${string}`,tokenId:bigint,phaseId:bigint,tree:ReturnType<typeof buildAllowlistTree>){const response=await fetch("/api/nft/allowlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({collection,tokenId:tokenId.toString(),phaseId:phaseId.toString(),root:tree.root,entries:tree.entries.map((entry)=>({wallet:entry.wallet,allowance:entry.allowance.toString(),unitPrice:entry.unitPrice.toString(),proof:entry.proof}))})});if(!response.ok)throw new Error("The phase is onchain, but automatic proof storage failed. Resume this launch to retry safely.");}
