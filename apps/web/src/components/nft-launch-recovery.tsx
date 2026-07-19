"use client";

import { useEffect, useState } from "react";
import { getAddress, parseEther, zeroAddress, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { RefreshCw, X } from "lucide-react";
import { nftAddresses, nftDropControllerAbi } from "@/lib/nft-contracts";
import { buildAllowlistTree, type AllowlistInput } from "@/lib/nft-allowlist";

export type LaunchRecovery = {
  version: 1; kind: "edition" | "pfp"; wallet: Address; collection: Address; name: string; mode: "public" | "allowlist" | "both";
  allowlist?: { start: string; end: string; cap: string; maxPerTx: number; entries: Array<{ wallet: Address; allowance: string; unitPrice: string }> };
  public?: { start: string; end: string; cap: string; maxPerTx: number; walletLimit: number; price: string; cumulative: boolean };
};

const prefix = "bluefun:nft-launch-recovery:";
export function saveLaunchRecovery(value: LaunchRecovery) { localStorage.setItem(`${prefix}${value.wallet.toLowerCase()}:${value.kind}`, JSON.stringify(value)); }
export function clearLaunchRecovery(wallet: Address, kind: LaunchRecovery["kind"]) { localStorage.removeItem(`${prefix}${wallet.toLowerCase()}:${kind}`); }

export function NFTLaunchRecoveryPanel({ kind }: { kind: LaunchRecovery["kind"] }) {
  const { address } = useAccount(); const client = usePublicClient({ chainId: 8453 }); const { writeContractAsync, isPending } = useWriteContract();
  const [record, setRecord] = useState<LaunchRecovery>(); const [notice, setNotice] = useState("");
  useEffect(() => { if (!address) return setRecord(undefined); const raw=localStorage.getItem(`${prefix}${address.toLowerCase()}:${kind}`);try{setRecord(raw?JSON.parse(raw):undefined);}catch{setRecord(undefined);} }, [address,kind]);
  if (!record || !address) return null;
  async function resume() {
    if (!client || !record) return;
    const wallet = address;
    if (!wallet) return;
    try {
      let latest = await client.readContract({address:nftAddresses.dropController,abi:nftDropControllerAbi,functionName:"latestPhaseId",args:[record.collection,1n]});
      if (record.allowlist) {
        const phaseId = 1n; const inputs:AllowlistInput[]=record.allowlist.entries.map((entry)=>({wallet:getAddress(entry.wallet),allowance:BigInt(entry.allowance),unitPrice:BigInt(entry.unitPrice)}));const tree=buildAllowlistTree(inputs,record.collection,1n,phaseId);
        if(latest===0n){const hash=await writeContractAsync({chainId:8453,address:nftAddresses.dropController,abi:nftDropControllerAbi,functionName:"createPhase",args:[record.collection,1n,{phaseType:1,limitMode:0,currency:zeroAddress,mintPrice:0n,startTime:BigInt(record.allowlist.start),endTime:BigInt(record.allowlist.end),phaseSupplyCap:BigInt(record.allowlist.cap),defaultWalletLimit:0,maxPerTransaction:record.allowlist.maxPerTx,merkleRoot:tree.root}]});await client.waitForTransactionReceipt({hash});latest=1n;}
        await saveProofs(record.collection,1n,phaseId,tree);
      }
      if(record.public&&latest<(record.allowlist?2n:1n)){const hash=await writeContractAsync({chainId:8453,address:nftAddresses.dropController,abi:nftDropControllerAbi,functionName:"createPhase",args:[record.collection,1n,{phaseType:0,limitMode:record.public.cumulative?1:0,currency:zeroAddress,mintPrice:parseEther(record.public.price),startTime:BigInt(record.public.start),endTime:BigInt(record.public.end),phaseSupplyCap:BigInt(record.public.cap),defaultWalletLimit:record.public.walletLimit,maxPerTransaction:record.public.maxPerTx,merkleRoot:`0x${"0".repeat(64)}`}]});await client.waitForTransactionReceipt({hash});}
      clearLaunchRecovery(wallet,kind);setRecord(undefined);setNotice("Launch recovered successfully.");
    }catch(error){setNotice(error instanceof Error?error.message.split("Request Arguments:")[0].slice(0,260):"Recovery failed.");}
  }
  return <section className="nft-launch-recovery"><RefreshCw/><div><strong>Unfinished launch found</strong><span>{record.name} · {record.collection}</span><small>The collection is deployed. Continue only the missing phase/proof steps without paying another launch fee.</small>{notice?<p>{notice}</p>:null}</div><button className="button primary" disabled={isPending} onClick={()=>void resume()}>Resume launch</button><button aria-label="Dismiss recovery" onClick={()=>{clearLaunchRecovery(address,kind);setRecord(undefined);}}><X/></button></section>;
}
async function saveProofs(collection:Address,tokenId:bigint,phaseId:bigint,tree:ReturnType<typeof buildAllowlistTree>){const response=await fetch("/api/nft/allowlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({collection,tokenId:String(tokenId),phaseId:String(phaseId),root:tree.root,entries:tree.entries.map((entry)=>({wallet:entry.wallet,allowance:String(entry.allowance),unitPrice:String(entry.unitPrice),proof:entry.proof}))})});if(!response.ok)throw new Error("Proof storage is still unavailable; the onchain phase was not duplicated.");}
