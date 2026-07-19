"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEther, getAddress, isAddress, parseEther, zeroAddress, type Address, type Hex } from "viem";
import { usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { CalendarClock, CircleDollarSign, Gift, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { blueEditionAbi, bluePFPAbi, nftAddresses, nftDropControllerAbi } from "@/lib/nft-contracts";
import { buildAllowlistTree, parseAllowlistCSV } from "@/lib/nft-allowlist";

type Collection = { collection: string; name: string; symbol: string; standard: "ERC721" | "ERC1155" };
type Phase = { id: bigint; type: number; limitMode: number; price: bigint; start: bigint; end: bigint; cap: bigint; walletLimit: number; maxPerTx: number; root: Hex; minted: bigint; cancelled: boolean };
const zeroHash = `0x${"0".repeat(64)}` as Hex;

export function CreatorCollectionManager({ item, onClose }: { item: Collection; onClose: () => void }) {
  const collection = getAddress(item.collection); const tokenId = 1n; const client = usePublicClient({ chainId: 8453 }); const { writeContractAsync, isPending } = useWriteContract();
  const [phases, setPhases] = useState<Phase[]>([]); const [loading, setLoading] = useState(true); const [notice, setNotice] = useState(""); const [editing, setEditing] = useState<bigint>();
  const [kind, setKind] = useState<"public" | "allowlist">("public"); const [price, setPrice] = useState("0"); const [start, setStart] = useState(toLocal(Date.now() + 10 * 60_000)); const [end, setEnd] = useState(toLocal(Date.now() + 7 * 86400_000));
  const [cap, setCap] = useState("0"); const [limit, setLimit] = useState("2"); const [maxPerTx, setMaxPerTx] = useState("2"); const [csv, setCsv] = useState("");
  const [airdrop, setAirdrop] = useState(""); const [releaseAmount, setReleaseAmount] = useState(""); const [revealURI, setRevealURI] = useState(""); const [revealAt, setRevealAt] = useState("");
  const [revealReminder, setRevealReminder] = useState(false); const [revealDue, setRevealDue] = useState(false);
  const revenue = useReadContract({ address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "pendingCreatorRevenue", args: [collection], chainId: 8453 });
  const reserve = useReadContract({ address: collection, abi: item.standard === "ERC721" ? bluePFPAbi : blueEditionAbi, functionName: "creatorReserveRemaining", args: item.standard === "ERC721" ? [] : [tokenId], chainId: 8453 });
  const scheduledReveal = useReadContract({ address: collection, abi: bluePFPAbi, functionName: "scheduledRevealTime", chainId: 8453, query: { enabled: item.standard === "ERC721" } });
  const csvResult = useMemo(() => { try { return { entries: parseAllowlistCSV(csv, { allowance: BigInt(limit || 0), unitPrice: safeParseEther(price) }), error: "" }; } catch (error) { return { entries: [], error: shortError(error) }; } }, [csv, limit, price]);

  async function refresh() {
    if (!client) return; setLoading(true);
    try {
      const latest = await client.readContract({ address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "latestPhaseId", args: [collection, tokenId] });
      const rows = await Promise.all(Array.from({ length: Number(latest) }, async (_, index) => {
        const id = BigInt(index + 1); const [phase, minted] = await Promise.all([
          client.readContract({ address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "phases", args: [collection, tokenId, id] }),
          client.readContract({ address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "phaseMinted", args: [collection, tokenId, id] })
        ]);
        return { id, type: Number(phase[0]), limitMode: Number(phase[1]), price: phase[3], start: phase[4], end: phase[5], cap: phase[6], walletLimit: phase[7], maxPerTx: phase[8], root: phase[9], minted, cancelled: phase[11] } satisfies Phase;
      })); setPhases(rows);
    } catch (error) { setNotice(shortError(error)); } finally { setLoading(false); }
  }
  // The selected collection is the refresh boundary; refresh itself is intentionally recreated with the active clients.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, [collection]);
  useEffect(() => {
    const key = `bluefun:reveal-reminder:${collection.toLowerCase()}`;
    setRevealReminder(window.localStorage.getItem(key) === "enabled");
  }, [collection]);
  useEffect(() => {
    if (!revealReminder || !scheduledReveal.data) { setRevealDue(false); return; }
    const reminderKey = `bluefun:reveal-notified:${collection.toLowerCase()}:${scheduledReveal.data}`;
    const check = () => {
      const due = BigInt(Math.floor(Date.now() / 1000)) >= scheduledReveal.data!;
      setRevealDue(due);
      if (due && window.localStorage.getItem(reminderKey) !== "sent") {
        window.localStorage.setItem(reminderKey, "sent");
        setNotice("Scheduled reveal is ready to execute.");
        if ("Notification" in window && Notification.permission === "granted") new Notification(`${item.name} reveal is ready`, { body: "Open the BlueFun creator dashboard to execute the scheduled reveal." });
      }
    };
    check(); const timer = window.setInterval(check, 30_000); return () => window.clearInterval(timer);
  }, [collection, item.name, revealReminder, scheduledReveal.data]);

  function editPhase(phase: Phase) {
    setEditing(phase.id); setKind(phase.type === 1 ? "allowlist" : "public"); setPrice(formatEther(phase.price)); setStart(toLocal(Number(phase.start) * 1000)); setEnd(toLocal(Number(phase.end) * 1000)); setCap(String(phase.cap)); setLimit(String(phase.walletLimit || 2)); setMaxPerTx(String(phase.maxPerTx)); setCsv("");
  }
  function resetForm() { setEditing(undefined); setKind("public"); setPrice("0"); setCap("0"); setLimit("2"); setMaxPerTx("2"); setCsv(""); setStart(toLocal(Date.now() + 10 * 60_000)); setEnd(toLocal(Date.now() + 7 * 86400_000)); }

  async function savePhase() {
    if (!client) return;
    try {
      const phaseId = editing ?? BigInt(phases.length + 1); const startTime = BigInt(Math.floor(new Date(start).getTime() / 1000)); const endTime = BigInt(Math.floor(new Date(end).getTime() / 1000));
      if (startTime <= BigInt(Math.floor(Date.now()/1000)) || endTime <= startTime) throw new Error("Phase start must be in the future and end after start.");
      let root = zeroHash; let tree: ReturnType<typeof buildAllowlistTree> | undefined;
      if (kind === "allowlist") {
        if (csvResult.entries.length) { tree = buildAllowlistTree(csvResult.entries, collection, tokenId, phaseId); root = tree.root; }
        else if (editing) root = phases.find((phase) => phase.id === editing)?.root ?? zeroHash;
        if (root === zeroHash) throw new Error("Upload a wallet, allowance, price CSV for this phase.");
      }
      const config = { phaseType: kind === "allowlist" ? 1 : 0, limitMode: 0, currency: zeroAddress, mintPrice: kind === "public" ? parseEther(price || "0") : 0n, startTime, endTime, phaseSupplyCap: BigInt(cap || 0), defaultWalletLimit: kind === "public" ? Number(limit) : 0, maxPerTransaction: Number(maxPerTx), merkleRoot: root };
      const hash = editing
        ? await writeContractAsync({ chainId: 8453, address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "updatePhase", args: [collection, tokenId, editing, config] })
        : await writeContractAsync({ chainId: 8453, address: nftAddresses.dropController, abi: nftDropControllerAbi, functionName: "createPhase", args: [collection, tokenId, config] });
      await client.waitForTransactionReceipt({ hash });
      if (tree) await saveProofs(collection, tokenId, phaseId, tree);
      setNotice(editing ? "Phase updated." : "New mint phase created."); resetForm(); await refresh();
    } catch (error) { setNotice(shortError(error)); }
  }
  async function cancelPhase(id: bigint) { try { const hash = await writeContractAsync({ chainId:8453,address:nftAddresses.dropController,abi:nftDropControllerAbi,functionName:"cancelPhase",args:[collection,tokenId,id] }); await client?.waitForTransactionReceipt({hash});setNotice("Phase cancelled.");await refresh();}catch(error){setNotice(shortError(error));} }
  async function claim() { try { const hash=await writeContractAsync({chainId:8453,address:nftAddresses.dropController,abi:nftDropControllerAbi,functionName:"claimCreatorRevenue",args:[collection]});await client?.waitForTransactionReceipt({hash});await revenue.refetch();setNotice("Primary mint revenue claimed to the payout wallet.");}catch(error){setNotice(shortError(error));} }
  async function submitAirdrop() { try { const rows=airdrop.split(/\r?\n/).filter(Boolean).map((line)=>line.split(/[;,]/).map((value)=>value.trim()));if(!rows.length||rows.some(([wallet,qty])=>!isAddress(wallet)||!/^\d+$/.test(qty||"")||BigInt(qty)===0n))throw new Error("Use one wallet,quantity pair per line.");const recipients=rows.map(([wallet])=>getAddress(wallet));const quantities=rows.map(([,qty])=>BigInt(qty));const hash=item.standard==="ERC721"?await writeContractAsync({chainId:8453,address:collection,abi:bluePFPAbi,functionName:"airdrop",args:[recipients,quantities]}):await writeContractAsync({chainId:8453,address:collection,abi:blueEditionAbi,functionName:"airdrop",args:[tokenId,recipients,quantities]});await client?.waitForTransactionReceipt({hash});await reserve.refetch();setAirdrop("");setNotice("Reserve airdrop completed.");}catch(error){setNotice(shortError(error));} }
  async function releaseReserve(){try{const amount=BigInt(releaseAmount||0);if(amount<=0n)throw new Error("Enter a reserve amount.");const hash=item.standard==="ERC721"?await writeContractAsync({chainId:8453,address:collection,abi:bluePFPAbi,functionName:"releaseCreatorReserve",args:[amount]}):await writeContractAsync({chainId:8453,address:collection,abi:blueEditionAbi,functionName:"releaseCreatorReserve",args:[tokenId,amount]});await client?.waitForTransactionReceipt({hash});await reserve.refetch();setReleaseAmount("");setNotice("Reserve released to public mint supply.");}catch(error){setNotice(shortError(error));}}
  async function scheduleReveal(){try{const time=BigInt(Math.floor(new Date(revealAt).getTime()/1000));const hash=await writeContractAsync({chainId:8453,address:collection,abi:bluePFPAbi,functionName:"scheduleReveal",args:[revealURI,time,true]});await client?.waitForTransactionReceipt({hash});await scheduledReveal.refetch();setNotice("Reveal scheduled. Anyone can execute it after the deadline.");}catch(error){setNotice(shortError(error));}}
  async function executeReveal(){try{const hash=await writeContractAsync({chainId:8453,address:collection,abi:bluePFPAbi,functionName:"executeScheduledReveal"});await client?.waitForTransactionReceipt({hash});await scheduledReveal.refetch();setNotice("Collection revealed.");}catch(error){setNotice(shortError(error));}}
  async function toggleRevealReminder(){
    const key=`bluefun:reveal-reminder:${collection.toLowerCase()}`;
    if(revealReminder){window.localStorage.removeItem(key);setRevealReminder(false);setNotice("Reveal reminder disabled.");return;}
    window.localStorage.setItem(key,"enabled");setRevealReminder(true);
    if("Notification" in window&&Notification.permission==="default")await Notification.requestPermission();
    setNotice("Reveal reminder enabled on this browser.");
  }

  return <section className="nft-creator-manager">
    <header><div><small>CREATOR CONTROL</small><h2>{item.name}</h2><code>{collection}</code></div><button onClick={onClose}>Close</button></header>
    <div className="nft-manager-metrics"><article><CircleDollarSign/><span>Pending primary revenue</span><strong>{formatEther(revenue.data??0n)} ETH</strong><button disabled={!revenue.data||isPending} onClick={()=>void claim()}>Claim</button></article><article><Gift/><span>Creator reserve</span><strong>{String(reserve.data??0n)} NFTs</strong></article>{item.standard==="ERC721"?<article className={revealDue?"reveal-due":""}><CalendarClock/><span>Scheduled reveal</span><strong>{scheduledReveal.data?new Date(Number(scheduledReveal.data)*1000).toLocaleString():"Not scheduled"}</strong>{scheduledReveal.data?<button onClick={()=>void toggleRevealReminder()}>{revealReminder?"Disable reminder":"Remind me"}</button>:null}{scheduledReveal.data&&BigInt(Math.floor(Date.now()/1000))>=scheduledReveal.data?<button onClick={()=>void executeReveal()}>Execute reveal</button>:null}</article>:null}</div>
    <div className="nft-manager-columns"><section><h3>Mint phases</h3>{loading?<p><Loader2 className="spin"/>Loading phases…</p>:<div className="nft-phase-list">{phases.map((phase)=><article className={phase.cancelled?"cancelled":""} key={String(phase.id)}><div><b>{phase.type===1?"Allowlist":"Public"} #{String(phase.id)}</b><small>{new Date(Number(phase.start)*1000).toLocaleString()} → {new Date(Number(phase.end)*1000).toLocaleString()}</small><span>{formatEther(phase.price)} ETH · {String(phase.minted)} minted{phase.cancelled?" · Cancelled":""}</span></div>{!phase.cancelled&&phase.start>BigInt(Math.floor(Date.now()/1000))?<aside><button onClick={()=>editPhase(phase)}>Edit</button><button onClick={()=>void cancelPhase(phase.id)}><Trash2/></button></aside>:null}</article>)}</div>}
      <div className="nft-phase-editor"><h4>{editing?`Edit phase #${editing}`:"Add phase"}</h4><div className="nft-form-grid"><label>Access<select value={kind} onChange={(event)=>setKind(event.target.value as typeof kind)}><option value="public">Public</option><option value="allowlist">Allowlist CSV</option></select></label><label>Price (ETH)<input value={price} onChange={(event)=>setPrice(event.target.value)}/></label><label>Start<input type="datetime-local" value={start} onChange={(event)=>setStart(event.target.value)}/></label><label>End<input type="datetime-local" value={end} onChange={(event)=>setEnd(event.target.value)}/></label><label>Phase allocation<input value={cap} onChange={(event)=>setCap(event.target.value)}/></label><label>{kind==="public"?"Wallet limit":"Default CSV allowance"}<input value={limit} onChange={(event)=>setLimit(event.target.value)}/></label><label>Max per transaction<input value={maxPerTx} onChange={(event)=>setMaxPerTx(event.target.value)}/></label></div>{kind==="allowlist"?<label>Wallet, allowance, price CSV<textarea rows={5} value={csv} onChange={(event)=>setCsv(event.target.value)} placeholder={"wallet,allowance,price\n0x…,2,0.001"}/><input type="file" accept=".csv,text/csv" onChange={(event)=>{const file=event.target.files?.[0];if(file)void file.text().then(setCsv);}}/><small>{csvResult.error||`${csvResult.entries.length} wallets ready`}</small></label>:null}<div><button onClick={resetForm}>Reset</button><button className="button primary" disabled={isPending} onClick={()=>void savePhase()}><Plus/>{editing?"Save changes":"Create phase"}</button></div></div>
    </section><section><h3>Reserve & reveal</h3><label>Airdrop CSV <small>wallet, quantity</small><textarea rows={5} value={airdrop} onChange={(event)=>setAirdrop(event.target.value)} placeholder={"0x…,1"}/></label><button disabled={!airdrop||isPending} onClick={()=>void submitAirdrop()}><Gift/>Airdrop from reserve</button><div className="nft-inline-fields"><input placeholder="Reserve amount" value={releaseAmount} onChange={(event)=>setReleaseAmount(event.target.value)}/><button onClick={()=>void releaseReserve()}>Release to public supply</button></div>{item.standard==="ERC721"?<><hr/><h4>Reveal scheduler</h4><input placeholder="ipfs://metadata/" value={revealURI} onChange={(event)=>setRevealURI(event.target.value)}/><input type="datetime-local" value={revealAt} onChange={(event)=>setRevealAt(event.target.value)}/><button disabled={!revealURI||!revealAt||isPending} onClick={()=>void scheduleReveal()}><CalendarClock/>Schedule reveal</button><p className="nft-field-note">Enable a persistent browser reminder after scheduling. Reveal execution remains permissionless after the deadline.</p></>:null}</section></div>
    {notice?<p className="nft-status">{notice}</p>:null}<button className="nft-refresh" onClick={()=>void refresh()}><RefreshCw/>Refresh onchain state</button>
  </section>;
}

function toLocal(ms:number){const date=new Date(ms-dateOffset(ms));return date.toISOString().slice(0,16);}function dateOffset(ms:number){return new Date(ms).getTimezoneOffset()*60_000;}
function safeParseEther(value:string){try{return parseEther(value||"0");}catch{return 0n;}}function shortError(error:unknown){return error instanceof Error?error.message.split("Request Arguments:")[0].slice(0,260):"Operation failed.";}
async function saveProofs(collection:Address,tokenId:bigint,phaseId:bigint,tree:ReturnType<typeof buildAllowlistTree>){const response=await fetch("/api/nft/allowlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({collection,tokenId:String(tokenId),phaseId:String(phaseId),root:tree.root,entries:tree.entries.map((entry)=>({wallet:entry.wallet,allowance:String(entry.allowance),unitPrice:String(entry.unitPrice),proof:entry.proof}))})});if(!response.ok)throw new Error("Phase saved onchain, but proof storage failed. Reopen the phase and retry the CSV.");}
