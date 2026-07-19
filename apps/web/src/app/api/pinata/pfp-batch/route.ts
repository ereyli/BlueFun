import { randomInt } from "node:crypto";
import { NextResponse } from "next/server";
import { keccak256, toBytes } from "viem";
import { assertRateLimit, assertRequestSize, assertSameOrigin, RequestGuardError } from "@/lib/server/request-guard";
import { hasSupportedImageSignature } from "@/lib/server/image-validation";

export const runtime = "nodejs";
export const maxDuration = 300;

const FILE_ENDPOINT = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const JSON_ENDPOINT = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const MAX_ITEMS = 10_000;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_METADATA_BYTES = 25 * 1024 * 1024;
const MAX_METADATA_FILE_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_TOTAL_BYTES + MAX_METADATA_BYTES + 5 * 1024 * 1024;

type Trait = { trait_type: string; value: string | number };
type Item = { tokenId: number; name: string; description: string; imageName: string; externalUrl?: string; attributes: Trait[] };

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRequestSize(request, MAX_REQUEST_BYTES);
    await assertRateLimit(request, "pinata-pfp-batch");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Upload unavailable." },
      { status: error instanceof RequestGuardError ? error.status : 503 });
  }
  const jwt = process.env.PINATA_JWT;
  if (!jwt) return NextResponse.json({ error: "PFP uploads are not available right now." }, { status: 503 });

  try {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ClientError("Send the collection as multipart form data.");
    }
    const collectionName = clean(form.get("collectionName"), 64);
    const description = clean(form.get("description"), 1_000);
    const externalUrl = safeUrl(form.get("externalUrl"));
    const xUrl = safeUrl(form.get("xUrl"), ["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
    const telegramUrl = safeUrl(form.get("telegramUrl"), ["t.me", "telegram.me", "www.telegram.me"]);
    const royaltyBps = Math.min(1_000, Math.max(0, Number(form.get("royaltyBps") || 0)));
    const royaltyRecipient = clean(form.get("royaltyRecipient"), 42);
    const media = form.getAll("media").filter((value): value is File => value instanceof File);
    const metadataFiles = form.getAll("metadata").filter((value): value is File => value instanceof File);
    const placeholder = form.get("placeholder");
    const logo = form.get("logo");
    if (!collectionName || media.length === 0 || media.length > MAX_ITEMS) throw new ClientError("Add a collection name and between 1 and 10,000 media files.");
    if (!(placeholder instanceof File)) throw new ClientError("A pre-reveal image is required.");

    const metadataBytes = metadataFiles.reduce((sum, file) => sum + file.size, 0);
    if (metadataBytes > MAX_METADATA_BYTES || metadataFiles.some((file) => file.size > MAX_METADATA_FILE_BYTES)) {
      throw new ClientError("Metadata must stay under 25 MB total and 2 MB per file.");
    }
    if (logo && !(logo instanceof File)) throw new ClientError("Collection logo is invalid.");
    const allBytes = media.reduce((sum, file) => sum + file.size, placeholder.size + (logo instanceof File ? logo.size : 0));
    if (allBytes > MAX_TOTAL_BYTES) throw new ClientError("This upload exceeds the 250 MB BlueFun batch limit.");
    for (const file of [...media, placeholder, ...(logo instanceof File ? [logo] : [])]) {
      if (file.size === 0 || file.size > MAX_FILE_BYTES || !(await hasSupportedImageSignature(file))) {
        throw new ClientError(`${file.name || "Media"} is not a supported PNG, JPG, GIF or WEBP file under 15 MB.`);
      }
    }

    const normalizedMedia = media.map((file, index) => ({ file, name: safeMediaName(file.name, index + 1) }));
    if (new Set(normalizedMedia.map((entry) => entry.name.toLowerCase())).size !== normalizedMedia.length) {
      throw new ClientError("Some media filenames become duplicates after normalization. Rename those files and try again.");
    }
    const imageNames = new Set(normalizedMedia.map((entry) => entry.name));
    const items = await parseItems(metadataFiles, normalizedMedia.map((entry) => entry.name), collectionName, description);
    validateItems(items, imageNames);

    const imageCid = await pinFolder(jwt, `${collectionName}-media`, normalizedMedia.map(({ file, name }) => ({ file, name })));
    const normalizedItems = items.map((item) => ({
      name: item.name,
      description: item.description,
      image: `ipfs://${imageCid}/bluefun/${item.imageName}`,
      external_url: item.externalUrl || externalUrl || undefined,
      attributes: item.attributes
    }));
    if (form.get("shuffle") !== "false") secureShuffle(normalizedItems);
    const metadataFilesToPin = normalizedItems.map((item, index) => new File(
      [JSON.stringify(item)], String(index + 1), { type: "application/json" }
    ));
    const metadataCid = await pinFolder(jwt, `${collectionName}-metadata`, metadataFilesToPin.map((file) => ({ file, name: file.name })));

    const placeholderCid = await pinFile(jwt, `${collectionName}-pre-reveal`, placeholder, safeMediaName(placeholder.name, 1));
    const requestedLogoIndex = Math.floor(Number(form.get("logoArtworkIndex") || 0));
    const fallbackLogo = normalizedItems[randomInt(normalizedItems.length)].image;
    const selectedLogo = requestedLogoIndex >= 1 && requestedLogoIndex <= normalizedMedia.length ? `ipfs://${imageCid}/bluefun/${normalizedMedia[requestedLogoIndex - 1].name}` : fallbackLogo;
    const logoImage = logo instanceof File ? `ipfs://${await pinFile(jwt, `${collectionName}-logo`, logo, safeMediaName(logo.name, 1))}` : selectedLogo;
    const contractCid = await pinJSON(jwt, `${collectionName}-collection.json`, {
      name: collectionName, description, image: logoImage,
      external_link: externalUrl || undefined, seller_fee_basis_points: royaltyBps,
      socials: { website: externalUrl || undefined, x: xUrl || undefined, twitter: xUrl || undefined, telegram: telegramUrl || undefined },
      fee_recipient: royaltyRecipient
    });
    const provenanceHash = keccak256(toBytes(normalizedItems.map((item) => JSON.stringify(item)).join("")));
    return NextResponse.json({
      itemCount: items.length,
      imageBaseURI: `ipfs://${imageCid}/bluefun/`,
      metadataBaseURI: `ipfs://${metadataCid}/bluefun/`,
      placeholderURI: `ipfs://${placeholderCid}`,
      contractURI: `ipfs://${contractCid}`,
      provenanceHash,
      preview: normalizedItems.slice(0, 8)
    });
  } catch (error) {
    const clientError = error instanceof ClientError;
    return NextResponse.json({ error: clientError ? error.message : "PFP media and metadata could not be pinned. Please try again." }, { status: clientError ? 400 : 502 });
  }
}

