"use client";

import { formatEther } from "viem";
import { useAccount, usePublicClient, useReadContracts, useWriteContract } from "wagmi";
import { CircleDollarSign, Loader2 } from "lucide-react";
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

  if (!address) return null;
  return <section className="nft-directory-panel nft-dashboard-panel nft-market-revenue">
    <header><div><span><CircleDollarSign/>MARKETPLACE PAYOUTS</span><h2>Seller proceeds & royalties</h2><p>BlueFun fixed-price sales are pull-based. Claim every pending ETH balance from its marketplace.</p></div><strong>{formatEther(total)} ETH</strong></header>
    <div className="nft-dashboard-list">
      {markets.map((market, index) => <div className="nft-dashboard-row" key={market.address}><span className="nft-dashboard-thumb"><CircleDollarSign/></span><span><strong>{market.label}</strong><small>{market.standard} · {formatEther(amounts[index])} ETH claimable</small></span><button className="button" disabled={amounts[index] === 0n || isPending} onClick={() => void claim(index)}>{isPending ? <Loader2 className="spin"/> : null}Claim</button></div>)}
    </div>
  </section>;
}
