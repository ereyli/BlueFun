import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getDbLaunchPage, getDbLaunches } from "@/lib/db-launches";
import { getDeployedLaunches } from "@/lib/onchain-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";

export const runtime = "nodejs";

type ShareLaunch = {
  chainId: number;
  launchMode?: "bond" | "direct";
  token: string;
  creator: string;
  name: string;
  symbol: string;
  description?: string;
  imageURI?: string;
  marketCap: string;
  volume: string;
  status: string;
  risk: string;
};

const NETWORKS = {
  8453: { name: "BASE", symbol: "ETH", accent: "#315cff", glow: "#244ee8", icon: "/networks/base.svg" },
  4663: { name: "ROBINHOOD", symbol: "ETH", accent: "#b7ef33", glow: "#6d9e09", icon: "/networks/robinhood.svg" },
  143: { name: "MONAD", symbol: "MON", accent: "#8b7cff", glow: "#6253df", icon: "/networks/monad.svg" },
  988: { name: "STABLE", symbol: "USDT0", accent: "#55dfb4", glow: "#158d70", icon: "/networks/stable.svg" },
  5042: { name: "ARC", symbol: "USDC", accent: "#ffffff", glow: "#1b3158", icon: "/networks/arc.svg" }
} as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const chainId = Number(url.searchParams.get("chain"));
  const token = url.searchParams.get("token") || "";
  const network = NETWORKS[chainId as keyof typeof NETWORKS];
  if (!network || !/^0x[a-fA-F0-9]{40}$/.test(token)) {
    return new Response("Invalid token", { status: 400 });
  }

  const launch = await getShareLaunch(chainId, token);
  if (!launch) return new Response("Token not found", { status: 404 });

  const [tokenImage, networkIcon, brandIcon] = await Promise.all([
    shareImageDataUrl(launch.imageURI, request.url, 520),
    shareImageDataUrl(network.icon, request.url, 96),
    shareImageDataUrl("/brand/bluelogo.webp", request.url, 96)
  ]);
  const story = shareStory(launch.description, launch.name, launch.symbol);
  const mode = launch.launchMode === "direct" ? "DIRECT DEX" : launch.status === "Graduated" ? "DEX LIVE" : "BOND CURVE";
  const liquidity = launch.launchMode === "direct" || launch.status === "Graduated" ? "LP LOCKED" : "FAIR LAUNCH";
  const shortToken = `${launch.token.slice(0, 8)}…${launch.token.slice(-6)}`;

  return new ImageResponse(
    <div style={{
      backgroundColor: "#07090d",
      backgroundImage: `radial-gradient(circle at 14% 12%, ${network.glow}55 0, transparent 35%), radial-gradient(circle at 92% 80%, ${network.glow}30 0, transparent 36%)`,
      color: "#f7f8fb",
      display: "flex",
      fontFamily: "Arial, sans-serif",
      height: "100%",
      overflow: "hidden",
      padding: 42,
      position: "relative",
      width: "100%"
    }}>
      <div style={{ border: `1px solid ${network.accent}42`, borderRadius: 34, display: "flex", height: "100%", overflow: "hidden", position: "relative", width: "100%" }}>
        <div style={{ background: `linear-gradient(145deg, ${network.glow}45, #0b0f17 70%)`, display: "flex", padding: 34, position: "relative", width: 416 }}>
          <div style={{ border: `1px solid ${network.accent}45`, borderRadius: 28, display: "flex", height: "100%", overflow: "hidden", position: "relative", width: "100%" }}>
            {tokenImage
              ? <img alt="" height="430" src={tokenImage} style={{ height: "100%", objectFit: "cover", width: "100%" }} width="340"/>
              : <div style={{ alignItems: "center", background: "#101521", color: network.accent, display: "flex", fontSize: 88, fontWeight: 900, justifyContent: "center", width: "100%" }}>{launch.symbol.slice(0, 3)}</div>}
            <div style={{ background: "linear-gradient(transparent 45%, rgba(3,5,9,.9))", bottom: 0, display: "flex", height: 170, left: 0, position: "absolute", width: "100%" }}/>
            <div style={{ alignItems: "center", bottom: 20, display: "flex", left: 20, position: "absolute" }}>
              <div style={{ alignItems: "center", background: "#080b10dd", border: `1px solid ${network.accent}66`, borderRadius: 99, display: "flex", height: 46, justifyContent: "center", marginRight: 10, width: 46 }}>
                {networkIcon ? <img alt="" height="27" src={networkIcon} width="27"/> : null}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ color: network.accent, fontSize: 13, fontWeight: 900, letterSpacing: 2 }}>{network.name}</div>
                <div style={{ color: "#8d99ad", display: "flex", fontSize: 11, fontWeight: 700, marginTop: 4 }}>CHAIN ID {chainId}</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, flexDirection: "column", padding: "34px 38px 30px" }}>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
            <div style={{ alignItems: "center", display: "flex" }}>
              <div style={{ alignItems: "center", background: "#121722", border: "1px solid #293142", borderRadius: 11, display: "flex", height: 42, justifyContent: "center", marginRight: 12, overflow: "hidden", width: 42 }}>
                {brandIcon ? <img alt="" height="42" src={brandIcon} width="42"/> : <div style={{ color: "#7795ff", fontSize: 20, fontWeight: 900 }}>B</div>}
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: -.5 }}>BlueFun</div>
                <div style={{ color: "#778399", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, marginTop: 3 }}>ONCHAIN LAUNCH DESK</div>
              </div>
            </div>
            <div style={{ alignItems: "center", background: `${network.accent}12`, border: `1px solid ${network.accent}50`, borderRadius: 99, color: network.accent, display: "flex", fontSize: 11, fontWeight: 900, letterSpacing: 1.4, padding: "10px 15px" }}>
              <div style={{ background: network.accent, borderRadius: 99, height: 7, marginRight: 9, width: 7 }}/>
              LIVE ONCHAIN
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: 38 }}>
            <div style={{ color: network.accent, display: "flex", fontSize: 17, fontWeight: 900, letterSpacing: 2.2 }}>${launch.symbol}</div>
            <div style={{ fontSize: launch.name.length > 28 ? 48 : 58, fontWeight: 900, letterSpacing: -3, lineHeight: 1, marginTop: 10 }}>{launch.name}</div>
            <div style={{ color: "#99a5b8", display: "flex", fontSize: 16, lineHeight: 1.42, marginTop: 20, maxWidth: 650 }}>{story}</div>
          </div>

          <div style={{ display: "flex", marginTop: 24 }}>
            <ShareBadge accent={network.accent} value={mode}/>
            <ShareBadge accent={network.accent} value={liquidity}/>
            <ShareBadge accent={network.accent} value={launch.risk.toUpperCase().includes("LOCK") ? "VERIFIED ROUTE" : "ONCHAIN"}/>
          </div>

          <div style={{ borderTop: "1px solid #262d39", display: "flex", marginTop: "auto", paddingTop: 22 }}>
            <ShareStat label="MARKET CAP" value={launch.marketCap}/>
            <ShareStat label="VOLUME" value={launch.volume}/>
            <ShareStat label="CONTRACT" value={shortToken}/>
          </div>
        </div>
      </div>
      <div style={{ background: network.accent, bottom: 42, display: "flex", height: 4, left: 450, position: "absolute", width: 84 }}/>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control": "public, max-age=10, s-maxage=30, stale-while-revalidate=120",
        "content-disposition": `inline; filename="${safeFileName(launch.symbol)}-bluefun-share.png"`
      }
    }
  );
}

