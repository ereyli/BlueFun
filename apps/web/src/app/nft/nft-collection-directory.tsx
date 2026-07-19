"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, Clock3, Grid2X2, ImageOff, List as ListIcon, Search, Sparkles } from "lucide-react";
import type { NFTCollectionSummary } from "@/lib/nft-collections";
import { optimizedTokenImageUrl } from "@/lib/token-metadata";

type Filter = "All" | "Live" | "Free" | "Paid";
type Sort = "all" | "trending" | "newest" | "price-low" | "price-high" | "minted";
type View = "grid" | "list";

export function NFTCollectionDirectory({ collections }: { collections: NFTCollectionSummary[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [sort, setSort] = useState<Sort>("all");
  const [view, setView] = useState<View>("grid");
  const [page, setPage] = useState(1);
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const rows = collections.filter((collection) => {
      const matchesQuery = !normalized || [collection.name, collection.symbol, collection.address, collection.creator].some((value) => value.toLowerCase().includes(normalized));
      const matchesFilter = filter === "All" || filter === "Live" && collection.status === "Live" || filter === "Free" && collection.isFree || filter === "Paid" && Boolean(collection.mintPriceEth) && !collection.isFree;
      return matchesQuery && matchesFilter;
    });
    rows.sort((a, b) => {
      const aPrice = Number(a.mintPriceEth); const bPrice = Number(b.mintPriceEth);
      const aMinted = Number(a.initialMinted); const bMinted = Number(b.initialMinted);
      const aSupply = Number(a.initialSupply); const bSupply = Number(b.initialSupply);
      const aProgress = aSupply > 0 ? aMinted / aSupply : 0; const bProgress = bSupply > 0 ? bMinted / bSupply : 0;
      if (sort === "trending") return (b.status === "Live" ? 2 : 0) + bProgress - ((a.status === "Live" ? 2 : 0) + aProgress);
      if (sort === "newest") return numericId(b.id) - numericId(a.id);
      if (sort === "price-low") return finitePrice(aPrice) - finitePrice(bPrice);
      if (sort === "price-high") {
        const aValue = Number.isFinite(aPrice) ? aPrice : -1;
        const bValue = Number.isFinite(bPrice) ? bPrice : -1;
        return bValue - aValue;
      }
      if (sort === "minted") return bMinted - aMinted;
      return 0;
    });
    return rows;
  }, [collections, filter, query, sort]);
  const pageSize = view === "grid" ? 24 : 50;
  const pages = Math.max(1, Math.ceil(visible.length / pageSize)); const safePage = Math.min(page, pages);
  const pageRows = visible.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => setPage(1), [filter, query, sort, view]);

  return <section className="nft-directory-panel">
    <header><div><span>COLLECTION CATALOG</span><h2>Explore every collection</h2><p>Browse collection identity, supply and marketplace items. Live minting is organized separately above.</p></div><strong>{collections.length} COLLECTION{collections.length === 1 ? "" : "S"}</strong></header>
    <div className="nft-directory-toolbar nft-catalog-toolbar">
      <label><Search/><input aria-label="Search NFT collections" placeholder="Search collection, symbol or address" value={query} onChange={(event) => setQuery(event.target.value)}/></label>
      <div className="nft-catalog-filters">{(["All","Live","Free","Paid"] as Filter[]).map((value) => <button className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)} type="button">{value}</button>)}</div>
      <select aria-label="Sort collections" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="all">All collections</option><option value="trending">Trending</option><option value="newest">Newest launches</option><option value="price-low">Mint price: low to high</option><option value="price-high">Mint price: high to low</option><option value="minted">Most minted</option></select>
      <div className="nft-view-switch" aria-label="Collection view"><button aria-label="Grid view" className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}><Grid2X2/></button><button aria-label="List view" className={view === "list" ? "active" : ""} onClick={() => setView("list")}><ListIcon/></button></div>
    </div>
    {visible.length ? <div className={`nft-directory-collection-grid ${view}`}>{pageRows.map((collection) => <CollectionCard collection={collection} key={collection.address} view={view}/>)}</div> : <div className="nft-directory-empty"><span><ImageOff/></span><h3>{collections.length ? "No matching collections" : "The first drop is waiting"}</h3><p>{collections.length ? "Try another search or filter." : "No NFT collection has launched through the verified BlueFun factory yet."}</p>{!collections.length ? <Link className="button primary" href="/nft/launch"><Sparkles/>Launch the first collection</Link> : null}</div>}
    {pages > 1 ? <footer className="nft-market-pagination"><span>Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, visible.length)} of {visible.length}</span><div><button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft/>Previous</button><b>Page {safePage} of {pages}</b><button disabled={safePage === pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next<ChevronRight/></button></div></footer> : null}
  </section>;
}

