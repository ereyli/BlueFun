"use client";

import { useState } from "react";
import { getAddress, isAddress, zeroAddress, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { BadgeCheck, Eye, FileKey2, ImagePlus, Loader2, LockKeyhole, Settings2, ShieldCheck, UserRoundCog } from "lucide-react";
import { blueEditionAbi, bluePFPAbi } from "@/lib/nft-contracts";

type Collection = { collection: string; factory?: string; name: string; symbol: string; standard: "ERC721" | "ERC1155" };
type WriteRequest = Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0];

export function CreatorCollectionSettings({ item }: { item: Collection }) {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const { writeContractAsync, isPending } = useWriteContract();
  const collection = getAddress(item.collection);
  const isPFP = item.standard === "ERC721";
  const owner = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "owner", chainId: 8453 });
  const pendingOwner = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "pendingOwner", chainId: 8453 });
  const payout = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "payoutRecipient", chainId: 8453 });
  const contractURI = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "contractURI", chainId: 8453 });
  const contractFrozen = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "contractMetadataFrozen", chainId: 8453 });
  const royaltyRecipient = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "royaltyRecipient", chainId: 8453 });
  const royaltyBps = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "royaltyBps", chainId: 8453 });
  const royaltyFrozen = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "royaltyFrozen", chainId: 8453 });
  const pfpRevealed = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "revealed", chainId: 8453, query: { enabled: isPFP } });
  const pfpMetadataFrozen = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "metadataFrozen", chainId: 8453, query: { enabled: isPFP } });
  const scheduledReveal = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "scheduledRevealTime", chainId: 8453, query: { enabled: isPFP } });
  const [payoutInput, setPayoutInput] = useState("");
  const [royaltyWallet, setRoyaltyWallet] = useState("");
  const [royaltyPercent, setRoyaltyPercent] = useState("");
  const [contractUriInput, setContractUriInput] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [controller, setController] = useState("");
  const [controllerAllowed, setControllerAllowed] = useState(true);
  const [validator, setValidator] = useState("");
  const [pfpUri, setPfpUri] = useState("");
  const [placeholderUri, setPlaceholderUri] = useState("");
  const [freezeOnReveal, setFreezeOnReveal] = useState(true);
  const [provenance, setProvenance] = useState("");
  const [tokenId, setTokenId] = useState("1");
  const [itemUri, setItemUri] = useState("");
  const [itemSupply, setItemSupply] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [newItemImage, setNewItemImage] = useState("");
  const [newItemSupply, setNewItemSupply] = useState("100");
  const [newItemReserve, setNewItemReserve] = useState("0");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const isOwner = Boolean(address && owner.data?.toLowerCase() === address.toLowerCase());
  const canAcceptOwnership = Boolean(address && pendingOwner.data !== zeroAddress && pendingOwner.data?.toLowerCase() === address.toLowerCase());
  const selectedTokenId = /^\d+$/.test(tokenId) && BigInt(tokenId) > 0n ? BigInt(tokenId) : 1n;
  const maxSupply = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "maxSupply", args: [selectedTokenId], chainId: 8453, query: { enabled: !isPFP } });
  const tokenFrozen = useReadContract({ address: collection, abi: blueEditionAbi, functionName: "tokenMetadataFrozen", args: [selectedTokenId], chainId: 8453, query: { enabled: !isPFP } });

  async function send(request: WriteRequest, success: string, refetch?: () => Promise<unknown>) {
    setNotice("");
    try {
      const hash = await writeContractAsync(request);
      await client?.waitForTransactionReceipt({ hash });
      if (refetch) await refetch();
      setNotice(success);
    } catch (error) {
      setNotice(shortError(error));
    }
  }

  async function updatePayout() {
    if (!isAddress(payoutInput)) return setNotice("Enter a valid payout wallet.");
    await send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "setPayoutRecipient", args: [getAddress(payoutInput)] }, "Primary payout wallet updated.", payout.refetch);
  }

  async function updateRoyalty() {
    const recipient = royaltyWallet || royaltyRecipient.data;
    if (royaltyPercent.trim() === "") return setNotice("Enter the new royalty percentage.");
    const bps = Math.round(Number(royaltyPercent) * 100);
    if (!recipient || !isAddress(recipient) || !Number.isInteger(bps) || bps < 0 || bps > 1000) return setNotice("Enter a valid royalty wallet and a percentage from 0 to 10.");
    await send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "setRoyalty", args: [getAddress(recipient), bps] }, "Royalty settings updated.", async () => { await royaltyRecipient.refetch(); await royaltyBps.refetch(); });
  }

  async function updateContractMetadata() {
    if (!validUri(contractUriInput)) return setNotice("Use an ipfs:// or https:// contract metadata URI.");
    await send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "setContractURI", args: [contractUriInput] }, "Collection metadata URI updated.", contractURI.refetch);
  }

  async function proposeOwnership() {
    if (!isAddress(newOwner) || getAddress(newOwner) === zeroAddress) return setNotice("Enter a valid new owner wallet.");
    await send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "proposeOwner", args: [getAddress(newOwner)] }, "Ownership transfer proposed. The new wallet must accept it.", pendingOwner.refetch);
  }

  async function updateController() {
    if (!isAddress(controller) || getAddress(controller) === zeroAddress) return setNotice("Enter a valid mint controller.");
    await send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "setMintController", args: [getAddress(controller), controllerAllowed] }, controllerAllowed ? "Mint controller authorized." : "Mint controller authorization removed.");
  }

  async function updateValidator() {
    if (!isAddress(validator)) return setNotice("Enter a validator address or the zero address to clear it.");
    await send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "setTransferValidator", args: [getAddress(validator)] }, getAddress(validator) === zeroAddress ? "Transfer validator cleared." : "Transfer validator updated.");
  }

  async function revealOrUpdatePFP() {
    if (!validUri(pfpUri)) return setNotice("Use an ipfs:// or https:// metadata base URI.");
    const request: WriteRequest = pfpRevealed.data
      ? { chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "setBaseURI", args: [pfpUri] }
      : { chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "reveal", args: [pfpUri, freezeOnReveal] };
    await send(request, pfpRevealed.data ? "PFP metadata base URI updated." : "PFP collection revealed.", async () => { await pfpRevealed.refetch(); await pfpMetadataFrozen.refetch(); });
  }

  async function updateEditionItem() {
    if (!validUri(itemUri)) return setNotice("Use an ipfs:// or https:// token metadata URI.");
    await send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "setTokenURI", args: [selectedTokenId, itemUri] }, `Token #${selectedTokenId} metadata updated.`);
  }

  async function updateEditionSupply() {
    if (!/^\d+$/.test(itemSupply) || BigInt(itemSupply) < 1n) return setNotice("Enter a valid lifetime supply.");
    await send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "setMaxSupply", args: [selectedTokenId, BigInt(itemSupply)] }, `Token #${selectedTokenId} supply updated.`, maxSupply.refetch);
  }

  async function uploadNewItemImage(file?: File) {
    if (!file) return;
    setUploading(true); setNotice("Uploading edition artwork…");
    try {
      const form = new FormData(); form.append("image", file);
      const response = await fetch("/api/pinata/image", { method: "POST", body: form });
      const data = await response.json() as { imageUri?: string; error?: string };
      if (!response.ok || !data.imageUri) throw new Error(data.error || "Artwork upload failed.");
      setNewItemImage(data.imageUri); setNotice("Edition artwork secured on IPFS.");
    } catch (error) { setNotice(shortError(error)); } finally { setUploading(false); }
  }

  async function createEditionItem() {
    const supply = /^\d+$/.test(newItemSupply) ? BigInt(newItemSupply) : 0n;
    const reserve = /^\d+$/.test(newItemReserve) ? BigInt(newItemReserve) : 0n;
    if (!newItemName.trim() || !newItemImage || supply === 0n || reserve > supply) return setNotice("Complete the edition name, artwork, supply and reserve.");
    try {
      setNotice("Preparing edition metadata…");
      const response = await fetch("/api/pinata/nft-metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: newItemName.trim(), symbol: item.symbol, description: "", image: newItemImage, supply: Number(supply),
        royaltyBps: Number(royaltyBps.data || 0), royaltyRecipient: royaltyRecipient.data || address
      }) });
      const data = await response.json() as { itemURI?: string; error?: string };
      if (!response.ok || !data.itemURI) throw new Error(data.error || "Edition metadata could not be prepared.");
      await send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "createItemWithReserve", args: [data.itemURI, supply, reserve] }, "New edition created.");
    } catch (error) { setNotice(shortError(error)); }
  }

  if (!isOwner && !canAcceptOwnership) return <section className="nft-phase-editor"><h3>Contract ownership</h3><p>The connected wallet is not the current or pending owner of this collection.</p></section>;

  return <section className="nft-collection-settings">
    <header><div><small>ONCHAIN COLLECTION SETTINGS</small><h2><Settings2/>Contract controls</h2><p>Manage payout, metadata, royalties, ownership and advanced collection permissions.</p></div></header>

    {canAcceptOwnership ? <article className="nft-phase-editor"><h3><UserRoundCog/>Accept ownership</h3><p>The current owner nominated this wallet. Acceptance completes the two-step transfer.</p><button className="button primary" disabled={isPending} onClick={() => void send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "acceptOwner" }, "Collection ownership accepted.", async () => { await owner.refetch(); await pendingOwner.refetch(); })}>Accept collection ownership</button></article> : null}

    {isOwner ? <div className="nft-manager-columns">
      <section>
        <h3><CircleIcon/>Revenue & royalty</h3>
        <div className="nft-phase-editor"><label>Primary payout wallet<small>Current: {payout.data || "Loading…"}</small><input placeholder="0x…" value={payoutInput} onChange={(event) => setPayoutInput(event.target.value)}/></label><button disabled={isPending} onClick={() => void updatePayout()}>Update payout wallet</button></div>
        <div className="nft-phase-editor"><label>Royalty recipient<small>Current: {royaltyRecipient.data || "Loading…"}</small><input placeholder="Leave empty to keep current" value={royaltyWallet} onChange={(event) => setRoyaltyWallet(event.target.value)}/></label><label>Royalty percentage<small>Current: {(Number(royaltyBps.data || 0) / 100).toFixed(2)}%</small><input min="0" max="10" step="0.1" placeholder="0–10" value={royaltyPercent} onChange={(event) => setRoyaltyPercent(event.target.value)}/></label><div><button disabled={Boolean(royaltyFrozen.data) || isPending} onClick={() => void updateRoyalty()}>Update royalty</button><button disabled={Boolean(royaltyFrozen.data) || isPending} onClick={() => confirmAction("Freeze royalty settings permanently?") && void send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "freezeRoyalty" }, "Royalty settings permanently frozen.", royaltyFrozen.refetch)}>Freeze royalty</button></div>{royaltyFrozen.data ? <p><LockKeyhole/>Royalty settings are permanently frozen.</p> : null}</div>
      </section>

      <section>
        <h3><FileKey2/>Collection metadata</h3>
        <div className="nft-phase-editor"><label>Contract metadata URI<small>Current: {shortUri(contractURI.data)}</small><input placeholder="ipfs://…" value={contractUriInput} onChange={(event) => setContractUriInput(event.target.value)}/></label><div><button disabled={Boolean(contractFrozen.data) || isPending} onClick={() => void updateContractMetadata()}>Update metadata</button><button disabled={Boolean(contractFrozen.data) || isPending} onClick={() => confirmAction("Freeze collection metadata permanently?") && void send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "freezeContractMetadata" }, "Collection metadata permanently frozen.", contractFrozen.refetch)}>Freeze permanently</button></div>{contractFrozen.data ? <p><LockKeyhole/>Collection metadata is permanently frozen.</p> : null}</div>
        <div className="nft-phase-editor"><label>New owner wallet<small>Pending: {pendingOwner.data === zeroAddress ? "None" : pendingOwner.data}</small><input placeholder="0x…" value={newOwner} onChange={(event) => setNewOwner(event.target.value)}/></label><button disabled={isPending} onClick={() => confirmAction("Propose transferring collection ownership to this wallet?") && void proposeOwnership()}>Propose ownership transfer</button></div>
      </section>
    </div> : null}

    {isOwner && isPFP ? <section className="nft-phase-editor"><h3><Eye/>PFP reveal & metadata</h3><p>{pfpRevealed.data ? "The collection is revealed. Update or permanently freeze its token metadata." : "Reveal with the metadataBaseURI from the launch manifest, or manage the placeholder and scheduled reveal."}</p>{!pfpRevealed.data ? <><label>Placeholder metadata URI<input placeholder="ipfs://…/placeholder.json" value={placeholderUri} onChange={(event) => setPlaceholderUri(event.target.value)}/></label><button disabled={!validUri(placeholderUri) || Boolean(pfpMetadataFrozen.data) || isPending} onClick={() => void send({ chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "setPlaceholderURI", args: [placeholderUri] }, "PFP placeholder metadata updated.")}>Update placeholder</button></> : null}<label>Metadata base URI<input placeholder="ipfs://…/bluefun/" value={pfpUri} onChange={(event) => setPfpUri(event.target.value)}/></label>{!pfpRevealed.data ? <label className="pfp-check"><input type="checkbox" checked={freezeOnReveal} onChange={(event) => setFreezeOnReveal(event.target.checked)}/><span>Freeze token metadata on reveal</span></label> : null}<div><button disabled={Boolean(pfpMetadataFrozen.data) || isPending} onClick={() => void revealOrUpdatePFP()}>{pfpRevealed.data ? "Update base URI" : "Reveal now"}</button><button disabled={!pfpRevealed.data || Boolean(pfpMetadataFrozen.data) || isPending} onClick={() => confirmAction("Freeze all PFP token metadata permanently?") && void send({ chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "freezeMetadata" }, "PFP metadata permanently frozen.", pfpMetadataFrozen.refetch)}>Freeze metadata</button>{scheduledReveal.data && scheduledReveal.data > 0n ? <button disabled={isPending} onClick={() => void send({ chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "cancelScheduledReveal" }, "Scheduled reveal cancelled.", scheduledReveal.refetch)}>Cancel scheduled reveal</button> : null}</div><label>Provenance hash<small>Can only change before the first mint.</small><input placeholder="0x…64 hex characters" value={provenance} onChange={(event) => setProvenance(event.target.value)}/></label><button disabled={!/^0x[a-fA-F0-9]{64}$/.test(provenance) || isPending} onClick={() => void send({ chainId: 8453, address: collection, abi: bluePFPAbi, functionName: "setProvenanceHash", args: [provenance as Hex] }, "Provenance hash updated.")}>Update provenance</button></section> : null}

    {isOwner && !isPFP ? <div className="nft-manager-columns">
      <section><h3><ImagePlus/>Create edition</h3><div className="nft-phase-editor"><label>Edition name<input value={newItemName} onChange={(event) => setNewItemName(event.target.value)}/></label><div className="nft-form-grid"><label>Lifetime supply<input min="1" value={newItemSupply} onChange={(event) => setNewItemSupply(event.target.value)}/></label><label>Creator reserve<input min="0" value={newItemReserve} onChange={(event) => setNewItemReserve(event.target.value)}/></label></div><label className="nft-upload"><ImagePlus/><span>{newItemImage ? "Artwork ready" : "Upload edition artwork"}</span><input hidden type="file" accept="image/*" onChange={(event) => void uploadNewItemImage(event.target.files?.[0])}/></label><button disabled={uploading || isPending} onClick={() => void createEditionItem()}>{uploading ? <Loader2 className="spin"/> : null}Create edition</button></div></section>
      <section><h3><BadgeCheck/>Edition item settings</h3><div className="nft-phase-editor"><label>Token ID<input min="1" value={tokenId} onChange={(event) => setTokenId(event.target.value)}/></label><label>Token metadata URI<input placeholder="ipfs://…" value={itemUri} onChange={(event) => setItemUri(event.target.value)}/></label><button disabled={Boolean(tokenFrozen.data) || isPending} onClick={() => void updateEditionItem()}>Update item metadata</button><label>Lifetime supply<small>Current: {String(maxSupply.data || 0n)}. It cannot increase after minting.</small><input min="1" value={itemSupply} onChange={(event) => setItemSupply(event.target.value)}/></label><div><button disabled={isPending} onClick={() => void updateEditionSupply()}>Update supply</button><button disabled={Boolean(tokenFrozen.data) || isPending} onClick={() => confirmAction(`Freeze token #${selectedTokenId} metadata permanently?`) && void send({ chainId: 8453, address: collection, abi: blueEditionAbi, functionName: "freezeTokenMetadata", args: [selectedTokenId] }, `Token #${selectedTokenId} metadata permanently frozen.`, tokenFrozen.refetch)}>Freeze item metadata</button></div></div></section>
    </div> : null}

    {isOwner ? <details className="nft-phase-editor"><summary><ShieldCheck/>Advanced permissions</summary><p>Only use audited controller and validator contracts. A malicious address can block transfers or alter future mint routing.</p><div className="nft-form-grid"><label>Mint controller<input placeholder="0x…" value={controller} onChange={(event) => setController(event.target.value)}/></label><label>Authorization<select value={controllerAllowed ? "allow" : "remove"} onChange={(event) => setControllerAllowed(event.target.value === "allow")}><option value="allow">Authorize</option><option value="remove">Remove</option></select></label></div><button disabled={isPending} onClick={() => confirmAction("Change this collection's mint-controller authorization?") && void updateController()}>Update mint controller</button><label>Transfer validator<input placeholder="0x… or zero address" value={validator} onChange={(event) => setValidator(event.target.value)}/></label><button disabled={isPending} onClick={() => confirmAction("Change the collection transfer validator?") && void updateValidator()}>Update transfer validator</button></details> : null}
    {notice ? <p className="nft-status">{isPending ? <Loader2 className="spin"/> : null}{notice}</p> : null}
  </section>;
}

function CircleIcon() { return <span><Settings2/></span>; }
function validUri(value: string) { return value.startsWith("ipfs://") || value.startsWith("https://"); }
function shortUri(value?: string) { return value ? value.length > 58 ? `${value.slice(0, 55)}…` : value : "Loading…"; }
function shortError(error: unknown) { return error instanceof Error ? error.message.split("Request Arguments:")[0].slice(0, 260) : "Transaction failed."; }
function confirmAction(message: string) { return typeof window !== "undefined" && window.confirm(message); }
