"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { decodeEventLog, formatEther, keccak256, parseEther, toBytes, zeroAddress } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { ArrowLeft, BadgeCheck, CheckCircle2, ImagePlus, Layers3, Loader2, LockKeyhole, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { nftAddresses, nftCollectionFactoryAbi, nftDropControllerAbi, nftFeePolicyAbi, nftLaunchpadEnabled } from "@/lib/nft-contracts";
import { PFPLaunchStudio } from "@/components/pfp-launch-studio";
import { defaultMintSchedule, emptyMintSchedule, mintScheduleIsValid, MintScheduleFields, resolveMintSchedule } from "@/components/nft-mint-schedule";
import { buildAllowlistTree, parseAllowlistCSV } from "@/lib/nft-allowlist";
import { clearLaunchRecovery, NFTLaunchRecoveryPanel, saveLaunchRecovery } from "@/components/nft-launch-recovery";

type AccessMode = "public" | "allowlist" | "both";
type AllowlistManifest = { root: string; collection: string; phaseId: number; entries: Array<{ wallet: string; allowance: string; unitPrice: string; proof: string[] }> };

export default function NFTLaunchPage() {
  const [collectionType, setCollectionType] = useState<"edition" | "pfp">("edition");
  const { address, isConnected } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const { writeContractAsync } = useWriteContract();
  const [name, setName] = useState(""); const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState(""); const [website, setWebsite] = useState("");
  const [xUrl, setXUrl] = useState(""); const [telegramUrl, setTelegramUrl] = useState("");
  const [supply, setSupply] = useState("100"); const [royalty, setRoyalty] = useState("5");
  const [creatorReserve, setCreatorReserve] = useState("0"); const [logoURI, setLogoURI] = useState(""); const [logoPreview, setLogoPreview] = useState("");
  const [mode, setMode] = useState<AccessMode>("public"); const [price, setPrice] = useState("0");
  const [walletLimit, setWalletLimit] = useState("2"); const [allowlist, setAllowlist] = useState("");
  const [allowlistPrice, setAllowlistPrice] = useState("0"); const [allowlistLimit, setAllowlistLimit] = useState("2");
  const [publicPhaseCap, setPublicPhaseCap] = useState("0"); const [allowlistPhaseCap, setAllowlistPhaseCap] = useState("0");
  const [publicMaxPerTx, setPublicMaxPerTx] = useState("2"); const [allowlistMaxPerTx, setAllowlistMaxPerTx] = useState("2");
  const [publicCumulativeLimit, setPublicCumulativeLimit] = useState(true);
  const [mintSchedule, setMintSchedule] = useState(emptyMintSchedule);
  const [imageURI, setImageURI] = useState(""); const [imagePreview, setImagePreview] = useState("");
  const [status, setStatus] = useState(""); const [error, setError] = useState(""); const [working, setWorking] = useState(false);
  const [step, setStep] = useState(1);
  const [collection, setCollection] = useState<`0x${string}`>(); const [manifest, setManifest] = useState<AllowlistManifest>();
  const fee = useReadContract({ address: nftAddresses.feePolicy, abi: nftFeePolicyAbi, functionName: "collectionLaunchFee", chainId: 8453, query: { enabled: nftLaunchpadEnabled } });
  const launchFee = fee.data ?? parseEther("0.001");
  const royaltyBps = Math.round(Number(royalty || 0) * 100);
  const allowlistResult = useMemo(() => { try { return { entries: parseAllowlistCSV(allowlist, { allowance: safeBigInt(allowlistLimit), unitPrice: safeParseEth(allowlistPrice) }), error: "" }; } catch (cause) { return { entries: [], error: message(cause) }; } }, [allowlist, allowlistLimit, allowlistPrice]);
  const numericSupply = Number(supply); const supplyBig = safeBigInt(supply); const publicLimit = Number(walletLimit); const wlLimit = Number(allowlistLimit);
  const publicCap = safeBigInt(publicPhaseCap); const wlCap = safeBigInt(allowlistPhaseCap); const publicTxMax = Number(publicMaxPerTx); const wlTxMax = Number(allowlistMaxPerTx);
  const valid = Boolean(name.trim() && symbol.trim() && imageURI && Number.isSafeInteger(numericSupply) && numericSupply > 0
    && supplyBig > 0n && supplyBig <= (2n ** 64n - 1n) && royaltyBps >= 0 && royaltyBps <= 1000
    && (mode === "allowlist" || (Number.isInteger(publicLimit) && publicLimit >= 0 && publicLimit <= 4_294_967_295 && Number.isInteger(publicTxMax) && publicTxMax > 0 && publicTxMax <= 4_294_967_295 && (publicLimit === 0 || publicTxMax <= publicLimit) && publicCap >= 0n && publicCap <= supplyBig))
    && (mode === "public" || (Number.isInteger(wlLimit) && wlLimit > 0 && wlLimit <= 4_294_967_295))
    && (mode === "public" || (Number.isInteger(wlTxMax) && wlTxMax > 0 && wlTxMax <= wlLimit && wlCap >= 0n && wlCap <= supplyBig))
    && safeBigInt(creatorReserve) >= 0n && safeBigInt(creatorReserve) <= supplyBig
    && (mode === "public" || (allowlistResult.entries.length > 0 && !allowlistResult.error))
    && (mode === "allowlist" || isValidEth(price)) && (mode === "public" || isValidEth(allowlistPrice))
    && mintScheduleIsValid(mintSchedule, mode));

  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);
  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); }, [logoPreview]);
  useEffect(() => { setMintSchedule(defaultMintSchedule()); }, []);

  async function uploadImage(file?: File) {
    if (!file) return; setError(""); setWorking(true); setStatus("Uploading artwork to IPFS…");
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(URL.createObjectURL(file));
    try {
      const form = new FormData(); form.append("image", file);
      const response = await fetch("/api/pinata/image", { method: "POST", body: form });
      const json = await response.json() as { imageUri?: string; error?: string };
      if (!response.ok || !json.imageUri) throw new Error(json.error || "Artwork could not be uploaded.");
      setImageURI(json.imageUri); setStatus("Artwork secured on IPFS.");
    } catch (cause) { setError(message(cause)); } finally { setWorking(false); }
  }

  async function uploadLogo(file?: File) {
    if (!file) return; setWorking(true); setError(""); if (logoPreview) URL.revokeObjectURL(logoPreview); setLogoPreview(URL.createObjectURL(file));
    try { const form = new FormData(); form.append("image", file); const response = await fetch("/api/pinata/image", { method: "POST", body: form }); const json = await response.json() as { imageUri?: string; error?: string }; if (!response.ok || !json.imageUri) throw new Error(json.error || "Logo could not be uploaded."); setLogoURI(json.imageUri); }
    catch (cause) { setError(message(cause)); } finally { setWorking(false); }
  }

  async function launch() {
    if (!isConnected || !address || !client || !valid || !nftLaunchpadEnabled) return;
    setWorking(true); setError(""); setCollection(undefined); setManifest(undefined);
    try {
      setStatus("Publishing collection and artwork metadata to IPFS…");
      const metadataResponse = await fetch("/api/pinata/nft-metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name, symbol, description, image: imageURI, logoImage: logoURI, externalUrl: website, xUrl, telegramUrl, supply: Number(supply), royaltyBps, royaltyRecipient: address
      }) });
      const metadata = await metadataResponse.json() as { itemURI?: string; contractURI?: string; error?: string };
      if (!metadataResponse.ok || !metadata.itemURI || !metadata.contractURI) throw new Error(metadata.error || "Metadata could not be prepared.");

      setStatus(`Creating collection (${formatEther(launchFee)} ETH launch fee)…`);
      const hash = await writeContractAsync({ chainId: 8453, address: nftAddresses.collectionFactory, abi: nftCollectionFactoryAbi,
        functionName: "createCollection", value: launchFee, args: [{
          name: name.trim(), symbol: symbol.trim().toUpperCase(), contractURI: metadata.contractURI,
          initialItemURI: metadata.itemURI, initialMaxSupply: BigInt(supply), initialCreatorReserve: safeBigInt(creatorReserve), royaltyRecipient: address,
          royaltyBps, salt: keccak256(toBytes(`${address}:${name}:${symbol}:${Date.now()}`))
        }] });
      const receipt = await client.waitForTransactionReceipt({ hash });
      let deployed: `0x${string}` | undefined;
      for (const log of receipt.logs) try {
        const decoded = decodeEventLog({ abi: nftCollectionFactoryAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === "NFTCollectionCreated") deployed = decoded.args.collection;
      } catch { /* unrelated log */ }
      if (!deployed) throw new Error("The collection address could not be read from the transaction receipt.");
      setCollection(deployed);

      const now = BigInt(Math.floor(Date.now() / 1000) + 300);
      const schedule = resolveMintSchedule(mintSchedule, mode, now);
      if (!schedule) throw new Error("Mint schedule is invalid. Check phase start and end times.");
      saveLaunchRecovery({version:1,kind:"edition",wallet:address,collection:deployed,name:name.trim(),mode,allowlist:schedule.allowlist?{start:String(schedule.allowlist.start),end:String(schedule.allowlist.end),cap:String(wlCap),maxPerTx:wlTxMax,entries:allowlistResult.entries.map((entry)=>({wallet:entry.wallet,allowance:String(entry.allowance),unitPrice:String(entry.unitPrice)}))}:undefined,public:schedule.public?{start:String(schedule.public.start),end:String(schedule.public.end),cap:String(publicCap),maxPerTx:publicTxMax,walletLimit:publicLimit,price, cumulative:mode==="both"&&publicCumulativeLimit}:undefined});
      if (mode === "allowlist" || mode === "both") {
        setStatus("Publishing the allowlist mint phase onchain…");
        const tree = buildAllowlistTree(allowlistResult.entries, deployed, 1n, 1n);
        const wlSchedule = schedule.allowlist!;
        const phaseHash = await writeContractAsync({ chainId: 8453, address: nftAddresses.dropController, abi: nftDropControllerAbi,
          functionName: "createPhase", args: [deployed, 1n, {
            phaseType: 1, limitMode: 0, currency: zeroAddress, mintPrice: 0n, startTime: wlSchedule.start, endTime: wlSchedule.end,
            phaseSupplyCap: wlCap, defaultWalletLimit: 0, maxPerTransaction: wlTxMax, merkleRoot: tree.root
          }] });
        await client.waitForTransactionReceipt({ hash: phaseHash });
        setManifest({ root: tree.root, collection: deployed, phaseId: 1, entries: tree.entries.map((entry) => ({
          wallet: entry.wallet, allowance: entry.allowance.toString(), unitPrice: formatEther(entry.unitPrice), proof: entry.proof
        })) });
        await saveAllowlist(deployed, 1n, 1n, tree);
        if (mode === "both") await createPublicPhase(deployed, schedule.public!.start, schedule.public!.end);
      } else await createPublicPhase(deployed, schedule.public!.start, schedule.public!.end);
      setStatus("Launch complete. The creator wallet owns the collection.");
      clearLaunchRecovery(address,"edition");
    } catch (cause) { setError(message(cause)); setStatus(""); } finally { setWorking(false); }
  }

  async function createPublicPhase(deployed: `0x${string}`, start: bigint, end: bigint) {
    setStatus("Publishing the public mint phase onchain…");
    const hash = await writeContractAsync({ chainId: 8453, address: nftAddresses.dropController, abi: nftDropControllerAbi,
      functionName: "createPhase", args: [deployed, 1n, {
        phaseType: 0, limitMode: mode === "both" && publicCumulativeLimit ? 1 : 0, currency: zeroAddress, mintPrice: parseEth(price), startTime: start, endTime: end,
        phaseSupplyCap: publicCap, defaultWalletLimit: publicLimit, maxPerTransaction: publicTxMax,
        merkleRoot: `0x${"0".repeat(64)}`
      }] });
    await client!.waitForTransactionReceipt({ hash });
  }

  function downloadManifest() {
    if (!manifest) return; const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${symbol}-allowlist.json`; link.click(); URL.revokeObjectURL(url);
  }

  if (collectionType === "pfp") return <PFPLaunchStudio onSelectEdition={() => setCollectionType("edition")} />;

  return <div className="nft-launch-page">
    <header className="nft-studio-header nft-studio-header-compact"><div><Link href="/nft"><ArrowLeft/>NFT Launchpad</Link><div className="nft-studio-compact-title"><span>CREATOR STUDIO · BASE</span><h1>Create an Edition collection</h1><p>Artwork, economics and mint access.</p></div></div><div className="nft-studio-status"><i/><span>ERC‑1155 ready</span><small>Creator-owned</small></div></header>
    <CollectionTypeSwitch active="edition" onEdition={() => setCollectionType("edition")} onPFP={() => setCollectionType("pfp")} />
    <NFTLaunchRecoveryPanel kind="edition"/>
    <nav aria-label="Edition launch steps" className="nft-wizard-steps">{["Details", "Economics", "Mint"].map((label, index) => <button aria-current={step === index + 1 ? "step" : undefined} className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""} key={label} onClick={() => setStep(index + 1)} type="button"><span>{index + 1}</span>{label}</button>)}</nav>
    {!nftLaunchpadEnabled ? <section className="nft-disabled"><ShieldCheck/><div><h2>NFT protocol unavailable</h2><p>Verified Base contract addresses are required before launch transactions can be submitted.</p></div></section> : null}
    <div className="nft-studio-layout">
      <section className="nft-form-card">
        <StudioSection active={step === 1} number="01" icon={<Layers3/>} title="Collection identity" detail="Name the collection and define its public metadata.">
          <div className="nft-form-grid"><div className="field"><label>Collection name <small>Required</small></label><input maxLength={64} placeholder="e.g. Blue Frequency" value={name} onChange={(e) => setName(e.target.value)} /></div><div className="field"><label>Symbol <small>Max 16 characters</small></label><input maxLength={16} placeholder="BLUE" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></div></div>
          <div className="field"><label>Description <small>Stored with collection metadata</small></label><textarea placeholder="Tell collectors what makes this drop distinct…" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="nft-form-grid"><div className="field"><label>Website <small>Optional</small></label><input inputMode="url" placeholder="https://your-site.com" value={website} onChange={(e) => setWebsite(e.target.value)} /></div><div className="field"><label>X account <small>Optional</small></label><input inputMode="url" placeholder="https://x.com/yourcollection" value={xUrl} onChange={(e) => setXUrl(e.target.value)} /></div></div>
          <div className="field"><label>Telegram <small>Optional</small></label><input inputMode="url" placeholder="https://t.me/yourcollection" value={telegramUrl} onChange={(e) => setTelegramUrl(e.target.value)} /></div>
          <label className={`nft-upload ${imagePreview ? "has-preview" : ""}`}>{imagePreview ? <img src={imagePreview} alt="NFT preview" /> : <span className="nft-upload-icon"><ImagePlus/></span>}<span><strong>{imageURI ? "Artwork secured on IPFS" : "Upload edition artwork"}</strong><small>PNG, JPG, GIF or WEBP · High resolution recommended</small></span><b>{imageURI ? "READY" : "CHOOSE FILE"}</b><input hidden type="file" accept="image/*" onChange={(e) => void uploadImage(e.target.files?.[0])} /></label>
          <label className={`nft-upload nft-upload-compact ${logoPreview ? "has-preview" : ""}`}>{logoPreview ? <img src={logoPreview} alt="Collection logo"/> : <ImagePlus/>}<span><strong>{logoURI ? "Custom collection logo ready" : "Collection logo (optional)"}</strong><small>Leave empty to use the NFT artwork.</small></span><input hidden type="file" accept="image/*" onChange={(event) => void uploadLogo(event.target.files?.[0])}/></label>
        </StudioSection>

        <StudioSection active={step === 2} number="02" icon={<Sparkles/>} title="Edition economics" detail="Set the lifetime supply and creator royalty.">
          <div className="nft-form-grid"><div className="field"><label>Lifetime supply <small>Permanent cap</small></label><input min="1" type="number" value={supply} onChange={(e) => setSupply(e.target.value)} /></div><div className="field"><label>Creator reserve <small>Optional · inside supply</small></label><input min="0" max={supply} type="number" value={creatorReserve} onChange={(e) => setCreatorReserve(e.target.value)}/></div><div className="field"><label>Creator royalty <small>0–10%</small></label><div className="nft-input-suffix"><input min="0" max="10" step="0.1" type="number" value={royalty} onChange={(e) => setRoyalty(e.target.value)} /><span>%</span></div></div></div>
          <p className="nft-field-note"><ShieldCheck/>The lifetime supply cannot be reopened by burning tokens. Royalty data follows ERC‑2981.</p>
        </StudioSection>

        <StudioSection active={step === 3} number="03" icon={<LockKeyhole/>} title="Mint strategy" detail="Choose public access, allowlist access or a staged release.">
          <div className="field"><label>Access mode</label><div className="nft-segmented">{(["public","allowlist","both"] as const).map((value) => <button className={mode === value ? "active" : ""} key={value} onClick={() => setMode(value)} type="button"><strong>{value === "public" ? "Public mint" : value === "allowlist" ? "Allowlist only" : "Allowlist → Public"}</strong><small>{value === "public" ? "Open to every wallet" : value === "allowlist" ? "Merkle-gated access" : "Staged access"}</small></button>)}</div></div>
          {mode !== "allowlist" ? <><div className="nft-form-grid"><div className="field"><label>Public mint price <small>Use 0 for a free mint</small></label><div className="nft-input-suffix"><input min="0" step="0.001" type="number" value={price} onChange={(e) => setPrice(e.target.value)} /><span>ETH</span></div></div><div className="field"><label>Public allocation <small>0 = all remaining supply</small></label><input min="0" max={supply} type="number" value={publicPhaseCap} onChange={(e) => setPublicPhaseCap(e.target.value)} /></div><div className="field"><label>Per-wallet limit <small>0 = unlimited</small></label><input min="0" type="number" value={walletLimit} onChange={(e) => setWalletLimit(e.target.value)} /></div><div className="field"><label>Max per transaction</label><input min="1" type="number" value={publicMaxPerTx} onChange={(e) => setPublicMaxPerTx(e.target.value)} /></div></div>{mode === "both" ? <label className="pfp-check"><input checked={publicCumulativeLimit} onChange={(e) => setPublicCumulativeLimit(e.target.checked)} type="checkbox"/><span><strong>Count allowlist mints toward the public wallet limit</strong><small>Prevents allowlisted wallets from receiving a fresh public allowance.</small></span></label> : null}</> : null}
          {mode !== "public" ? <><div className="field"><label>Professional allowlist CSV <small>wallet, allowance, price</small></label><textarea className="nft-code-input" placeholder={"wallet,allowance,price\n0x…,2,0.001"} rows={6} value={allowlist} onChange={(e) => setAllowlist(e.target.value)} /><input type="file" accept=".csv,text/csv" onChange={(event) => { const file=event.target.files?.[0]; if(file) void file.text().then(setAllowlist); }}/>{allowlistResult.error?<small className="nft-error">{allowlistResult.error}</small>:<small>{allowlistResult.entries.length} wallets · blank allowance/price use defaults below</small>}</div><div className="nft-form-grid"><div className="field"><label>Default allowlist price</label><div className="nft-input-suffix"><input min="0" step="0.001" type="number" value={allowlistPrice} onChange={(e) => setAllowlistPrice(e.target.value)} /><span>ETH</span></div></div><div className="field"><label>Allowlist allocation <small>0 = all remaining supply</small></label><input min="0" max={supply} type="number" value={allowlistPhaseCap} onChange={(e) => setAllowlistPhaseCap(e.target.value)} /></div><div className="field"><label>Default wallet allowance</label><input min="1" type="number" value={allowlistLimit} onChange={(e) => setAllowlistLimit(e.target.value)} /></div><div className="field"><label>Max per transaction</label><input min="1" type="number" value={allowlistMaxPerTx} onChange={(e) => setAllowlistMaxPerTx(e.target.value)} /></div></div></> : null}
          <MintScheduleFields mode={mode} schedule={mintSchedule} onChange={setMintSchedule}/>
        </StudioSection>
        {error ? <p className="nft-error">{error}</p> : null}{status ? <p className="nft-status">{working ? <Loader2 className="spin"/> : <CheckCircle2/>}{status}</p> : null}
        <div className="nft-wizard-actions">{step > 1 ? <button className="button" disabled={working} onClick={() => setStep((value) => value - 1)} type="button">Back</button> : <span/>}{step < 3 ? <button className="button primary" disabled={working} onClick={() => setStep((value) => value + 1)} type="button">Continue</button> : <button className="button primary nft-submit" disabled={!nftLaunchpadEnabled || !isConnected || !valid || working} onClick={() => void launch()} type="button">{working ? <Loader2 className="spin"/> : <Sparkles/>}{!isConnected ? "Connect wallet to launch" : "Launch collection"}</button>}</div>
        {collection ? <div className="nft-success"><code>{collection}</code><Link href={`/nft/${collection}/1`}>Open mint page</Link>{manifest ? <button onClick={downloadManifest} type="button">Download allowlist proofs</button> : null}</div> : null}
      </section>

      <aside className="nft-studio-aside">
        <div className="nft-live-preview"><div className="nft-preview-label"><span>LIVE PREVIEW</span><i>BASE</i></div><div className="nft-preview-media">{imagePreview ? <img src={imagePreview} alt="Collection artwork preview"/> : <><Sparkles/><span>YOUR ARTWORK</span></>}</div><div className="nft-preview-copy"><small>{symbol || "SYMBOL"}</small><h2>{name || "Untitled collection"}</h2><p>{description || "Your collection story will appear here."}</p><div><span>EDITION SIZE <b>{supply || "—"}</b></span><span>ROYALTY <b>{royalty || "0"}%</b></span></div></div></div>
        <div className="nft-launch-summary"><div className="nft-summary-title"><WalletCards/><div><strong>Launch summary</strong><small>Paid directly onchain</small></div></div><dl><div><dt>Network</dt><dd>Base mainnet</dd></div><div><dt>Standard</dt><dd>ERC‑1155</dd></div><div><dt>Collection owner</dt><dd>Your wallet</dd></div><div><dt>Access</dt><dd>{mode === "both" ? "Allowlist → Public" : mode === "allowlist" ? "Allowlist" : "Public"}</dd></div><div><dt>Launch fee</dt><dd>{formatEther(launchFee)} ETH</dd></div></dl><div className="nft-summary-total"><span>Due at launch</span><strong>{formatEther(launchFee)} ETH</strong><small>Mint prices are separate. Free mints carry no primary mint commission.</small></div><p><BadgeCheck/>Contracts verified on Base</p></div>
      </aside>
    </div>
  </div>;
}

function CollectionTypeSwitch({ active, onEdition, onPFP }: { active: "edition" | "pfp"; onEdition: () => void; onPFP: () => void }) {
  return <div className="nft-type-switch" role="tablist" aria-label="Collection standard">
    <button aria-selected={active === "edition"} className={active === "edition" ? "active" : ""} onClick={onEdition} role="tab" type="button"><Layers3/><span><strong>Edition / Multi-art</strong><small>ERC-1155 · Repeated editions</small></span></button>
    <button aria-selected={active === "pfp"} className={active === "pfp" ? "active" : ""} onClick={onPFP} role="tab" type="button"><Sparkles/><span><strong>Generative PFP</strong><small>ERC-721 · Up to 10k unique trait items</small></span></button>
  </div>;
}

function StudioSection({ active, number, icon, title, detail, children }: { active: boolean; number: string; icon: React.ReactNode; title: string; detail: string; children: React.ReactNode }) {
  return <section className="nft-studio-section" hidden={!active}><header><span>{icon}</span><div><small>{number}</small><h2>{title}</h2><p>{detail}</p></div></header><div className="nft-studio-fields">{children}</div></section>;
}

function parseEth(value: string) { return parseEther(value && Number(value) >= 0 ? value : "0"); }
function isValidEth(value: string) { try { return Number(value) >= 0 && parseEther(value || "0") >= 0n; } catch { return false; } }
function safeBigInt(value: string) { try { return BigInt(value || "0"); } catch { return 0n; } }
function message(error: unknown) { return error instanceof Error ? error.message.split("Request Arguments:")[0].slice(0, 260) : "Transaction failed."; }
function safeParseEth(value:string){try{return parseEth(value);}catch{return -1n;}}
async function saveAllowlist(collection:`0x${string}`,tokenId:bigint,phaseId:bigint,tree:ReturnType<typeof buildAllowlistTree>){const response=await fetch("/api/nft/allowlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({collection,tokenId:tokenId.toString(),phaseId:phaseId.toString(),root:tree.root,entries:tree.entries.map((entry)=>({wallet:entry.wallet,allowance:entry.allowance.toString(),unitPrice:entry.unitPrice.toString(),proof:entry.proof}))})});if(!response.ok)throw new Error("The phase is onchain, but automatic proof storage failed. Resume this launch to retry safely.");}
