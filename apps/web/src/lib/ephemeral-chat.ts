export type ChatMessage = {
  id: string;
  launchId: string;
  token: string;
  wallet: string;
  text: string;
  createdAt: number;
};

const MAX_MESSAGES_PER_TOKEN = 20;
const MESSAGE_TTL_MS = 4 * 60 * 60 * 1000;
const RATE_LIMIT_MS = 5_000;
const MAX_MESSAGE_LENGTH = 240;

type ChatStore = {
  messagesByToken: Map<string, ChatMessage[]>;
  lastPostByWalletToken: Map<string, number>;
};

const globalChat = globalThis as typeof globalThis & {
  __bluefunChatStore?: ChatStore;
};

const store = globalChat.__bluefunChatStore ??= {
  messagesByToken: new Map<string, ChatMessage[]>(),
  lastPostByWalletToken: new Map<string, number>()
};

export function listChatMessages(token: string) {
  const key = normalizeToken(token);
  pruneToken(key);
  return store.messagesByToken.get(key) ?? [];
}

export function addChatMessage(input: { launchId: string; token: string; wallet: string; text: string }) {
  const token = normalizeToken(input.token);
  const wallet = normalizeWallet(input.wallet);
  const text = normalizeMessage(input.text);
  const launchId = input.launchId.trim();

  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
    return { ok: false as const, status: 400, error: "Invalid token." };
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return { ok: false as const, status: 400, error: "Connect wallet to chat." };
  }
  if (!launchId || launchId.length > 32) {
    return { ok: false as const, status: 400, error: "Invalid market." };
  }
  if (!text) {
    return { ok: false as const, status: 400, error: "Message is empty." };
  }

  const now = Date.now();
  const rateKey = `${token}:${wallet}`;
  const lastPost = store.lastPostByWalletToken.get(rateKey) ?? 0;
  if (now - lastPost < RATE_LIMIT_MS) {
    return { ok: false as const, status: 429, error: "Please wait a few seconds before sending again." };
  }

  pruneToken(token);
  const message: ChatMessage = {
    id: `${now}-${wallet.slice(2, 10)}-${Math.random().toString(36).slice(2, 8)}`,
    launchId,
    token,
    wallet,
    text,
    createdAt: now
  };
  const next = [...(store.messagesByToken.get(token) ?? []), message].slice(-MAX_MESSAGES_PER_TOKEN);
  store.messagesByToken.set(token, next);
  store.lastPostByWalletToken.set(rateKey, now);
  return { ok: true as const, message };
}

function pruneToken(token: string) {
  const now = Date.now();
  const current = store.messagesByToken.get(token) ?? [];
  const fresh = current.filter((message) => now - message.createdAt <= MESSAGE_TTL_MS).slice(-MAX_MESSAGES_PER_TOKEN);
  if (fresh.length) {
    store.messagesByToken.set(token, fresh);
  } else {
    store.messagesByToken.delete(token);
  }
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function normalizeWallet(value: string) {
  return value.trim().toLowerCase();
}

function normalizeMessage(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}
