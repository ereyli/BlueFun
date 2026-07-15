"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, CheckCircle2, Clock3, Coins, ExternalLink, LoaderCircle, LockKeyhole, RotateCcw } from "lucide-react";
import { formatEther, maxUint256, parseEther, zeroAddress } from "viem";
import { useAccount, useChainId, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { baseChain } from "@/lib/base-chain";
import { blueStakingAddresses } from "@/lib/contracts";

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }
] as const;

const vaultAbi = [
  { type: "function", name: "activeBalanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "coolingBalanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "cooldownEnd", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "earned", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalActiveStake", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "periodFinish", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint64" }] },
  { type: "function", name: "stakingIsPaused", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "emergencyExitEnabled", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "stake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "requestUnstake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "cancelUnstake", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }], outputs: [{ name: "amount", type: "uint256" }] },
  { type: "function", name: "emergencyWithdraw", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }], outputs: [{ name: "amount", type: "uint256" }] },
  { type: "function", name: "claimReward", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }], outputs: [{ name: "amount", type: "uint256" }] }
] as const;

const compact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3, notation: "compact" });

function tokenAmount(value: bigint) {
  const parsed = Number(formatEther(value));
  return Number.isFinite(parsed) ? compact.format(parsed) : "—";
}

function readableError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Transaction failed.";
  return message.split("\n")[0].replace("User rejected the request.", "Transaction cancelled.").slice(0, 180);
}

function remainingTime(unlockAt: bigint, now: number) {
  const seconds = Math.max(0, Number(unlockAt) - now);
  if (!seconds) return "Ready";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days ? `${days}d ${hours}h` : `${hours}h`;
}

