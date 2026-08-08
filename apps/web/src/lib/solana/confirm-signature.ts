import type { Connection } from "@solana/web3.js";

export async function confirmSolanaSignature(connection: Connection, signature: string, timeoutMs = 75_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = response.value[0];
    if (status?.err) throw new Error(`Solana transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return status;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error("Transaction was sent but confirmation timed out. Check it in Solscan before retrying.");
}
