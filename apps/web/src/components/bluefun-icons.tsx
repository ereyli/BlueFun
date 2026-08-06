import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";

export type BlueFunIconProps = Omit<SVGProps<SVGSVGElement>, "height" | "width"> & {
  absoluteStrokeWidth?: boolean;
  size?: number | string;
  strokeWidth?: number;
};

export type LucideIcon = ComponentType<BlueFunIconProps>;

type IconAsset =
  | "alert" | "archive" | "arrow-back" | "arrow-forward" | "bolt" | "calendar" | "candles" | "chart"
  | "check" | "chevron-down" | "clock" | "close" | "collection" | "copy" | "creator" | "dashboard"
  | "docs" | "download" | "download-line" | "external" | "eye" | "filter" | "flame" | "folder" | "gauge"
  | "gavel" | "gift" | "grid" | "home" | "image" | "image-add" | "image-off" | "infinity" | "info"
  | "key" | "layers" | "link" | "list" | "lock" | "marketplace" | "money" | "moon" | "network"
  | "plus" | "profile" | "radio" | "refresh" | "rocket" | "search" | "send" | "settings" | "share"
  | "shield" | "sparkles" | "sun" | "swap" | "tag" | "timer" | "token" | "trash" | "trophy"
  | "upload" | "users" | "verified" | "vertical-swap" | "wallet" | "wallet-cards";

function createBlueFunIcon(asset: IconAsset, rotation = 0): LucideIcon {
  function BlueFunIcon({
    absoluteStrokeWidth,
    className = "",
    size = 18,
    strokeWidth = 1.8,
    style,
    ...props
  }: BlueFunIconProps) {
    return (
      <svg
        {...props}
        aria-hidden={props["aria-label"] ? undefined : (props["aria-hidden"] ?? true)}
        className={`bluefun-icon ${className}`.trim()}
        fill="none"
        height={size}
        role={props["aria-label"] ? "img" : undefined}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        style={{ "--bluefun-icon-rotation": `${rotation}deg`, ...style } as CSSProperties}
        viewBox="0 0 24 24"
        width={size}
      >
        <g vectorEffect={absoluteStrokeWidth ? "non-scaling-stroke" : undefined}>{iconGlyph(asset)}</g>
      </svg>
    );
  }

  BlueFunIcon.displayName = `BlueFunIcon(${asset})`;
  return BlueFunIcon;
}

