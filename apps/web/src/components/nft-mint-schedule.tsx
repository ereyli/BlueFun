"use client";

import { CalendarClock, Infinity as InfinityIcon, ShieldCheck } from "lucide-react";

export type MintSchedule = {
  allowlistStart: string;
  allowlistStartNow: boolean;
  allowlistEnd: string;
  allowlistNoEnd: boolean;
  publicStart: string;
  publicStartNow: boolean;
  publicAfterAllowlist: boolean;
  publicEnd: string;
  publicNoEnd: boolean;
};

export type ResolvedMintSchedule = {
  allowlist?: { start: bigint; end: bigint };
  public?: { start: bigint; end: bigint };
};

const MAX_UINT64 = (2n ** 64n) - 1n;

export function emptyMintSchedule(): MintSchedule {
  return { allowlistStart: "", allowlistStartNow: true, allowlistEnd: "", allowlistNoEnd: false, publicStart: "", publicStartNow: true, publicAfterAllowlist: true, publicEnd: "", publicNoEnd: true };
}

export function defaultMintSchedule(now = Date.now()): MintSchedule {
  const launch = now + 10 * 60_000;
  const allowlistEnd = launch + 24 * 60 * 60_000;
  return { ...emptyMintSchedule(), allowlistStart: localDateTime(launch), allowlistEnd: localDateTime(allowlistEnd), publicStart: localDateTime(allowlistEnd), publicEnd: localDateTime(allowlistEnd + 7 * 24 * 60 * 60_000) };
}

export function resolveMintSchedule(schedule: MintSchedule, mode: "public" | "allowlist" | "both", launchStart: bigint): ResolvedMintSchedule | undefined {
  const result: ResolvedMintSchedule = {};
  if (mode !== "public") {
    const start = schedule.allowlistStartNow ? launchStart : timestamp(schedule.allowlistStart);
    const end = schedule.allowlistNoEnd ? MAX_UINT64 : timestamp(schedule.allowlistEnd);
    if (!start || !end || end <= start || (mode === "both" && schedule.allowlistNoEnd)) return;
    result.allowlist = { start, end };
  }
  if (mode !== "allowlist") {
    const start = mode === "both" && schedule.publicAfterAllowlist ? result.allowlist?.end : schedule.publicStartNow ? launchStart : timestamp(schedule.publicStart);
    const end = schedule.publicNoEnd ? MAX_UINT64 : timestamp(schedule.publicEnd);
    if (!start || !end || end <= start || (result.allowlist && start < result.allowlist.end)) return;
    result.public = { start, end };
  }
  return result;
}

export function mintScheduleIsValid(schedule: MintSchedule, mode: "public" | "allowlist" | "both") {
  return Boolean(resolveMintSchedule(schedule, mode, BigInt(Math.floor(Date.now() / 1000) + 300)));
}

