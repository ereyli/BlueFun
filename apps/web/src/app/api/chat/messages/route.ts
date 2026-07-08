import { NextResponse } from "next/server";
import { listChatMessages } from "@/lib/ephemeral-chat";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) {
    return NextResponse.json({ messages: [] });
  }
  return NextResponse.json({ messages: listChatMessages(token) });
}
