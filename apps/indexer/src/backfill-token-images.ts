import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { isBlueFunCdnUrl, mirrorTokenImage, readMetadataImage } from "./token-image-cdn.js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});
const { data, error } = await db.from("launches").select("scope,id,token,contract_uri,image_url").order("created_at", { ascending: false });
if (error) throw error;

const rows = (data || []).filter((row) => /^\d+:/.test(row.scope) && !isBlueFunCdnUrl(row.image_url));
let cursor = 0;
let mirrored = 0;
let skipped = 0;

async function worker() {
  while (cursor < rows.length) {
    const row = rows[cursor++];
    const imageUri = row.image_url || await readMetadataImage(row.contract_uri);
    if (!imageUri) {
      skipped += 1;
      continue;
    }
    const chainId = Number(row.scope.split(":", 1)[0]);
    try {
      const cdnUrl = await mirrorTokenImage(imageUri, chainId, row.token);
      if (!cdnUrl) {
        skipped += 1;
        continue;
      }
      const { error: updateError } = await db.from("launches")
        .update({ image_url: cdnUrl })
        .eq("scope", row.scope)
        .eq("id", row.id)
        .eq("token", row.token);
      if (updateError) throw updateError;
      mirrored += 1;
      console.log(`Mirrored ${chainId}:${row.id}`);
    } catch (cause) {
      skipped += 1;
      console.warn(`Could not mirror ${chainId}:${row.id}`, cause instanceof Error ? cause.message : cause);
    }
  }
}

await Promise.all(Array.from({ length: 3 }, worker));
console.log(`Image backfill complete: ${mirrored} mirrored, ${skipped} skipped.`);
