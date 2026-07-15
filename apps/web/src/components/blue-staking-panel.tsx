"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownToLine, CheckCircle2, Clock3, Coins, ExternalLink, Flame, LoaderCircle, LockKeyhole, RefreshCw, RotateCcw, Users } from "lucide-react";
import { formatEther, maxUint256, parseEther, zeroAddress } from "viem";
import { useAccount, useChainId, usePublicClient, useReadContracts, useSwitchChain, useWriteContract } from "wagmi";
import { baseChain } from "@/lib/base-chain";
import { blueStakingAddresses } from "@/lib/contracts";
import type { BlueStakingOverview } from "@/lib/blue-staking";

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
  { type: "function", name: "cancelUnstake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "amount", type: "uint256" }] },
  { type: "function", name: "emergencyWithdraw", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }], outputs: [{ name: "amount", type: "uint256" }] },
  { type: "function", name: "claimReward", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }], outputs: [{ name: "amount", type: "uint256" }] }
] as const;

const compact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3, notation: "compact" });
const precise = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

function tokenAmount(value: bigint) {
  const parsed = Number(formatEther(value));
  return Number.isFinite(parsed) ? compact.format(parsed) : "—";
}

function ethAmount(value: bigint) {
  if (value === 0n) return "0";
  const parsed = Number(formatEther(value));
  if (!Number.isFinite(parsed)) return "—";
  if (parsed < 0.000001) return "<0.000001";
  return precise.format(parsed);
}

function percentFromBps(value: number) {
  if (value === 0) return "0%";
  if (value < 1) return "<0.01%";
  return `${(value / 100).toFixed(value < 100 ? 2 : 1)}%`;
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function readableError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : "Transaction failed.";
  return message.split("\n")[0].replace("User rejected the request.", "Transaction cancelled.").slice(0, 180);
}

function remainingTime(unlockAt: bigint, now: number) {
  const seconds = Math.max(0, Number(unlockAt) - now);
  if (!seconds) return "Ready to withdraw";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days ? `${days}d ${hours}h remaining` : `${hours}h remaining`;
}

