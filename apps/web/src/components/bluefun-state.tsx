import Image from "next/image";
import type { ReactNode } from "react";

type BlueFunStateVariant = "loading" | "empty" | "offline" | "success";

export function BlueFunState({
  action,
  compact = false,
  text,
  title,
  variant
}: {
  action?: ReactNode;
  compact?: boolean;
  text?: string;
  title: string;
  variant: BlueFunStateVariant;
}) {
  return (
    <div className={`bluefun-state ${compact ? "compact" : ""} ${variant}`} role={variant === "offline" ? "status" : undefined}>
      <div className="bluefun-state-art">
        <span className="bluefun-state-orbit" aria-hidden="true" />
        <Image alt="" height={compact ? 72 : 150} src={`/illustrations/bluefun/${variant}.webp`} width={compact ? 72 : 150} />
      </div>
      <div className="bluefun-state-copy">
        <strong>{title}</strong>
        {text ? <span>{text}</span> : null}
        {action ? <div className="bluefun-state-action">{action}</div> : null}
      </div>
    </div>
  );
}