export function MintScheduleFields({ mode, schedule, onChange }: { mode: "public" | "allowlist" | "both"; schedule: MintSchedule; onChange: (value: MintSchedule) => void }) {
  const update = (patch: Partial<MintSchedule>) => onChange({ ...schedule, ...patch });
  return <section className="nft-mint-schedule">
    <header><CalendarClock/><div><strong>Mint schedule</strong><small>Times use your local timezone and are stored onchain.</small></div></header>
    <div className="nft-schedule-grid">
      {mode !== "public" ? <PhaseSchedule title="Allowlist phase" start={schedule.allowlistStart} startNow={schedule.allowlistStartNow} end={schedule.allowlistEnd} noEnd={schedule.allowlistNoEnd} noEndAllowed={mode === "allowlist"} onStart={(value) => update({ allowlistStart: value })} onStartNow={(value) => update({ allowlistStartNow: value })} onEnd={(value) => update({ allowlistEnd: value })} onNoEnd={(value) => update({ allowlistNoEnd: value })}/> : null}
      {mode !== "allowlist" ? <article className="nft-schedule-phase"><div className="nft-schedule-title"><span>02</span><strong>Public phase</strong></div>{mode === "both" ? <label className="nft-schedule-check"><input checked={schedule.publicAfterAllowlist} onChange={(event) => update({ publicAfterAllowlist: event.target.checked, publicStartNow: false })} type="checkbox"/><span>Start immediately after allowlist ends</span></label> : <label className="nft-schedule-check"><input checked={schedule.publicStartNow} onChange={(event) => update({ publicStartNow: event.target.checked })} type="checkbox"/><span>Start as soon as launch confirms</span></label>}{!(mode === "both" ? schedule.publicAfterAllowlist : schedule.publicStartNow) ? <DateField label="Public starts" value={schedule.publicStart} onChange={(value) => update({ publicStart: value })}/> : null}<label className="nft-schedule-check"><input checked={schedule.publicNoEnd} onChange={(event) => update({ publicNoEnd: event.target.checked })} type="checkbox"/><InfinityIcon/><span>No expiry — continue until sold out or cancelled</span></label>{!schedule.publicNoEnd ? <DateField label="Public ends" value={schedule.publicEnd} onChange={(value) => update({ publicEnd: value })}/> : null}</article> : null}
    </div>
    {mode === "both" ? <p><ShieldCheck/>Allowlist and public phases cannot overlap. Public mint begins at or after the allowlist end.</p> : <p><ShieldCheck/>A no-expiry phase remains active until supply sells out or the creator cancels it.</p>}
  </section>;
}

export function MintPhaseStatus({ phaseType, start, end, now }: { phaseType: number; start: bigint; end: bigint; now: bigint }) {
  const live = now >= start && now < end;
  return <div className="nft-phase-runtime">
    <span><small>ACCESS</small><strong>{phaseType === 1 ? "Allowlist" : "Public"}</strong></span>
    <span><small>START</small><strong>{live ? "Live now" : formatOnchainTime(start)}</strong></span>
    <span><small>END</small><strong>{end === MAX_UINT64 ? "No expiry" : formatOnchainTime(end)}</strong></span>
  </div>;
}

function PhaseSchedule({ title, start, startNow, end, noEnd, noEndAllowed, onStart, onStartNow, onEnd, onNoEnd }: { title: string; start: string; startNow: boolean; end: string; noEnd: boolean; noEndAllowed: boolean; onStart: (value: string) => void; onStartNow: (value: boolean) => void; onEnd: (value: string) => void; onNoEnd: (value: boolean) => void }) {
  return <article className="nft-schedule-phase"><div className="nft-schedule-title"><span>01</span><strong>{title}</strong></div><label className="nft-schedule-check"><input checked={startNow} onChange={(event) => onStartNow(event.target.checked)} type="checkbox"/><span>Start as soon as launch confirms</span></label>{!startNow ? <DateField label="Allowlist starts" value={start} onChange={onStart}/> : null}{noEndAllowed ? <label className="nft-schedule-check"><input checked={noEnd} onChange={(event) => onNoEnd(event.target.checked)} type="checkbox"/><InfinityIcon/><span>No expiry — continue until sold out or cancelled</span></label> : null}{!noEnd ? <DateField label="Allowlist ends" value={end} onChange={onEnd}/> : null}</article>;
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="nft-schedule-date"><span>{label}</span><input type="datetime-local" value={value} onChange={(event) => onChange(event.target.value)}/></label>;
}

function timestamp(value: string) {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? BigInt(Math.floor(milliseconds / 1000)) : 0n;
}
function localDateTime(milliseconds: number) {
  const date = new Date(milliseconds - new Date(milliseconds).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}
function formatOnchainTime(seconds: bigint) {
  const milliseconds = Number(seconds) * 1000;
  if (!Number.isSafeInteger(milliseconds)) return "Onchain schedule";
  return new Date(milliseconds).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
