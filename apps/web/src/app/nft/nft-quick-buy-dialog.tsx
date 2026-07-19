"use client";

import { useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { nftMarketplaceAbi, nftPFPMarketplaceAbi, isKnownNFTMarketplace } from "@/lib/nft-contracts";
import { NFTCommerceDialog } from "./nft-commerce-dialog";

export type NFTQuickBuyItem = {
  collection: `0x${string}`;
  collectionName: string;
  image?: string;
  listingId: string;
  marketplace: `0x${string}`;
  remaining: string;
  standard: "ERC721" | "ERC1155";
  title: string;
  tokenId: string;
  unitPrice: string;
};

export function NFTQuickBuyDialog({
  item,
  onClose,
  onPurchased
}: {
  item?: NFTQuickBuyItem;
  onClose: () => void;
  onPurchased: (item: NFTQuickBuyItem) => void;
}) {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient({ chainId: 8453 });
  const { writeContractAsync } = useWriteContract();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");

  if (!item) return null;
  const selected = item;

  async function confirm() {
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }
    if (!publicClient || !isKnownNFTMarketplace(selected.marketplace, selected.standard)) {
      setNotice("This listing is not from a verified BlueFun marketplace.");
      return;
    }
    try {
      setPending(true);
      setNotice("Confirm the purchase in your wallet…");
      const listingId = BigInt(selected.listingId);
      const unitPrice = BigInt(selected.unitPrice);
      const hash = selected.standard === "ERC721"
        ? await writeContractAsync({
            chainId: 8453,
            address: selected.marketplace,
            abi: nftPFPMarketplaceAbi,
            functionName: "buy",
            value: unitPrice,
            args: [listingId, address]
          })
        : await writeContractAsync({
            chainId: 8453,
            address: selected.marketplace,
            abi: nftMarketplaceAbi,
            functionName: "buy",
            value: unitPrice,
            args: [listingId, 1n, address]
          });
      setNotice("Purchase submitted. Waiting for Base confirmation…");
      await publicClient.waitForTransactionReceipt({ hash });
      onPurchased(selected);
      onClose();
    } catch (error) {
      setNotice(shortError(error));
    } finally {
      setPending(false);
    }
  }

  return <>
    <NFTCommerceDialog
      kind="buy"
      title={item.title}
      collectionName={item.collectionName}
      image={item.image}
      unitPrice={BigInt(item.unitPrice)}
      quantity={1n}
      platformFeeBps={80n}
      royaltyBps={0n}
      pending={pending}
      confirmLabel={!isConnected ? "Connect wallet" : undefined}
      onClose={onClose}
      onConfirm={() => void confirm()}
    />
    {notice ? <div className="nft-transaction-toast" role="status">{notice}</div> : null}
  </>;
}

function shortError(error: unknown) {
  return error instanceof Error
    ? error.message.split("Request Arguments:")[0].slice(0, 220)
    : "Purchase failed. Please try again.";
}
