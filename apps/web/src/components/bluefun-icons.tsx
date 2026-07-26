import type { CSSProperties, ComponentType, ImgHTMLAttributes } from "react";

export type BlueFunIconProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "height" | "src" | "width"> & {
  absoluteStrokeWidth?: boolean;
  size?: number | string;
  strokeWidth?: number;
};

export type LucideIcon = ComponentType<BlueFunIconProps>;

type IconAsset =
  | "alert"
  | "archive"
  | "back"
  | "calendar"
  | "candles"
  | "chart"
  | "check"
  | "chevron-down"
  | "clock"
  | "close"
  | "collection"
  | "copy"
  | "creator"
  | "dashboard"
  | "docs"
  | "download"
  | "download-line"
  | "external"
  | "eye"
  | "filter"
  | "flame"
  | "folder"
  | "forward"
  | "gavel"
  | "gift"
  | "grid"
  | "home"
  | "image"
  | "image-add"
  | "image-off"
  | "infinity"
  | "info"
  | "key"
  | "layers"
  | "link"
  | "list"
  | "lock"
  | "marketplace"
  | "money"
  | "moon"
  | "network"
  | "plus"
  | "profile"
  | "radio"
  | "refresh"
  | "rocket"
  | "search"
  | "send"
  | "settings"
  | "share"
  | "shield"
  | "sparkles"
  | "sun"
  | "swap"
  | "tag"
  | "timer"
  | "token"
  | "trash"
  | "upload"
  | "users"
  | "verified"
  | "vertical-swap"
  | "wallet"
  | "wallet-cards";

function createBlueFunIcon(asset: IconAsset, rotation = 0): LucideIcon {
  function BlueFunIcon({
    absoluteStrokeWidth: _absoluteStrokeWidth,
    alt = "",
    className = "",
    size = 18,
    strokeWidth: _strokeWidth,
    style,
    ...props
  }: BlueFunIconProps) {
    void _absoluteStrokeWidth;
    void _strokeWidth;

    const iconStyle = {
      "--bluefun-icon-rotation": `${rotation}deg`,
      height: size,
      width: size,
      ...style
    } as CSSProperties;

    return (
      <img
        {...props}
        alt={alt}
        aria-hidden={props["aria-label"] ? undefined : (props["aria-hidden"] ?? true)}
        className={`bluefun-icon ${className}`.trim()}
        draggable={false}
        src={`/icons/bluefun/${asset}.webp`}
        style={iconStyle}
      />
    );
  }

  BlueFunIcon.displayName = `BlueFunIcon(${asset})`;
  return BlueFunIcon;
}

export const Activity = createBlueFunIcon("chart");
export const ArrowDownLeft = createBlueFunIcon("back", -45);
export const ArrowDownToLine = createBlueFunIcon("download-line");
export const ArrowDownUp = createBlueFunIcon("vertical-swap");
export const ArrowLeft = createBlueFunIcon("back");
export const ArrowRight = createBlueFunIcon("forward");
export const ArrowUpRight = createBlueFunIcon("external");
export const BadgeCheck = createBlueFunIcon("verified");
export const BarChart3 = createBlueFunIcon("chart");
export const BookOpen = createBlueFunIcon("docs");
export const Boxes = createBlueFunIcon("grid");
export const CalendarClock = createBlueFunIcon("calendar");
export const Check = createBlueFunIcon("check");
export const CheckCircle2 = createBlueFunIcon("check");
export const ChevronDown = createBlueFunIcon("chevron-down");
export const ChevronLeft = createBlueFunIcon("back");
export const ChevronRight = createBlueFunIcon("forward");
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
export const Gauge = createBlueFunIcon("candles");
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
export const Trophy = createBlueFunIcon("verified");
export const UploadCloud = createBlueFunIcon("upload");
export const UserRoundCog = createBlueFunIcon("creator");
export const Users = createBlueFunIcon("users");
export const Wallet = createBlueFunIcon("wallet");
export const WalletCards = createBlueFunIcon("wallet-cards");
export const X = createBlueFunIcon("close");
export const Zap = createBlueFunIcon("rocket");
