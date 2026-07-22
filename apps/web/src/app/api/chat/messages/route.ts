import { NextResponse } from "next/server";
import { listChatMessages } from "@/lib/ephemeral-chat";
import { chainIdFromParam } from "@/lib/chain-slug";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") || "";
  const chainParam = searchParams.get("chain");
  const chainId = chainIdFromParam(chainParam);
  if (!/^0x[a-fA-F0-9]{40}$/.test(token) || !chainParam || !["base", "robinhood", "monad", "8453", "4663", "143"].includes(chainParam.toLowerCase())) {
    return NextResponse.json({ messages: [] });
  }
  try {
    return NextResponse.json({ messages: await listChatMessages(chainId, token) });
  } catch {
    return NextResponse.json({ messages: [] }, { status: 503 });
  }
}
