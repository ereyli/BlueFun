import { File } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const baseUrl = process.env.BLUEFUN_URL || "http://localhost:3000";
const creator = process.env.NFT_CANARY_CREATOR;
if (!/^0x[a-fA-F0-9]{40}$/.test(creator || "")) throw new Error("NFT_CANARY_CREATOR is required.");

const outputDirectory = path.join(root, "artifacts", "nft-v3-canary-20260720");
await mkdir(outputDirectory, { recursive: true });

const edition = await jsonRequest("/api/pinata/nft-metadata", {
  name: "BlueFun V3 Edition Canary 1000",
  symbol: "BFV3E",
  description: "BlueFun V3 Base mainnet ERC-1155 canary validating launch, mint, atomic payouts, listings and WETH offers with a 1,000 edition lifetime supply.",
  image: "ipfs://QmSBPXLh5kX88rQWWq89Qw8c7cwxgcQxk5z2Sz993hXBSt",
  supply: 1000,
  royaltyBps: 500,
  royaltyRecipient: creator
});

const mediaPaths = [
  "artifacts/nft-canary-20260718/celestial-bird.png",
  "artifacts/nft-canary-20260718/tide-technomancer.png",
  "artifacts/nft-canary-20260718/orbital-fox.png"
];
const mediaFiles = await Promise.all(mediaPaths.map(fileFromPath));
const metadata = Array.from({ length: 1000 }, (_, index) => {
  const tokenId = index + 1;
  const family = ["Celestial Bird", "Tide Technomancer", "Orbital Fox"][index % 3];
  return {
    token_id: tokenId,
    name: `BlueFun V3 Pioneer #${tokenId}`,
    description: "BlueFun V3 Base mainnet PFP canary validating committed reveal, mint, atomic settlement, listings and WETH offers.",
    image: mediaFiles[index % mediaFiles.length].name,
    attributes: [
      { trait_type: "Family", value: family },
      { trait_type: "Protocol", value: "BlueFun NFT V3" },
      { trait_type: "Serial", value: tokenId }
    ]
  };
});

const pfpForm = new FormData();
pfpForm.set("collectionName", "BlueFun V3 Pioneers 1000");
pfpForm.set("description", "BlueFun V3 Base mainnet PFP canary with 1,000 committed metadata records.");
pfpForm.set("royaltyBps", "500");
pfpForm.set("royaltyRecipient", creator);
pfpForm.set("shuffle", "false");
for (const media of mediaFiles) pfpForm.append("media", media, media.name);
pfpForm.append("metadata", new File([JSON.stringify(metadata)], "metadata.json", { type: "application/json" }));
pfpForm.append("placeholder", mediaFiles[0], mediaFiles[0].name);
pfpForm.append("logo", mediaFiles[2], mediaFiles[2].name);

const pfpResponse = await fetch(`${baseUrl}/api/pinata/pfp-batch`, {
  method: "POST",
  headers: { origin: baseUrl },
  body: pfpForm
});
const pfp = await pfpResponse.json();
if (!pfpResponse.ok) throw new Error(`PFP metadata upload failed (${pfpResponse.status}): ${JSON.stringify(pfp)}`);

const result = { generatedAt: new Date().toISOString(), creator, edition, pfp };
await writeFile(path.join(outputDirectory, "metadata.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o644 });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

async function jsonRequest(route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${route} failed (${response.status}): ${JSON.stringify(result)}`);
  return result;
}

async function fileFromPath(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const data = await readFile(absolutePath);
  return new File([data], path.basename(relativePath), { type: "image/png" });
}