function iconGlyph(asset: IconAsset): ReactNode {
  switch (asset) {
    case "alert": return <><path d="M12 3.2 21 19H3Z"/><path d="M12 8v5.2"/><path d="M12 16.8h.01"/></>;
    case "archive": return <><path d="M4 7.5h16v12H4z"/><path d="M3 4.5h18v3H3z"/><path d="M9 11h6"/></>;
    case "arrow-back": return <><path d="m14.5 5-7 7 7 7"/><path d="M8 12h11"/></>;
    case "arrow-forward": return <><path d="m9.5 5 7 7-7 7"/><path d="M5 12h11"/></>;
    case "bolt": return <path d="m13.5 2.8-8 10.1h6l-1 8.3 8-11h-6z"/>;
    case "calendar": return <><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M7.5 3v4M16.5 3v4M3.5 9h17M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01"/></>;
    case "candles": return <><path d="M6 4v16M3.5 8h5v6h-5zM12 3v18M9.5 6h5v9h-5zM18 5v14M15.5 10h5v6h-5z"/></>;
    case "chart": return <><path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-4 3 2 5-6"/><path d="M16 7h3v3"/></>;
    case "check": return <path d="m5 12.5 4.2 4.2L19.5 6.5"/>;
    case "chevron-down": return <path d="m6.5 9 5.5 5.5L17.5 9"/>;
    case "clock": return <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></>;
    case "close": return <path d="m6 6 12 12M18 6 6 18"/>;
    case "collection": return <><rect x="4" y="4" width="12" height="12" rx="2"/><path d="M8 8h12v12H8"/></>;
    case "copy": return <><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>;
    case "creator": return <><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.5-4 2.5-6 5.5-6 1.5 0 2.7.5 3.6 1.3"/><circle cx="17" cy="17" r="3"/><path d="M17 12.5v1.5M17 20v1.5M12.5 17H14M20 17h1.5"/></>;
    case "dashboard": return <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="10.5" width="7" height="10" rx="1.5"/></>;
    case "docs": return <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 3H11v16H7.5A3.5 3.5 0 0 0 4 21z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 3H13v16h3.5A3.5 3.5 0 0 1 20 21z"/></>;
    case "download": return <><path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/></>;
    case "download-line": return <><path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/></>;
    case "external": return <><path d="M13 5h6v6"/><path d="m11 13 8-8"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></>;
    case "eye": return <><path d="M2.8 12s3.2-5.5 9.2-5.5 9.2 5.5 9.2 5.5-3.2 5.5-9.2 5.5S2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.7"/></>;
    case "filter": return <><path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></>;
    case "flame": return <path d="M12.5 2.8c1 4-2.5 5.2-.5 8 1.2-1.2 2.2-2.4 2.4-4.4 3.2 2.5 4.4 5.3 3.5 8.4A6.2 6.2 0 0 1 12 21c-4.2 0-7-2.7-7-6.5 0-3.2 2.1-5.6 4.7-8.2.1 2.3.6 3.7 1.6 4.8.8-2.4-1-4.7 1.2-8.3Z"/>;
    case "folder": return <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>;
    case "gauge": return <><path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 14 4-4"/><path d="M7 17h10"/></>;
    case "gavel": return <><path d="m13 5 6 6M10 8l6 6M12 6l-6 6 4 4 6-6zM4 20h11"/></>;
    case "gift": return <><rect x="3" y="9" width="18" height="11" rx="2"/><path d="M12 9v11M3 13h18M12 9H7.5A2.5 2.5 0 1 1 10 6.5ZM12 9h4.5A2.5 2.5 0 1 0 14 6.5Z"/></>;
    case "grid": return <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></>;
    case "home": return <><path d="m3.5 10 8.5-7 8.5 7"/><path d="M5.5 9v11h13V9M9.5 20v-6h5v6"/></>;
    case "image": return <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m5 18 5-5 3 3 2-2 4 4"/></>;
    case "image-add": return <><rect x="3" y="5" width="15" height="14" rx="3"/><circle cx="8" cy="10" r="1.5"/><path d="m5 17 4-4 3 3 2-2 2 2M19 3v6M16 6h6"/></>;
    case "image-off": return <><path d="M8 4h10a3 3 0 0 1 3 3v10M18 20H6a3 3 0 0 1-3-3V7c0-.8.3-1.5.8-2"/><path d="m3 3 18 18M8 13l-3 3M14 14l2-2 4 4"/></>;
    case "infinity": return <path d="M8.5 8.5C5 5 2.5 7.2 2.5 12s2.5 7 6 3.5L15.5 8.5c3.5-3.5 6-1.3 6 3.5s-2.5 7-6 3.5z"/>;
    case "info": return <><circle cx="12" cy="12" r="9"/><path d="M12 10.5V17M12 7h.01"/></>;
    case "key": return <><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/></>;
    case "layers": return <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>;
    case "link": return <><path d="M9.5 14.5 14.5 9.5"/><path d="M7.8 17.7 5.5 20A3.9 3.9 0 0 1 0 14.5l3.2-3.2A3.9 3.9 0 0 1 8.7 11M16.2 6.3 18.5 4A3.9 3.9 0 0 1 24 9.5l-3.2 3.2a3.9 3.9 0 0 1-5.5.3" transform="scale(.82) translate(2.6 2.6)"/></>;
    case "list": return <><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".7" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r=".7" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r=".7" fill="currentColor" stroke="none"/></>;
    case "lock": return <><rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>;
    case "marketplace": return <><path d="M5 8h14l1 12H4z"/><path d="M8 9V7a4 4 0 0 1 8 0v2"/></>;
    case "money": return <><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.8-.5-1.8-.8-3-.8-1.7 0-3 .8-3 2s1.1 1.8 3 2.3 3 1.1 3 2.3-1.3 2-3 2c-1.3 0-2.5-.4-3.3-1M12 5.5v2.2M12 16.3v2.2"/></>;
    case "moon": return <path d="M20 15.5A8.4 8.4 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>;
    case "network": return <><circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="m10.7 7.2-4.4 8.6M13.3 7.2l4.4 8.6M7.5 18h9"/></>;
    case "plus": return <path d="M12 5v14M5 12h14"/>;
    case "profile": return <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>;
    case "radio": return <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M3 3l3 3M21 3l-3 3"/></>;
    case "refresh": return <><path d="M19 7V3l-2 2a8 8 0 1 0 2.2 8"/><path d="M19 3h-4"/></>;
    case "rocket": return <><path d="M14 4c2.4-1.3 4.8-1.3 6-1-0 1.2 0 3.6-1.3 6L13 14.7 9.3 11z"/><path d="m9.5 8.5-4 .8-2 2 5.8.7M15.5 14.5l-.8 4-2 2-1-5.8"/><circle cx="15.5" cy="7.5" r="1.5"/><path d="M7.5 15.5C5 16 4 17 3.5 20.5 7 20 8 19 8.5 16.5"/></>;
    case "search": return <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>;
    case "send": return <><path d="m3 11 18-8-8 18-2.5-7.5z"/><path d="M10.5 13.5 21 3"/></>;
    case "settings": return <><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></>;
    case "share": return <><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/></>;
    case "shield": return <><path d="M12 3 20 6v6c0 5-3.2 8-8 9-4.8-1-8-4-8-9V6z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>;
    case "sparkles": return <><path d="m9 3 1.4 4.1L14.5 9l-4.1 1.9L9 15l-1.4-4.1L3.5 9l4.1-1.9zM18 13l.9 2.6 2.6.9-2.6.9L18 20l-.9-2.6-2.6-.9 2.6-.9z"/></>;
    case "sun": return <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></>;
    case "swap": return <><path d="M5 7h13l-3-3M19 17H6l3 3"/><path d="m18 7 2 2M6 17l-2-2"/></>;
    case "tag": return <><path d="M3 12V4h8l10 10-7 7z"/><circle cx="8" cy="8" r="1"/></>;
    case "timer": return <><circle cx="12" cy="13" r="8"/><path d="M9 2h6M12 5v2M12 13l3-3M18 7l1.5-1.5"/></>;
    case "token": return <><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/><path d="M12 7.2a6 6 0 0 0 0 9.6"/></>;
    case "trash": return <><path d="M4 7h16M9 3h6l1 4H8zM6 7l1 14h10l1-14M10 11v6M14 11v6"/></>;
    case "trophy": return <><path d="M8 4h8v5a4 4 0 0 1-8 0zM12 13v4M8 21h8M9 17h6"/><path d="M8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4"/></>;
    case "upload": return <><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 14v6h16v-6"/></>;
    case "users": return <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.3"/><path d="M16 15c3.2-.4 5 1.5 5 4"/></>;
    case "verified": return <><path d="m12 2.8 2.1 1.6 2.6-.1.7 2.5 2.2 1.5-.9 2.4.9 2.4-2.2 1.5-.7 2.5-2.6-.1L12 21.2l-2.1-1.6-2.6.1-.7-2.5-2.2-1.5.9-2.4-.9-2.4 2.2-1.5.7-2.5 2.6.1z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>;
    case "vertical-swap": return <><path d="M8 4v16M5 7l3-3 3 3M16 20V4M13 17l3 3 3-3"/></>;
    case "wallet": return <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H18v16H6a2 2 0 0 1-2-2z"/><path d="M4 7h14a2 2 0 0 1 2 2v8H4M15 12h5"/><circle cx="16" cy="12" r=".7" fill="currentColor" stroke="none"/></>;
    case "wallet-cards": return <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 9h18M7 15h4"/></>;
  }
}

