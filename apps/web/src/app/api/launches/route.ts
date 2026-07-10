import { NextResponse } from "next/server";
import { getDbLaunchPage, type LaunchPageFilter } from "@/lib/db-launches";
import { getDeployedLaunches } from "@/lib/onchain-launches";
import { getRobinhoodLaunches } from "@/lib/robinhood-launches";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chainId = Number(params.get("chain"));
  const page = Number(params.get("page") || "1");
  const query = (params.get("q") || "").slice(0, 80);
  const requestedFilter = params.get("filter") || "New";
  const filters: LaunchPageFilter[] = ["Live", "New", "Ready", "Graduated", "Safe", "Progress"];
  if ((chainId !== 8453 && chainId !== 4663) || !Number.isInteger(page) || page < 1 || page > 100_000 || !filters.includes(requestedFilter as LaunchPageFilter)) {
    return NextResponse.json({ launches: [], total: 0, page: 1, totalPages: 0 }, { status: 400 });
  }
  const filter = requestedFilter as LaunchPageFilter;
  const indexed = await getDbLaunchPage(chainId, { page, pageSize: 21, query, filter });
  if (indexed) return NextResponse.json({ ...indexed, page, totalPages: Math.ceil(indexed.total / 21) });

  const all = chainId === 4663 ? await getRobinhoodLaunches() : await getDeployedLaunches();
  const normalized = query.trim().toLowerCase();
  const filtered = all.filter((launch) => {
    const matchesQuery = !normalized || [launch.name, launch.symbol, launch.token, launch.creator].some((value) => value.toLowerCase().includes(normalized));
    if (!matchesQuery) return false;
    if (filter === "Live" || filter === "Ready" || filter === "Graduated") return launch.status === filter;
    return true;
  }).sort((a, b) => filter === "Progress" ? b.progress - a.progress || Number(b.id) - Number(a.id) : Number(b.id) - Number(a.id));
  const start = (page - 1) * 21;
  return NextResponse.json({ launches: filtered.slice(start, start + 21), total: filtered.length, page, totalPages: Math.ceil(filtered.length / 21) });
}
