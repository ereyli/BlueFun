"use client";

import { useEffect, useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { CheckCircle2, ExternalLink, Loader2 } from "@/components/bluefun-icons";
import { DexProviderIcon } from "@/components/dex-provider-icon";
import { NetworkIcon } from "@/components/network-icon";
import type { DeployedLaunch } from "@/lib/onchain-launches";

export function SolanaMarket({ launch }: { launch: DeployedLaunch }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote>();
  const [tokenBalance, setTokenBalance] = useState(0n);
  const [solBalance, setSolBalance] = useState(0n);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signature, setSignature] = useState("");
  const mint = useMemo(() => new PublicKey(launch.token), [launch.token]);
  const pool = useMemo(() => new PublicKey(launch.liquidityLocker!), [launch.liquidityLocker]);
  const cpAmm = useMemo(() => new CpAmm(connection), [connection]);
  const amountRaw = useMemo(() => parseNineDecimals(amount), [amount]);

  // The refresh routine is intentionally keyed to wallet and mint changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refreshBalances(); }, [wallet.publicKey, mint, connection]);
  useEffect(() => {
    setQuote(undefined);
    setError("");
    if (amountRaw <= 0n) return;
    const timer = window.setTimeout(() => void loadQuote(), 250);
    return () => window.clearTimeout(timer);
  // Quote inputs fully determine the request; keeping the routine itself out
  // avoids a render-to-render polling loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountRaw, side, pool, mint, connection]);

  async function refreshBalances() {
    if (!wallet.publicKey) { setTokenBalance(0n); setSolBalance(0n); return; }
    const [sol, token] = await Promise.all([
      connection.getBalance(wallet.publicKey, "confirmed"),
      connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, wallet.publicKey), "confirmed").catch(() => undefined)
    ]);
    setSolBalance(BigInt(sol));
    setTokenBalance(BigInt(token?.value.amount || "0"));
  }

  async function loadQuote() {
    try {
      const poolState = await cpAmm.fetchPoolState(pool);
      const currentSlot = await connection.getSlot("confirmed");
      const inputMint = side === "buy" ? NATIVE_MINT : mint;
      const result = cpAmm.getQuote({
        inAmount: new BN(amountRaw.toString()), inputTokenMint: inputMint, slippage: 0.02,
        poolState, currentTime: Math.floor(Date.now() / 1_000), currentSlot,
        tokenADecimal: 9, tokenBDecimal: 9
      });
      setQuote({ output: BigInt(result.swapOutAmount.toString()), minimum: result.minSwapOutAmount, poolState });
    } catch (quoteError) {
      setError(quoteError instanceof Error ? quoteError.message : "A live Meteora quote is not available.");
    }
  }

  async function swap() {
    if (!wallet.publicKey || !wallet.sendTransaction || !quote || busy) return;
    if (side === "buy" && amountRaw >= solBalance) { setError("Not enough SOL after reserving network fees."); return; }
    if (side === "sell" && amountRaw > tokenBalance) { setError("Insufficient token balance."); return; }
    setBusy(true); setError(""); setSignature("");
    try {
      const inputMint = side === "buy" ? NATIVE_MINT : mint;
      const outputMint = side === "buy" ? mint : NATIVE_MINT;
      const tx = await cpAmm.swap({
        payer: wallet.publicKey, pool, inputTokenMint: inputMint, outputTokenMint: outputMint,
        amountIn: new BN(amountRaw.toString()), minimumAmountOut: quote.minimum,
        tokenAMint: quote.poolState.tokenAMint, tokenBMint: quote.poolState.tokenBMint,
        tokenAVault: quote.poolState.tokenAVault, tokenBVault: quote.poolState.tokenBVault,
        tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID,
        referralTokenAccount: null, poolState: quote.poolState
      });
      const sent = await wallet.sendTransaction(tx, connection, { skipPreflight: false, maxRetries: 4 });
      const confirmation = await connection.confirmTransaction(sent, "confirmed");
      if (confirmation.value.err) throw new Error(`Swap failed: ${JSON.stringify(confirmation.value.err)}`);
      setSignature(sent); setAmount(""); setQuote(undefined);
      await refreshBalances();
    } catch (swapError) {
      const message = swapError instanceof Error ? swapError.message : "Swap failed.";
      setError(/reject|denied|cancel/i.test(message) ? "Request cancelled in wallet." : message);
    } finally { setBusy(false); }
  }

  const insufficient = side === "buy" ? amountRaw >= solBalance : amountRaw > tokenBalance;
  return <main className="solana-market-shell">
    <section className="solana-market-summary">
      <div className="solana-market-art">{launch.imageURI ? <img alt={`${launch.name} logo`} src={ipfsUrl(launch.imageURI)} /> : <NetworkIcon chainId={101} size={40} />}</div>
      <div><span className="launch-network-chip"><NetworkIcon chainId={101} size={16} />Solana · <DexProviderIcon provider="meteora" size={16} /> Meteora</span><h1>{launch.name} <small>${launch.symbol}</small></h1><p>{launch.description || "A fixed-supply BlueFun Direct market on Solana."}</p></div>
      <div className="solana-market-links"><a href={`https://solscan.io/token/${launch.token}`} rel="noreferrer" target="_blank">Token <ExternalLink size={13} /></a><a href={`https://app.meteora.ag/dammv2/${launch.liquidityLocker}`} rel="noreferrer" target="_blank">Pool <ExternalLink size={13} /></a></div>
    </section>
    <section className="solana-swap-card">
      <header><div><h2>Swap</h2><span>1% total fee · LP permanently locked</span></div><DexProviderIcon provider="meteora" size={34} /></header>
      <div className="solana-swap-tabs"><button className={side === "buy" ? "active buy" : ""} onClick={() => setSide("buy")} type="button">Buy ${launch.symbol}</button><button className={side === "sell" ? "active sell" : ""} onClick={() => setSide("sell")} type="button">Sell</button></div>
      <div className="solana-amount-card"><label>{side === "buy" ? "YOU PAY" : "YOU SELL"}<span>Balance {formatNine(side === "buy" ? solBalance : tokenBalance)}</span></label><div><input inputMode="decimal" placeholder="0" value={amount} onChange={(event) => setAmount(sanitize(event.target.value))} /><strong>{side === "buy" ? "SOL" : launch.symbol}</strong></div>{side === "sell" ? <div className="solana-percent-row">{[25, 50, 75, 100].map((percent) => <button key={percent} onClick={() => setAmount(formatNine(tokenBalance * BigInt(percent) / 100n, 9))} type="button">{percent === 100 ? "Max" : `${percent}%`}</button>)}</div> : null}</div>
      <div className="solana-amount-card output"><label>YOU RECEIVE</label><div><strong className="solana-quote">{quote ? formatNine(quote.output) : "–"}</strong><strong>{side === "buy" ? launch.symbol : "SOL"}</strong></div><small>Minimum {quote ? formatNine(BigInt(quote.minimum.toString())) : "–"} · 2% slippage</small></div>
      {error ? <p className="launch-notice danger">{error}</p> : null}{signature ? <p className="launch-notice success"><CheckCircle2 size={15} />Swap confirmed. <a href={`https://solscan.io/tx/${signature}`} rel="noreferrer" target="_blank">View transaction</a></p> : null}
      <button className={`button primary wide solana-swap-submit ${side}`} disabled={!wallet.publicKey || !quote || amountRaw <= 0n || insufficient || busy} onClick={() => void swap()} type="button">{busy ? <Loader2 className="spin" size={17} /> : null}{!wallet.publicKey ? "Connect Solana wallet" : insufficient ? "Insufficient balance" : busy ? "Confirming swap" : `${side === "buy" ? "Buy" : "Sell"} $${launch.symbol}`}</button>
    </section>
  </main>;
}

type Quote = { output: bigint; minimum: BN; poolState: Awaited<ReturnType<CpAmm["fetchPoolState"]>> };
function parseNineDecimals(value: string) { const [whole = "0", decimals = ""] = (value || "0").split("."); return BigInt(whole || "0") * 1_000_000_000n + BigInt(decimals.padEnd(9, "0").slice(0, 9) || "0"); }
function formatNine(value: bigint, digits = 4) { const whole = value / 1_000_000_000n; const fraction = (value % 1_000_000_000n).toString().padStart(9, "0").slice(0, digits).replace(/0+$/, ""); return fraction ? `${whole}.${fraction}` : whole.toString(); }
function sanitize(value: string) { const clean = value.replace(",", ".").replace(/[^0-9.]/g, ""); const [whole, ...fraction] = clean.split("."); return fraction.length ? `${whole}.${fraction.join("").slice(0, 9)}` : whole; }
function ipfsUrl(uri: string) { return uri.startsWith("ipfs://") ? `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}` : uri; }
