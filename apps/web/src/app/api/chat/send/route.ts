import { NextResponse } from "next/server";
import { addChatMessage } from "@/lib/ephemeral-chat";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const body = payload as Partial<{ launchId: string; token: string; wallet: string; text: string }>;
  const result = addChatMessage({
    launchId: body.launchId || "",
    token: body.token || "",
    wallet: body.wallet || "",
    text: body.text || ""
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ message: result.message });
}
