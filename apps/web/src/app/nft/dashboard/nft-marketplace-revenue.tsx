"use client";

import { useState } from "react";
import { formatEther } from "viem";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { ChevronDown, CircleDollarSign, Loader2, WalletCards } from "lucide-react";
import { legacyNftAddresses, nftAddresses, nftMarketplaceAbi, nftPFPMarketplaceAbi } from "@/lib/nft-contracts";

const markets = [
  { address: nftAddresses.marketplace, label: "Edition marketplace", standard: "ERC1155" as const },
  { address: nftAddresses.pfpMarketplace, label: "PFP marketplace", standard: "ERC721" as const },
  { address: legacyNftAddresses.marketplace, label: "Legacy edition marketplace", standard: "ERC1155" as const },
  { address: legacyNftAddresses.pfpMarketplace, label: "Legacy PFP marketplace", standard: "ERC721" as const }
];

export function NFTMarketplaceRevenue() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: 8453 });
  const { writeContractAsync, isPending } = useWriteContract();
  const [claiming, setClaiming] = useState(false);
  const [notice, setNotice] = useState("");
  const revenue = useReadContracts({
    contracts: markets.map((market) => ({
      address: market.address,
      abi: market.standard === "ERC721" ? nftPFPMarketplaceAbi : nftMarketplaceAbi,
      functionName: "pendingRevenue" as const,
      args: [address!] as const,
      chainId: 8453
    })),
    query: { enabled: Boolean(address) }
  });
  const amounts = markets.map((_, index) => revenue.data?.[index]?.status === "success" ? BigInt(revenue.data[index].result as bigint) : 0n);
  const total = amounts.reduce((sum, amount) => sum + amount, 0n);

  async function claim(index: number) {
    const market = markets[index];
    const hash = market.standard === "ERC721"
      ? await writeContractAsync({ chainId: 8453, address: market.address, abi: nftPFPMarketplaceAbi, functionName: "claimRevenue" })
      : await writeContractAsync({ chainId: 8453, address: market.address, abi: nftMarketplaceAbi, functionName: "claimRevenue" });
    await client?.waitForTransactionReceipt({ hash });
    await revenue.refetch();
  }

  async function claimAll() {
    setClaiming(true); setNotice("");
    try {
      for (let index = 0; index < amounts.length; index += 1) if (amounts[index] > 0n) await claim(index);
      setNotice("All available marketplace earnings were claimed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message.split("Request Arguments:")[0].slice(0, 220) : "Claim failed.");
    } finally { setClaiming(false); }
  }

  if (!address) return null;
  return <section className="nft-market-earnings">
    <div className="nft-market-earnings-icon"><WalletCards/></div>
    <div className="nft-market-earnings-copy"><small>MARKETPLACE EARNINGS</small><h3>{total > 0n ? `${formatEther(total)} ETH available` : "No earnings to claim"}</h3><p>Seller proceeds and royalties from BlueFun marketplace sales.</p></div>
    <button className="button primary" disabled={total === 0n || isPending || claiming} onClick={() => void claimAll()}>{claiming ? <Loader2 className="spin"/> : <CircleDollarSign/>}Claim all</button>
    <details><summary>View payout breakdown <ChevronDown/></summary><p>Marketplace earnings are accumulated per wallet across all of your BlueFun collections.</p><div>{markets.map((market, index) => <span key={market.address}><b>{market.label}</b><em>{formatEther(amounts[index])} ETH</em></span>)}</div></details>
    {notice ? <p className="nft-market-earnings-notice">{notice}</p> : null}
  </section>;
}