async function parseItems(metadataFiles: File[], imageNames: string[], collectionName: string, description: string): Promise<Item[]> {
  if (metadataFiles.length === 0) return imageNames.map((imageName, index) => ({ tokenId: index + 1, name: `${collectionName} #${index + 1}`, description, imageName, attributes: [] }));
  if (metadataFiles.length === 1 && metadataFiles[0].name.toLowerCase().endsWith(".csv")) {
    return parseCsv(await metadataFiles[0].text(), imageNames, collectionName, description);
  }
  const parsed: Item[] = [];
  for (const file of metadataFiles) {
    if (!file.name.toLowerCase().endsWith(".json")) throw new ClientError("Metadata must be JSON files or one CSV file.");
    let value: unknown;
    try {
      value = JSON.parse(await file.text()) as unknown;
    } catch {
      throw new ClientError(`${file.name || "Metadata"} is not valid JSON.`);
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => parsed.push(normalizeItem(entry, index + 1, imageNames, collectionName, description)));
    } else {
      const fallbackId = Number(file.name.match(/(\d+)(?:\.json)?$/i)?.[1] || parsed.length + 1);
      parsed.push(normalizeItem(value, fallbackId, imageNames, collectionName, description));
    }
  }
  return parsed.sort((a, b) => a.tokenId - b.tokenId);
}

function normalizeItem(value: unknown, fallbackId: number, imageNames: string[], collectionName: string, fallbackDescription: string): Item {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const tokenId = positiveInt(row.token_id ?? row.tokenId ?? row.id ?? fallbackId);
  const imageName = matchImage(clean(row.image ?? row.file ?? row.filename, 180), imageNames, tokenId);
  return {
    tokenId, imageName,
    name: clean(row.name, 120) || `${collectionName} #${tokenId}`,
    description: clean(row.description, 2_000) || fallbackDescription,
    externalUrl: safeUrl(row.external_url ?? row.externalUrl),
    attributes: normalizeTraits(row.attributes)
  };
}

function parseCsv(source: string, imageNames: string[], collectionName: string, description: string): Item[] {
  const rows = csvRows(source);
  if (rows.length < 2) throw new ClientError("The metadata CSV is empty.");
  const headers = rows[0].map((value) => value.trim().toLowerCase());
  return rows.slice(1).filter((row) => row.some(Boolean)).map((row, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header, row[column] || ""]));
    const tokenId = positiveInt(record.token_id || record.tokenid || record.id || index + 1);
    const attributes = headers.filter((header) => header.startsWith("trait:") && record[header]).map((header) => ({ trait_type: header.slice(6).trim().slice(0, 80), value: record[header].slice(0, 160) }));
    return {
      tokenId,
      name: clean(record.name, 120) || `${collectionName} #${tokenId}`,
      description: clean(record.description, 2_000) || description,
      imageName: matchImage(clean(record.image || record.file || record.filename, 180), imageNames, tokenId),
      externalUrl: safeUrl(record.external_url || record.externalurl), attributes
    };
  }).sort((a, b) => a.tokenId - b.tokenId);
}

