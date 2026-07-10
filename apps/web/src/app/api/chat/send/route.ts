import { NextResponse } from "next/server";
import { addChatMessage } from "@/lib/ephemeral-chat";
import { recoverMessageAddress } from "viem";
import { chatMessageToSign, normalizeChatText } from "@/lib/chat-auth";
import { getDeployedLaunch } from "@/lib/onchain-launches";
import { getRobinhoodLaunch } from "@/lib/robinhood-launches";
import { assertRateLimit, assertSameOrigin, RequestGuardError } from "@/lib/server/request-guard";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertRateLimit(request, "community-chat");
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Request could not be accepted." },
      { status: error instanceof RequestGuardError ? error.status : 503 }
    );
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const body = payload as Partial<{ chainId: number; launchId: string; token: string; wallet: string; text: string; timestamp: number; signature: `0x${string}` }>;
  const chainId = Number(body.chainId);
  const launchId = String(body.launchId || "");
  const token = String(body.token || "");
  const wallet = String(body.wallet || "").toLowerCase();
  const text = normalizeChatText(String(body.text || ""));
  const timestamp = Number(body.timestamp);
  if ((chainId !== 8453 && chainId !== 4663) || !/^\d{1,32}$/.test(launchId) || !/^0x[a-fA-F0-9]{40}$/.test(token) || !/^0x[a-fA-F0-9]{40}$/.test(wallet) || !text || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 120_000 || !body.signature) {
    return NextResponse.json({ error: "Invalid signed message." }, { status: 400 });
  }
  const launch = chainId === 4663
    ? await getRobinhoodLaunch(launchId)
    : await getDeployedLaunch(launchId);
  if (!launch || launch.token.toLowerCase() !== token.toLowerCase()) {
    return NextResponse.json({ error: "Market could not be verified." }, { status: 400 });
  }
  let recovered: `0x${string}`;
  try {
    recovered = await recoverMessageAddress({
      message: chatMessageToSign({ chainId, launchId, token, text, timestamp }),
      signature: body.signature
    });
  } catch {
    return NextResponse.json({ error: "Signed message could not be verified." }, { status: 401 });
  }
  if (recovered.toLowerCase() !== wallet) return NextResponse.json({ error: "Wallet signature does not match." }, { status: 401 });
  try {
    const message = await addChatMessage({ chainId, launchId, token, wallet, text, signature: body.signature });
    return NextResponse.json({ message });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Message store is unavailable." }, { status: 503 });
  }
}
