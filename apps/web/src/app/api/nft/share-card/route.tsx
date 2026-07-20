import { ImageResponse } from "next/og";
import { formatEther, getAddress, isAddress } from "viem";
import sharp from "sharp";
import { getNFTCollections } from "@/lib/nft-collections";

export const runtime = "nodejs";

type ShareSummary = {
  floorPrice?: string | null;
  totalVolume?: string;
  owners?: number;
  listed?: number;
};

export async function GET(request: Request) {
  const collectionValue = new URL(request.url).searchParams.get("collection") || "";
  if (!isAddress(collectionValue)) return new Response("Invalid collection", { status: 400 });
  const collection = getAddress(collectionValue);
  const summary = (await getNFTCollections(200)).find((item) => item.address.toLowerCase() === collection.toLowerCase());
  if (!summary) return new Response("Collection not found", { status: 404 });

  const activityUrl = new URL("/api/nft/activity", request.url);
  activityUrl.searchParams.set("collection", collection);
  const listingUrl = new URL("/api/nft/listing", request.url);
  listingUrl.searchParams.set("collection", collection);
  listingUrl.searchParams.set("limit", "2000");
  const [activity, listingPayload] = await Promise.all([
    fetch(activityUrl, { next: { revalidate: 15 } }).then((response) => response.ok ? response.json() : undefined).catch(() => undefined) as Promise<{ summary?: ShareSummary } | undefined>,
    fetch(listingUrl, { next: { revalidate: 5 } }).then((response) => response.ok ? response.json() : undefined).catch(() => undefined) as Promise<{ listings?: Array<{ unitPrice?: string }> } | undefined>
  ]);
  const listings = Array.isArray(listingPayload?.listings) ? listingPayload.listings : [];
  const listingFloor = listings.reduce<string | null>((floor, listing) => {
    if (!listing.unitPrice || !/^\d+$/.test(listing.unitPrice)) return floor;
    return floor === null || BigInt(listing.unitPrice) < BigInt(floor) ? listing.unitPrice : floor;
  }, null);
  const market = { ...(activity?.summary || {}), floorPrice: listingFloor, listed: listings.length };
  const image = await shareImageDataUrl(summary.imageUrl, request.url);
  const floor = market.floorPrice ? `${formatWei(market.floorPrice)} ETH` : "—";
  const volume = `${formatWei(market.totalVolume || "0")} ETH`;
  const minted = Number(summary.initialMinted).toLocaleString("en-US");
  const supply = Number(summary.initialSupply).toLocaleString("en-US");
  const date = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(new Date()).toUpperCase();

  return new ImageResponse(
    <div style={{ alignItems: "stretch", background: "#07090d", color: "#f7f8fb", display: "flex", flexDirection: "column", fontFamily: "Arial, sans-serif", height: "100%", padding: 48, width: "100%" }}>
      <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
        <div style={{ alignItems: "center", display: "flex", fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>
          <div style={{ alignItems: "center", background: "#315cff", borderRadius: 12, display: "flex", height: 42, justifyContent: "center", marginRight: 14, width: 42 }}>B</div>
          BLUEFUN NFT
        </div>
        <div style={{ alignItems: "center", color: "#72e3c2", display: "flex", fontSize: 17, fontWeight: 800, letterSpacing: 2 }}>
          <div style={{ background: "#54d9b4", borderRadius: 99, height: 9, marginRight: 10, width: 9 }}/>
          {summary.status.toUpperCase()} · BASE
        </div>
      </div>
      <div style={{ alignItems: "flex-end", display: "flex", flex: 1, padding: "40px 0 32px" }}>
        <div style={{ alignItems: "center", background: "#0c1220", border: "2px solid #25324a", borderRadius: 22, display: "flex", height: 180, justifyContent: "center", marginRight: 30, overflow: "hidden", width: 180 }}>
          {image ? <img alt="" height="180" src={image} style={{ height: "100%", objectFit: "cover", width: "100%" }} width="180"/> : <div style={{ color: "#7795f5", fontSize: 64 }}>◆</div>}
        </div>
        <div style={{ display: "flex", flex: 1, flexDirection: "column", minWidth: 0 }}>
          <div style={{ color: "#7184a6", display: "flex", fontSize: 16, fontWeight: 800, letterSpacing: 2 }}>
            BY {summary.creator.slice(2, 8).toUpperCase()} · {summary.standard} · {date}
          </div>
          <div style={{ fontSize: summary.name.length > 32 ? 48 : 62, fontWeight: 850, letterSpacing: -3, lineHeight: 1.02, marginTop: 13, maxWidth: 850 }}>{summary.name}</div>
          <div style={{ color: "#8fa0bd", display: "flex", fontSize: 18, marginTop: 18 }}>
            {summary.symbol} · {minted} / {supply} MINTED · {summary.royaltyPercent}% ROYALTY
          </div>
        </div>
      </div>
      <div style={{ borderTop: "2px solid #222a39", display: "flex", paddingTop: 28 }}>
        <ShareCardStat label="FLOOR PRICE" value={floor}/>
        <ShareCardStat label="TOTAL VOLUME" value={volume}/>
        <ShareCardStat label="OWNERS" value={String(market.owners || 0)}/>
        <ShareCardStat label="ACTIVE LISTINGS" value={String(market.listed || 0)}/>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: { "cache-control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120" }
    }
  );
}

function ShareCardStat({ label, value }: { label: string; value: string }) {
  return <div style={{ display: "flex", flex: 1, flexDirection: "column" }}><div style={{ color: "#76849c", fontSize: 15, fontWeight: 800, letterSpacing: 2 }}>{label}</div><div style={{ fontSize: 28, fontWeight: 800, marginTop: 9 }}>{value}</div></div>;
}

function formatWei(value: string) {
  try {
    return Number(formatEther(BigInt(value))).toLocaleString("en-US", { maximumFractionDigits: 4 });
  } catch {
    return "0";
  }
}

async function shareImageDataUrl(value: string | undefined, requestUrl: string) {
  if (!value) return "";
  try {
    const response = await fetch(new URL(value, requestUrl), { next: { revalidate: 300 } });
    if (!response.ok) return "";
    const declared = Number(response.headers.get("content-length") || "0");
    if (declared > 6 * 1024 * 1024) return "";
    const input = Buffer.from(await response.arrayBuffer());
    if (input.byteLength > 6 * 1024 * 1024) return "";
    const png = await sharp(input, { limitInputPixels: 20_000_000 }).rotate().resize(360, 360, { fit: "cover" }).png({ compressionLevel: 8 }).toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return "";
  }
}
