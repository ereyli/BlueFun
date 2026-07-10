import { NextResponse } from "next/server";
import { listChatMessages } from "@/lib/ephemeral-chat";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") || "";
  const chainId = Number(searchParams.get("chain"));
  if (!/^0x[a-fA-F0-9]{40}$/.test(token) || (chainId !== 8453 && chainId !== 4663)) {
    return NextResponse.json({ messages: [] });
  }
  try {
    return NextResponse.json({ messages: await listChatMessages(chainId, token) });
  } catch {
    return NextResponse.json({ messages: [] }, { status: 503 });
  }
}