function validateItems(items: Item[], imageNames: Set<string>) {
  if (items.length === 0 || items.length > MAX_ITEMS) throw new ClientError("Metadata must contain between 1 and 10,000 NFT items.");
  const ids = new Set<number>();
  for (const item of items) {
    if (item.tokenId < 1 || item.tokenId > items.length || ids.has(item.tokenId)) throw new ClientError("Token IDs must be unique and contiguous from 1 to the collection supply.");
    if (!imageNames.has(item.imageName)) throw new ClientError(`No uploaded media matches token #${item.tokenId}.`);
    ids.add(item.tokenId);
  }
}

function matchImage(raw: string, imageNames: string[], tokenId: number) {
  const base = raw.split(/[\\/]/).pop() || "";
  const exact = imageNames.find((name) => name === base);
  if (exact) return exact;
  const byStem = imageNames.find((name) => name.replace(/\.[^.]+$/, "") === base.replace(/\.[^.]+$/, ""));
  if (byStem) return byStem;
  return imageNames[tokenId - 1] || "";
}

function normalizeTraits(value: unknown): Trait[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((trait) => {
    if (!trait || typeof trait !== "object") return [];
    const row = trait as Record<string, unknown>;
    const trait_type = clean(row.trait_type ?? row.type, 80);
    const raw = row.value;
    if (!trait_type || (typeof raw !== "string" && typeof raw !== "number")) return [];
    return [{ trait_type, value: typeof raw === "string" ? raw.slice(0, 160) : raw }];
  });
}

async function pinFolder(jwt: string, name: string, entries: Array<{ file: File; name: string }>) {
  const form = new FormData();
  entries.forEach(({ file, name: fileName }) => form.append("file", file, `bluefun/${fileName}`));
  form.append("pinataMetadata", JSON.stringify({ name }));
  form.append("pinataOptions", JSON.stringify({ wrapWithDirectory: true }));
  return (await pinataFetch<{ IpfsHash: string }>(FILE_ENDPOINT, jwt, form)).IpfsHash;
}

async function pinFile(jwt: string, name: string, file: File, fileName: string) {
  const form = new FormData(); form.append("file", file, fileName); form.append("pinataMetadata", JSON.stringify({ name }));
  return (await pinataFetch<{ IpfsHash: string }>(FILE_ENDPOINT, jwt, form)).IpfsHash;
}

async function pinJSON(jwt: string, name: string, content: object) {
  const response = await fetch(JSON_ENDPOINT, { method: "POST", signal: AbortSignal.timeout(45_000), headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ pinataContent: content, pinataMetadata: { name } }) });
  if (!response.ok) throw new Error("Pinata JSON upload failed");
  return ((await response.json()) as { IpfsHash: string }).IpfsHash;
}

async function pinataFetch<T>(url: string, jwt: string, body: FormData): Promise<T> {
  const response = await fetch(url, { method: "POST", signal: AbortSignal.timeout(240_000), headers: { Authorization: `Bearer ${jwt}` }, body });
  if (!response.ok) throw new Error("Pinata file upload failed");
  return await response.json() as T;
}

function csvRows(source: string) {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = 0; i < source.length; ++i) {
    const char = source[i];
    if (char === '"' && quoted && source[i + 1] === '"') { field += '"'; ++i; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field.trim()); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && source[i + 1] === "\n") ++i; row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (quoted) throw new ClientError("The metadata CSV contains an unclosed quoted field.");
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row); return rows;
}

function positiveInt(value: unknown) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ClientError("Every item needs a positive integer token ID."); return parsed; }
function secureShuffle<T>(items: T[]) { for (let index = items.length - 1; index > 0; --index) { const swap = randomInt(index + 1); [items[index], items[swap]] = [items[swap], items[index]]; } }
function clean(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function safeUrl(value: unknown, allowedHosts?: string[]) { const raw = clean(value, 240); if (!raw) return ""; try { const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); return url.protocol === "https:" && (!allowedHosts || allowedHosts.includes(url.hostname.toLowerCase())) ? url.toString() : ""; } catch { return ""; } }
function safeMediaName(name: string, fallback: number) { const base = name.split(/[\\/]/).pop() || `${fallback}.png`; return (base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-") || `${fallback}.png`).slice(0, 180); }
class ClientError extends Error {}
