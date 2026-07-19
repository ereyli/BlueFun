import { encodeAbiParameters, getAddress, isAddress, keccak256, parseEther, zeroAddress, type Address, type Hex } from "viem";

export type AllowlistInput = { wallet: Address; allowance: bigint; unitPrice: bigint };
export type AllowlistEntry = AllowlistInput & { leaf: Hex; proof: Hex[] };

export function parseAllowlistCSV(value: string, defaults?: { allowance?: bigint; unitPrice?: bigint }): AllowlistInput[] {
  const lines = value.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const delimiter = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const first = splitCSVLine(lines[0], delimiter).map((item) => item.trim().toLowerCase());
  const hasHeader = first.some((item) => ["wallet", "address", "allowance", "limit", "price", "price_eth"].includes(item));
  const headers = hasHeader ? first : ["wallet", "allowance", "price"];
  const walletIndex = Math.max(headers.indexOf("wallet"), headers.indexOf("address"));
  const allowanceIndex = Math.max(headers.indexOf("allowance"), headers.indexOf("limit"));
  const priceIndex = Math.max(headers.indexOf("price"), headers.indexOf("price_eth"));
  if (walletIndex < 0) throw new Error("CSV must include a wallet or address column.");
  const unique = new Map<string, AllowlistInput>();
  for (const [offset, line] of lines.slice(hasHeader ? 1 : 0).entries()) {
    const cells = splitCSVLine(line, delimiter).map((item) => item.trim());
    const walletValue = cells[walletIndex] || "";
    if (!isAddress(walletValue)) throw new Error(`Invalid wallet on CSV row ${offset + (hasHeader ? 2 : 1)}.`);
    const allowance = parsePositiveInteger(cells[allowanceIndex], defaults?.allowance ?? 1n, "allowance", offset, hasHeader);
    const unitPrice = parsePrice(cells[priceIndex], defaults?.unitPrice ?? 0n, offset, hasHeader);
    const wallet = getAddress(walletValue);
    if (unique.has(wallet.toLowerCase())) throw new Error(`Duplicate wallet: ${wallet}`);
    unique.set(wallet.toLowerCase(), { wallet, allowance, unitPrice });
  }
  if (unique.size > 10_000) throw new Error("Allowlist CSV supports at most 10,000 wallets.");
  return [...unique.values()];
}

export function buildAllowlistTree(inputs: AllowlistInput[], collection: Address, tokenId: bigint, phaseId: bigint, chainId = 8453n) {
  if (!inputs.length) throw new Error("Allowlist is empty.");
  const leaves = inputs.map((entry) => ({ ...entry, leaf: allowlistLeaf(entry, collection, tokenId, phaseId, chainId) }))
    .sort((a, b) => a.leaf.localeCompare(b.leaf));
  const levels: Hex[][] = [leaves.map((entry) => entry.leaf)];
  while (levels.at(-1)!.length > 1) {
    const row = levels.at(-1)!; const next: Hex[] = [];
    for (let index = 0; index < row.length; index += 2) next.push(hashPair(row[index], row[index + 1] ?? row[index]));
    levels.push(next);
  }
  const entries: AllowlistEntry[] = leaves.map((entry, index) => {
    const proof: Hex[] = []; let position = index;
    for (let level = 0; level < levels.length - 1; ++level) {
      const row = levels[level]; proof.push(row[position ^ 1] ?? row[position]); position = Math.floor(position / 2);
    }
    return { ...entry, proof };
  });
  return { root: levels.at(-1)![0], entries };
}

export function allowlistLeaf(entry: AllowlistInput, collection: Address, tokenId: bigint, phaseId: bigint, chainId = 8453n): Hex {
  const inner = keccak256(encodeAbiParameters(
    [{ type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }],
    [chainId, collection, tokenId, phaseId, entry.wallet, entry.allowance, entry.unitPrice, zeroAddress]
  ));
  return keccak256(inner);
}

function hashPair(a: Hex, b: Hex): Hex { return keccak256((a < b ? `${a}${b.slice(2)}` : `${b}${a.slice(2)}`) as Hex); }
function splitCSVLine(line: string, delimiter: string) {
  const values: string[] = []; let current = ""; let quoted = false;
  for (let index = 0; index < line.length; ++index) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) { current += '"'; ++index; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { values.push(current); current = ""; }
    else current += char;
  }
  values.push(current); return values;
}
function parsePositiveInteger(value: string | undefined, fallback: bigint, field: string, offset: number, hasHeader: boolean) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || BigInt(value) === 0n || BigInt(value) > 4_294_967_295n) throw new Error(`Invalid ${field} on CSV row ${offset + (hasHeader ? 2 : 1)}.`);
  return BigInt(value);
}
function parsePrice(value: string | undefined, fallback: bigint, offset: number, hasHeader: boolean) {
  if (!value) return fallback;
  try { const price = parseEther(value); if (price < 0n || price > 2n ** 128n - 1n) throw new Error(); return price; }
  catch { throw new Error(`Invalid ETH price on CSV row ${offset + (hasHeader ? 2 : 1)}.`); }
}