export function BlueStakingPanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: baseChain.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const account = address ?? zeroAddress;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const reads = useReadContracts({
    contracts: [
      { address: blueStakingAddresses.token, abi: erc20Abi, functionName: "balanceOf", args: [account], chainId: baseChain.id },
      { address: blueStakingAddresses.token, abi: erc20Abi, functionName: "allowance", args: [account, blueStakingAddresses.vault], chainId: baseChain.id },
      { address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "activeBalanceOf", args: [account], chainId: baseChain.id },
      { address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "coolingBalanceOf", args: [account], chainId: baseChain.id },
      { address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "cooldownEnd", args: [account], chainId: baseChain.id },
      { address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "earned", args: [account], chainId: baseChain.id },
      { address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "totalActiveStake", chainId: baseChain.id },
      { address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "periodFinish", chainId: baseChain.id },
      { address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "stakingIsPaused", chainId: baseChain.id },
      { address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "emergencyExitEnabled", chainId: baseChain.id }
    ],
    query: { enabled: isConnected, refetchInterval: 20_000 }
  });

  const values = useMemo(() => reads.data?.map((entry) => entry.status === "success" ? entry.result : undefined) ?? [], [reads.data]);
  const walletBalance = (values[0] as bigint | undefined) ?? 0n;
  const allowance = (values[1] as bigint | undefined) ?? 0n;
  const active = (values[2] as bigint | undefined) ?? 0n;
  const cooling = (values[3] as bigint | undefined) ?? 0n;
  const cooldownEnd = (values[4] as bigint | undefined) ?? 0n;
  const earned = (values[5] as bigint | undefined) ?? 0n;
  const totalStaked = (values[6] as bigint | undefined) ?? 0n;
  const periodFinish = (values[7] as bigint | undefined) ?? 0n;
  const paused = (values[8] as boolean | undefined) ?? false;
  const emergency = (values[9] as boolean | undefined) ?? false;
  const unlockReady = cooling > 0n && cooldownEnd <= BigInt(now);

  const prepare = async () => {
    if (!address) throw new Error("Connect a wallet first.");
    if (chainId !== baseChain.id) await switchChainAsync({ chainId: baseChain.id });
    if (!publicClient) throw new Error("Base RPC is unavailable.");
    setFailure(null);
    setNotice(null);
    return address;
  };

  const confirm = async (hash: `0x${string}`) => {
    if (!publicClient) throw new Error("Base RPC is unavailable.");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Transaction reverted.");
  };

  const transact = async (key: string, action: (recipient: `0x${string}`) => Promise<void>, success: string) => {
    setBusy(key);
    try {
      const recipient = await prepare();
      await action(recipient);
      await reads.refetch();
      setNotice(success);
    } catch (reason) {
      setFailure(readableError(reason));
    } finally {
      setBusy(null);
    }
  };

  const parsedAmount = () => {
    const value = parseEther(amount || "0");
    if (value <= 0n) throw new Error("Enter a BLUE amount.");
    return value;
  };

  const stake = () => transact("stake", async () => {
    const value = parsedAmount();
    if (value > walletBalance) throw new Error("Insufficient BLUE balance.");
    if (allowance < value) {
      const approval = await writeContractAsync({ address: blueStakingAddresses.token, abi: erc20Abi, functionName: "approve", args: [blueStakingAddresses.vault, maxUint256], chainId: baseChain.id });
      await confirm(approval);
    }
    const hash = await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "stake", args: [value], chainId: baseChain.id });
    await confirm(hash);
    setAmount("");
  }, "BLUE staked. Rewards begin accruing now.");

  const requestUnstake = () => transact("unstake", async () => {
    const value = parsedAmount();
    if (value > active) throw new Error("Amount exceeds your active stake.");
    const hash = await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "requestUnstake", args: [value], chainId: baseChain.id });
    await confirm(hash);
    setAmount("");
  }, "30-day unstake countdown started.");

  const simpleAction = (key: string, functionName: "cancelUnstake" | "withdraw" | "emergencyWithdraw" | "claimReward", success: string) => transact(key, async (recipient) => {
    const hash = functionName === "cancelUnstake"
      ? await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName, args: [], chainId: baseChain.id })
      : functionName === "withdraw"
        ? await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName, args: [recipient], chainId: baseChain.id })
        : functionName === "emergencyWithdraw"
          ? await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName, args: [recipient], chainId: baseChain.id })
          : await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName, args: [recipient], chainId: baseChain.id });
    await confirm(hash);
  }, success);

  return <section className="blue-staking-card" id="staking">
    <header className="blue-staking-heading">
      <div><span><Coins size={14} />BLUE staking</span><h2>Lock BLUE. Earn protocol revenue.</h2><p>Half of deposited platform revenue is streamed to active stakers as WETH, weighted by stake.</p></div>
      <a href={`https://basescan.org/address/${blueStakingAddresses.vault}`} target="_blank" rel="noreferrer">Verified contract <ExternalLink size={13} /></a>
    </header>
    <div className="blue-staking-stats">
      <article><span>Total staked</span><strong>{tokenAmount(totalStaked)} BLUE</strong></article>
      <article><span>Your active stake</span><strong>{tokenAmount(active)} BLUE</strong></article>
      <article><span>Claimable</span><strong>{tokenAmount(earned)} WETH</strong></article>
      <article><span>Reward stream</span><strong>{periodFinish > BigInt(now) ? "Active" : "Awaiting revenue"}</strong></article>
    </div>
    {!isConnected ? <div className="blue-staking-empty"><LockKeyhole size={20} /><div><strong>Connect your wallet</strong><p>Use the wallet button above to view and manage your BLUE stake.</p></div></div> : <div className="blue-staking-console">
      <div className="blue-staking-entry">
        <label htmlFor="blue-stake-amount"><span>Amount</span><button type="button" onClick={() => setAmount(formatEther(walletBalance))}>Wallet: {tokenAmount(walletBalance)}</button></label>
        <div><input id="blue-stake-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} /><b>BLUE</b></div>
        <div className="blue-staking-actions"><button className="button primary" onClick={stake} disabled={Boolean(busy) || paused || emergency}>{busy === "stake" ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}Stake</button><button className="button" onClick={requestUnstake} disabled={Boolean(busy) || active === 0n || cooling > 0n}>{busy === "unstake" ? <LoaderCircle className="spin" size={16} /> : <Clock3 size={16} />}Unstake</button></div>
        <small>Unstaking takes 30 days. A pending request can be cancelled before withdrawal.</small>
      </div>
      <div className="blue-staking-position">
        <div><span>Pending withdrawal</span><strong>{tokenAmount(cooling)} BLUE</strong><small>{cooling > 0n ? remainingTime(cooldownEnd, now) : "No active countdown"}</small></div>
        <div className="blue-position-actions">
          {emergency && active + cooling > 0n ? <button className="button danger" disabled={Boolean(busy)} onClick={() => simpleAction("emergency", "emergencyWithdraw", "Emergency withdrawal completed.")}>Emergency exit</button> : null}
          {!emergency && cooling > 0n ? <><button className="button" disabled={Boolean(busy)} onClick={() => simpleAction("cancel", "cancelUnstake", "Unstake request cancelled.")}><RotateCcw size={14} />Cancel</button><button className="button primary" disabled={Boolean(busy) || !unlockReady} onClick={() => simpleAction("withdraw", "withdraw", "BLUE returned to your wallet.")}>Withdraw</button></> : null}
          <button className="button reward" disabled={Boolean(busy) || earned === 0n} onClick={() => simpleAction("claim", "claimReward", "WETH reward claimed.")}>{busy === "claim" ? <LoaderCircle className="spin" size={15} /> : <Coins size={15} />}Claim WETH</button>
        </div>
      </div>
    </div>}
    {paused && !emergency ? <p className="blue-staking-alert">New stakes are paused. Claims and withdrawals remain available.</p> : null}
    {emergency ? <p className="blue-staking-alert danger">Emergency exit is active. Every staker can withdraw without waiting.</p> : null}
    {notice ? <p className="blue-staking-notice"><CheckCircle2 size={15} />{notice}</p> : null}
    {failure ? <p className="blue-staking-error">{failure}</p> : null}
  </section>;
}