async function getShareLaunch(chainId: number, token: string): Promise<ShareLaunch | undefined> {
  const indexed = await getDbLaunchPage(chainId, { query: token, pageSize: 21 }).catch(() => undefined);
  const indexedMatch = indexed?.launches.find((item) => item.token.toLowerCase() === token.toLowerCase());
  if (indexedMatch) return indexedMatch;

  const launches = chainId === 4663
    ? await getRobinhoodLaunches().catch(() => [])
    : chainId === 143 || chainId === 988 || chainId === 5042
      ? await getDbLaunches(chainId).then((items) => items ?? []).catch(() => [])
      : await getDeployedLaunches().catch(() => []);
  return launches.find((item) => item.token.toLowerCase() === token.toLowerCase());
}

function ShareBadge({ accent, value }: { accent: string; value: string }) {
  return <div style={{ background: "#11161f", border: `1px solid ${accent}38`, borderRadius: 8, color: "#bec7d5", display: "flex", fontSize: 10, fontWeight: 900, letterSpacing: 1.2, marginRight: 9, padding: "8px 11px" }}>{value}</div>;
}

function ShareStat({ label, value }: { label: string; value: string }) {
  const size = value.length > 20 ? 15 : value.length > 13 ? 19 : 24;
  return <div style={{ display: "flex", flex: 1, flexDirection: "column", minWidth: 0 }}>
    <div style={{ color: "#68758b", fontSize: 10, fontWeight: 900, letterSpacing: 1.5 }}>{label}</div>
    <div style={{ color: "#f4f6fa", fontSize: size, fontWeight: 850, marginTop: 8, whiteSpace: "nowrap" }}>{value}</div>
  </div>;
}

function shareStory(description: string | undefined, name: string, symbol: string) {
  const fallback = `${name} ($${symbol}) is live on BlueFun with verifiable onchain launch data.`;
  const clean = (description || fallback).replace(/\s+/g, " ").trim();
  if (clean.length <= 225) return clean;
  const shortened = clean.slice(0, 222);
  const boundary = shortened.lastIndexOf(" ");
  return `${shortened.slice(0, boundary > 170 ? boundary : 222)}…`;
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 20) || "token";
}

async function shareImageDataUrl(value: string | undefined, requestUrl: string, size: number) {
  if (!value) return "";
  try {
    const localAsset = value === "/brand/bluelogo.webp" || value.startsWith("/networks/");
    const input = localAsset
      ? await readPublicShareAsset(value)
      : await fetchShareImage(value, requestUrl);
    if (input.byteLength > 6 * 1024 * 1024) return "";
    const png = await sharp(input, { limitInputPixels: 24_000_000 })
      .rotate()
      .resize(size, size, { fit: "cover" })
      .png({ compressionLevel: 8 })
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return "";
  }
}

async function readPublicShareAsset(value: string) {
  const assetPath = value.replace(/^\//, "");
  const candidates = [
    path.join(process.cwd(), "apps/web/public", assetPath),
    path.join(process.cwd(), "public", assetPath)
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function fetchShareImage(value: string, requestUrl: string) {
  const normalized = value.startsWith("ipfs://")
    ? `https://gateway.pinata.cloud/ipfs/${value.slice(7)}`
    : new URL(value, requestUrl).toString();
  const response = await fetch(normalized, { next: { revalidate: 300 } });
  if (!response.ok) throw new Error("Image request failed");
  const declared = Number(response.headers.get("content-length") || "0");
  if (declared > 6 * 1024 * 1024) throw new Error("Image is too large");
  return Buffer.from(await response.arrayBuffer());
}