export function BlueStakingPanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: baseChain.id });
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const [amount, setAmount] = useState("");
  const [pendingAmount, setPendingAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [overview, setOverview] = useState<BlueStakingOverview | null>(null);
  const [overviewError, setOverviewError] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const account = address ?? zeroAddress;

  const refreshOverview = useCallback(async (quiet = false) => {
    if (!quiet) setOverviewLoading(true);
    try {
      const response = await fetch("/api/blue-staking", { cache: "no-store" });
      if (!response.ok) throw new Error("Staking data unavailable");
      setOverview(await response.json());
      setOverviewError(false);
    } catch {
      setOverviewError(true);
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshOverview();
    const timer = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
      refreshOverview(true);
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [refreshOverview]);

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
    query: { refetchInterval: 20_000 }
  });

  const values = useMemo(() => reads.data?.map((entry) => entry.status === "success" ? entry.result : undefined) ?? [], [reads.data]);
  const walletBalance = (values[0] as bigint | undefined) ?? 0n;
  const allowance = (values[1] as bigint | undefined) ?? 0n;
  const active = (values[2] as bigint | undefined) ?? 0n;
  const cooling = (values[3] as bigint | undefined) ?? 0n;
  const cooldownEnd = (values[4] as bigint | undefined) ?? 0n;
  const earned = (values[5] as bigint | undefined) ?? 0n;
  const contractTotalStaked = (values[6] as bigint | undefined) ?? 0n;
  const contractPeriodFinish = (values[7] as bigint | undefined) ?? 0n;
  const paused = overview?.paused ?? ((values[8] as boolean | undefined) ?? false);
  const emergency = overview?.emergency ?? ((values[9] as boolean | undefined) ?? false);
  const unlockReady = cooling > 0n && cooldownEnd <= BigInt(now);

  const totalStaked = overview ? BigInt(overview.totalActiveRaw) : contractTotalStaked;
  const totalCooling = overview ? BigInt(overview.totalCoolingRaw) : 0n;
  const rewardBalance = overview ? BigInt(overview.rewardBalanceRaw) : 0n;
  const remainingRewards = overview ? BigInt(overview.remainingRewardsRaw) : 0n;
  const lifetimeFunded = overview ? BigInt(overview.lifetimeFundedRaw) : 0n;
  const lifetimeClaimed = overview ? BigInt(overview.lifetimeClaimedRaw) : 0n;
  const periodFinish = overview ? BigInt(overview.periodFinish) : contractPeriodFinish;
  const dailyRewards = overview ? BigInt(overview.rewardRateRaw) * 86_400n : 0n;
  const poolShareBps = totalStaked === 0n ? 0 : Number((active * 10_000n) / totalStaked);
  const projectedRemaining = totalStaked === 0n ? 0n : (remainingRewards * active) / totalStaked;
  const perMillionDaily = totalStaked === 0n ? 0n : (dailyRewards * 1_000_000n * 10n ** 18n) / totalStaked;
  const streamActive = periodFinish > BigInt(now) && remainingRewards > 0n;
  const streamProgress = overview && streamActive
    ? Math.max(0, Math.min(100, ((now - (overview.periodFinish - overview.rewardsDuration)) / overview.rewardsDuration) * 100))
    : 0;

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
      await Promise.all([reads.refetch(), refreshOverview(true)]);
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
  }, "BLUE staked. Your pool share is now active.");

  const requestUnstake = () => transact("unstake", async () => {
    const value = parsedAmount();
    if (value > active) throw new Error("Amount exceeds your active stake.");
    const hash = await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName: "requestUnstake", args: [value], chainId: baseChain.id });
    await confirm(hash);
    setAmount("");
  }, cooling > 0n ? "Pending amount updated. The 30-day countdown restarted." : "30-day unstake countdown started.");

  const simpleAction = (key: string, functionName: "cancelUnstake" | "withdraw" | "emergencyWithdraw" | "claimReward", success: string) => transact(key, async (recipient) => {
    const requestedPending = functionName === "cancelUnstake" || functionName === "withdraw"
      ? parseEther(pendingAmount || formatEther(cooling))
      : 0n;
    if ((functionName === "cancelUnstake" || functionName === "withdraw") && (requestedPending <= 0n || requestedPending > cooling)) {
      throw new Error("Enter an amount within your pending BLUE balance.");
    }
    const hash = functionName === "cancelUnstake"
      ? await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName, args: [requestedPending], chainId: baseChain.id })
      : functionName === "withdraw"
        ? await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName, args: [recipient, requestedPending], chainId: baseChain.id })
        : functionName === "emergencyWithdraw"
          ? await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName, args: [recipient], chainId: baseChain.id })
          : await writeContractAsync({ address: blueStakingAddresses.vault, abi: vaultAbi, functionName, args: [recipient], chainId: baseChain.id });
    await confirm(hash);
    if (requestedPending > 0n) setPendingAmount("");
  }, success);

  return <section className="blue-staking-card" id="staking">
    <header className="blue-staking-heading">
      <div><span><Coins size={14} />BLUE staking</span><h2>Stake BLUE. Earn ETH.</h2><p>Active stake determines each wallet&apos;s share of deposited ETH rewards.</p></div>
      <div className="blue-staking-head-actions"><span className={streamActive ? "live" : "idle"}><i />{streamActive ? "Rewards streaming" : "Pool ready"}</span><a href={`https://basescan.org/address/${blueStakingAddresses.vault}`} target="_blank" rel="noreferrer">Contract <ExternalLink size={13} /></a></div>
    </header>

    <div className="blue-staking-stats">
      <article><span>Total active stake</span><strong>{tokenAmount(totalStaked)} BLUE</strong><small>{tokenAmount(totalCooling)} BLUE cooling down</small></article>
      <article><span>Active stakers</span><strong>{overviewLoading && !overview ? "—" : overview?.activeStakers ?? "—"}</strong><small>{overview?.uniqueStakers ?? 0} wallets all time</small></article>
      <article><span>Pool rewards</span><strong>{ethAmount(rewardBalance)} ETH</strong><small>{ethAmount(remainingRewards)} ETH still streaming</small></article>
      <article><span>Current rate</span><strong>{streamActive ? `${ethAmount(dailyRewards)} ETH/day` : "Awaiting revenue"}</strong><small>{overview ? `${overview.stakingShareBps / 100}% of trade revenue to stakers` : "Live on Base"}</small></article>
    </div>

    <div className="blue-staking-dashboard">
      <div className="blue-staking-user-card">
        <header><div><span>Your position</span><strong>{isConnected ? shortAddress(address!) : "Wallet not connected"}</strong></div>{isConnected ? <em>{percentFromBps(poolShareBps)} pool share</em> : null}</header>
        <div className="blue-user-metrics">
          <div><span>Active</span><strong>{tokenAmount(active)} BLUE</strong></div>
          <div><span>Claimable now</span><strong>{ethAmount(earned)} ETH</strong></div>
          <div><span>Current stream estimate</span><strong>{ethAmount(projectedRemaining)} ETH</strong></div>
        </div>
        <div className="blue-share-track"><i style={{ width: `${Math.min(100, poolShareBps / 100)}%` }} /></div>
        {!isConnected ? <div className="blue-staking-empty"><LockKeyhole size={18} /><div><strong>Connect your wallet</strong><p>View your position and manage BLUE from this panel.</p></div></div> : <>
          <div className="blue-staking-entry">
            <label htmlFor="blue-stake-amount"><span>BLUE amount</span><button type="button" onClick={() => setAmount(formatEther(walletBalance))}>Use wallet balance · {tokenAmount(walletBalance)}</button></label>
            <div className="blue-stake-input"><input id="blue-stake-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} /><b>BLUE</b></div>
            <div className="blue-staking-actions"><button className="button primary" onClick={stake} disabled={Boolean(busy) || paused || emergency}>{busy === "stake" ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}Stake</button><button className="button" onClick={requestUnstake} disabled={Boolean(busy) || active === 0n}>{busy === "unstake" ? <LoaderCircle className="spin" size={16} /> : <Clock3 size={16} />}Unstake</button></div>
            {cooling > 0n ? <small className="blue-unstake-warning">Adding another unstake request resets the 30-day timer for the full pending amount.</small> : null}
          </div>
          <div className="blue-position-actions">
            <button className="button reward" disabled={Boolean(busy) || earned === 0n} onClick={() => simpleAction("claim", "claimReward", "ETH reward claimed.")}>{busy === "claim" ? <LoaderCircle className="spin" size={15} /> : <Coins size={15} />}Claim ETH</button>
            {emergency && active + cooling > 0n ? <button className="button danger" disabled={Boolean(busy)} onClick={() => simpleAction("emergency", "emergencyWithdraw", "Emergency withdrawal completed.")}>Emergency exit</button> : null}
          </div>
          {cooling > 0n ? <div className="blue-cooldown-row"><div><Clock3 size={16} /><span><strong>{tokenAmount(cooling)} BLUE pending</strong><small>{remainingTime(cooldownEnd, now)}</small></span></div><div className="blue-cooldown-controls"><label><span>Amount</span><input inputMode="decimal" placeholder={formatEther(cooling)} value={pendingAmount} onChange={(event) => setPendingAmount(event.target.value.replace(/[^0-9.]/g, ""))} /></label><button className="button" disabled={Boolean(busy)} onClick={() => simpleAction("cancel", "cancelUnstake", "Pending BLUE returned to active stake.")}><RotateCcw size={13} />Cancel</button><button className="button primary" disabled={Boolean(busy) || !unlockReady} onClick={() => simpleAction("withdraw", "withdraw", "BLUE returned to your wallet.")}>Withdraw</button></div></div> : null}
        </>}
      </div>

      <aside className="blue-pool-card">
        <header><div><span>Pool status</span><strong>{streamActive ? "Revenue is streaming" : "Ready for next deposit"}</strong></div><Activity size={19} /></header>
        <div className="blue-stream-visual"><div><span>Stream progress</span><strong>{streamActive ? `${streamProgress.toFixed(0)}%` : "Idle"}</strong></div><div className="blue-stream-track"><i style={{ width: `${streamProgress}%` }} /></div><footer><span>{ethAmount(remainingRewards)} ETH remaining</span><span>{streamActive ? `Ends ${new Date(Number(periodFinish) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "No active stream"}</span></footer></div>
        <dl>
          <div><dt>Lifetime deposited</dt><dd>{ethAmount(lifetimeFunded)} ETH</dd></div>
          <div><dt>Lifetime claimed</dt><dd>{ethAmount(lifetimeClaimed)} ETH</dd></div>
          <div><dt>Per 1M BLUE today</dt><dd>{streamActive ? `${ethAmount(perMillionDaily)} ETH` : "—"}</dd></div>
          <div><dt>Exit window</dt><dd>30 days</dd></div>
        </dl>
        <p><Flame size={14} /> Earnings shown here use only funded on-chain rewards. Future revenue is not assumed.</p>
      </aside>
    </div>

    <section className="blue-staker-list">
      <header><div><span><Users size={14} />Pool participants</span><h3>Top active stakers</h3></div><button aria-label="Refresh staking data" disabled={overviewLoading} onClick={() => refreshOverview()}>{overviewLoading ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button></header>
      {overviewError && !overview ? <p className="blue-staker-empty">Live participant data is temporarily unavailable.</p> : overview?.stakers.length ? <div className="blue-staker-table">
        <div className="blue-staker-table-head"><span>Wallet</span><span>Active stake</span><span>Pool share</span><span>Stream estimate</span></div>
        {overview.stakers.slice(0, 10).map((staker, index) => {
          const isYou = address?.toLowerCase() === staker.address.toLowerCase();
          return <div className="blue-staker-row" key={staker.address}>
            <span className="blue-staker-wallet"><i>{index + 1}</i><a href={`https://basescan.org/address/${staker.address}`} target="_blank" rel="noreferrer">{shortAddress(staker.address)}</a>{isYou ? <em>You</em> : null}</span>
            <strong>{tokenAmount(BigInt(staker.activeRaw))} BLUE</strong>
            <span>{percentFromBps(staker.shareBps)}</span>
            <span>{ethAmount(BigInt(staker.projectedRemainingRaw))} ETH</span>
          </div>;
        })}
      </div> : <p className="blue-staker-empty">No active stake yet. The first active wallet receives the full share of the next funded stream.</p>}
    </section>

    {paused && !emergency ? <p className="blue-staking-alert">New stakes are paused. Claims and withdrawals remain available.</p> : null}
    {emergency ? <p className="blue-staking-alert danger">Emergency exit is active. Every staker can withdraw without waiting.</p> : null}
    {notice ? <p className="blue-staking-notice"><CheckCircle2 size={15} />{notice}</p> : null}
    {failure ? <p className="blue-staking-error">{failure}</p> : null}
  </section>;
}