export const Activity = createBlueFunIcon("chart");
export const ArrowDownLeft = createBlueFunIcon("arrow-back", -45);
export const ArrowDownToLine = createBlueFunIcon("download-line");
export const ArrowDownUp = createBlueFunIcon("vertical-swap");
export const ArrowLeft = createBlueFunIcon("arrow-back");
export const ArrowRight = createBlueFunIcon("arrow-forward");
export const ArrowUpRight = createBlueFunIcon("external");
export const BadgeCheck = createBlueFunIcon("verified");
export const BarChart3 = createBlueFunIcon("chart");
export const BookOpen = createBlueFunIcon("docs");
export const Boxes = createBlueFunIcon("grid");
export const CalendarClock = createBlueFunIcon("calendar");
export const Check = createBlueFunIcon("check");
export const CheckCircle2 = createBlueFunIcon("verified");
export const ChevronDown = createBlueFunIcon("chevron-down");
export const ChevronLeft = createBlueFunIcon("arrow-back");
export const ChevronRight = createBlueFunIcon("arrow-forward");
export const CircleDollarSign = createBlueFunIcon("money");
export const Clock3 = createBlueFunIcon("clock");
export const Coins = createBlueFunIcon("token");
export const Copy = createBlueFunIcon("copy");
export const Download = createBlueFunIcon("download");
export const ExternalLink = createBlueFunIcon("external");
export const Eye = createBlueFunIcon("eye");
export const FileArchive = createBlueFunIcon("archive");
export const FileKey2 = createBlueFunIcon("key");
export const Flame = createBlueFunIcon("flame");
export const FolderOpen = createBlueFunIcon("folder");
export const Gauge = createBlueFunIcon("gauge");
export const Gavel = createBlueFunIcon("gavel");
export const Gift = createBlueFunIcon("gift");
export const Globe2 = createBlueFunIcon("network");
export const Grid2X2 = createBlueFunIcon("grid");
export const Home = createBlueFunIcon("home");
export const ImageIcon = createBlueFunIcon("image");
export const ImageOff = createBlueFunIcon("image-off");
export const ImagePlus = createBlueFunIcon("image-add");
export const Images = createBlueFunIcon("collection");
export const Infinity = createBlueFunIcon("infinity");
export const Info = createBlueFunIcon("info");
export const Layers3 = createBlueFunIcon("layers");
export const LayoutDashboard = createBlueFunIcon("dashboard");
export const LayoutGrid = createBlueFunIcon("grid");
export const List = createBlueFunIcon("list");
export const Loader2 = createBlueFunIcon("refresh");
export const LoaderCircle = createBlueFunIcon("refresh");
export const LockKeyhole = createBlueFunIcon("lock");
export const Moon = createBlueFunIcon("moon");
export const Network = createBlueFunIcon("network");
export const Plus = createBlueFunIcon("plus");
export const Radio = createBlueFunIcon("radio");
export const RefreshCw = createBlueFunIcon("refresh");
export const Rocket = createBlueFunIcon("rocket");
export const RotateCcw = createBlueFunIcon("refresh");
export const Search = createBlueFunIcon("search");
export const Send = createBlueFunIcon("send");
export const Settings = createBlueFunIcon("settings");
export const Settings2 = createBlueFunIcon("filter");
export const Share2 = createBlueFunIcon("share");
export const ShieldCheck = createBlueFunIcon("shield");
export const ShoppingBag = createBlueFunIcon("marketplace");
export const Sparkles = createBlueFunIcon("sparkles");
export const Sun = createBlueFunIcon("sun");
export const Tag = createBlueFunIcon("tag");
export const TimerReset = createBlueFunIcon("timer");
export const Trash2 = createBlueFunIcon("trash");
export const TrendingUp = createBlueFunIcon("chart");
export const Trophy = createBlueFunIcon("trophy");
export const UploadCloud = createBlueFunIcon("upload");
export const UserRoundCog = createBlueFunIcon("creator");
export const Users = createBlueFunIcon("users");
export const Wallet = createBlueFunIcon("wallet");
export const WalletCards = createBlueFunIcon("wallet-cards");
export const X = createBlueFunIcon("close");
export const Zap = createBlueFunIcon("bolt");
