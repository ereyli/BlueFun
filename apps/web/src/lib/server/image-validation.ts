import sharp from "sharp";

const signatures = [
  [0x89, 0x50, 0x4e, 0x47],
  [0xff, 0xd8, 0xff],
  [0x47, 0x49, 0x46, 0x38],
  [0x52, 0x49, 0x46, 0x46]
];

export async function hasSupportedImageSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return signatures.some((signature) => signature.every((value, index) => bytes[index] === value));
}

export async function optimizeTokenImage(file: File) {
  const input = Buffer.from(await file.arrayBuffer());
  const output = await sharp(input, { limitInputPixels: 20_000_000 })
    .rotate()
    .resize(768, 768, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer();
  return new File([new Uint8Array(output)], `${safeStem(file.name)}.webp`, { type: "image/webp" });
}

function safeStem(name: string) {
  return (name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-") || "token-image").slice(0, 80);
}

export function isSafeIpfsUri(value: string) {
  return /^ipfs:\/\/[a-zA-Z0-9]+(?:\/[a-zA-Z0-9._~!$&'()*+,;=:@%/-]*)?$/.test(value);
}
