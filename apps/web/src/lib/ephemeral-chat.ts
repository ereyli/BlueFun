import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { normalizeChatText } from "@/lib/chat-auth";

export type ChatMessage = { id: string; wallet: string; text: string; createdAt: number };

const MAX_MESSAGES_PER_TOKEN = 20;
const MESSAGE_TTL_MS = 4 * 60 * 60 * 1000;
const memory = new Map<string, ChatMessage[]>();
let pool: pg.Pool | undefined;
let supabase: SupabaseClient | undefined;

export async function listChatMessages(chainId: number, token: string): Promise<ChatMessage[]> {
  const scope = chatScope(chainId, token);
  const cutoff = new Date(Date.now() - MESSAGE_TTL_MS).toISOString();
  if (hasSupabaseConfig()) {
    const { data, error } = await getSupabase().from("chat_messages")
      .select("id, wallet, text, created_at")
      .eq("scope", scope)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(MAX_MESSAGES_PER_TOKEN);
    if (error) throw error;
    return (data ?? []).slice().reverse().map((row) => ({
      id: String(row.id), wallet: String(row.wallet), text: String(row.text), createdAt: Date.parse(String(row.created_at))
    }));
  }
  if (process.env.DATABASE_URL) {
    pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    const result = await pool.query(
      `select id, wallet, text, created_at from chat_messages
       where scope = $1 and created_at >= $2 order by created_at desc limit $3`,
      [scope, cutoff, MAX_MESSAGES_PER_TOKEN]
    );
    return result.rows.slice().reverse().map((row) => ({
      id: String(row.id), wallet: String(row.wallet), text: String(row.text), createdAt: new Date(row.created_at).getTime()
    }));
  }
  return pruneMemory(scope);
}

export async function addChatMessage(input: { chainId: number; launchId: string; token: string; wallet: string; text: string; signature: string }) {
  const text = normalizeChatText(input.text);
  if (!text) throw new Error("Message is empty.");
  const scope = chatScope(input.chainId, input.token);
  const message: ChatMessage = { id: createHash("sha256").update(input.signature).digest("hex"), wallet: input.wallet.toLowerCase(), text, createdAt: Date.now() };
  if (hasSupabaseConfig()) {
    await getSupabase().from("chat_messages").delete().lt("created_at", new Date(Date.now() - MESSAGE_TTL_MS).toISOString());
    const { error } = await getSupabase().from("chat_messages").insert({
      id: message.id,
      scope,
      chain_id: input.chainId,
      launch_id: input.launchId,
      token: input.token.toLowerCase(),
      wallet: message.wallet,
      text: message.text,
      created_at: new Date(message.createdAt).toISOString()
    });
    if (error) throw error;
    return message;
  }
  if (process.env.DATABASE_URL) {
    pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    await pool.query("delete from chat_messages where created_at < now() - interval '4 hours'");
    await pool.query(
      `insert into chat_messages (id, scope, chain_id, launch_id, token, wallet, text, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0))`,
      [message.id, scope, input.chainId, input.launchId, input.token.toLowerCase(), message.wallet, message.text, message.createdAt]
    );
    return message;
  }
  const current = pruneMemory(scope);
  if (current.some((item) => item.id === message.id)) throw new Error("Message was already submitted.");
  const next = [...current, message].slice(-MAX_MESSAGES_PER_TOKEN);
  memory.set(scope, next);
  return message;
}

function pruneMemory(scope: string) {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  const fresh = (memory.get(scope) ?? []).filter((message) => message.createdAt >= cutoff).slice(-MAX_MESSAGES_PER_TOKEN);
  if (fresh.length) memory.set(scope, fresh); else memory.delete(scope);
  return fresh;
}

function chatScope(chainId: number, token: string) {
  return `${chainId}:${token.toLowerCase()}`;
}

function hasSupabaseConfig() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabase() {
  supabase ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  return supabase;
}