export function NFTLiveMints({ collections }: { collections: NFTCollectionSummary[] }) {
  const live = collections.filter((collection) => collection.status === "Live").slice(0, 8);
  const upcoming = live.length ? [] : collections.filter((collection) => collection.status === "Upcoming").slice(0, 4);
  const rows = live.length ? live : upcoming;
  return <section className="nft-live-mints" id="live-mints">
    <header><div><span><i/>LIVE MINTS</span><h2>{live.length ? "Minting now" : "Upcoming drops"}</h2><p>A dedicated primary sale desk. Open a drop to review its phase, limits and collection details.</p></div><strong>{live.length} LIVE</strong></header>
    {rows.length ? <div className="nft-live-mint-grid">{rows.map((collection) => {
      const supply = Number(collection.initialSupply); const minted = Number(collection.initialMinted); const progress = supply > 0 ? Math.min(100, minted / supply * 100) : 0;
      return <article className="nft-live-mint-card" key={collection.address}>
        <Link className="nft-live-mint-art" href={`/nft/${collection.address}`}>{collection.imageUrl ? <img src={optimizedTokenImageUrl(collection.imageUrl)} loading="lazy" decoding="async" alt={collection.name}/> : <span><Sparkles/></span>}<b>{collection.standard}</b></Link>
        <div><small>{collection.symbol} · BLUEFUN DROP</small><h3>{collection.name}</h3><p>{collection.description || "Creator-owned mint on Base."}</p><dl><div><dt>MINT PRICE</dt><dd>{collection.isFree ? "Free" : collection.mintPriceEth ? `${trimEth(collection.mintPriceEth)} ETH` : "—"}</dd></div><div><dt>ACCESS</dt><dd>{collection.access}</dd></div></dl><div className="nft-live-progress"><span><i style={{width:`${progress}%`}}/></span><small>{collection.initialMinted} / {collection.initialSupply}</small></div><footer><Link href={`/nft/${collection.address}`} className="button primary">{live.length ? <><Sparkles/>Mint now</> : <><Clock3/>View schedule</>}</Link><Link href={`/nft/${collection.address}#collection-marketplace`}>Collection <ArrowRight/></Link></footer></div>
      </article>;
    })}</div> : <div className="nft-directory-empty"><span><Clock3/></span><h3>No active mint right now</h3><p>Explore launched collections below or create the next drop.</p></div>}
  </section>;
}

function CollectionCard({ collection, view }: { collection: NFTCollectionSummary; view: View }) {
  const supply = Number(collection.initialSupply); const minted = Number(collection.initialMinted);
  const progress = supply > 0 ? Math.min(100, minted / supply * 100) : 0;
  return <Link className={`nft-collection-card nft-directory-collection-card ${view}`} href={`/nft/${collection.address}`}>
    <div className="nft-collection-cover">{collection.imageUrl ? <img src={optimizedTokenImageUrl(collection.imageUrl)} loading="lazy" decoding="async" alt={collection.name}/> : <span><Sparkles/></span>}<i className={collection.status.toLowerCase()}>{collection.status}</i><b>{collection.standard}</b></div>
    <div className="nft-collection-body"><div><small>{collection.symbol} · #{collection.id}</small><h3>{collection.name}</h3><p>{collection.description || "Creator-owned collection on Base."}</p></div>
      <dl><div><dt>MINT PRICE</dt><dd>{collection.access === "Allowlist" ? "Allowlist" : collection.mintPriceEth === undefined ? "—" : collection.isFree ? "Free" : `${trimEth(collection.mintPriceEth)} ETH`}</dd></div><div><dt>ITEMS</dt><dd>{collection.itemCount}</dd></div><div><dt>ROYALTY</dt><dd>{collection.royaltyPercent}%</dd></div></dl>
      <div className="nft-mint-progress"><span><i style={{ width: `${progress}%` }}/></span><small>{collection.initialMinted} / {collection.initialSupply} minted</small></div>
      <footer><span>By {shortAddress(collection.creator)}</span><strong>Open collection</strong></footer>
    </div>
  </Link>;
}

function shortAddress(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function trimEth(value: string) { const numeric = Number(value); return numeric === 0 ? "0" : numeric < .0001 ? "<0.0001" : numeric.toFixed(4).replace(/0+$/, "").replace(/\.$/, ""); }
function numericId(value: string) { return Number(value.replace(/\D/g, "")) || 0; }
function finitePrice(value: number) { return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER; }
