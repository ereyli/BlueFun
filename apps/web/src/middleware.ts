import { NextResponse, type NextRequest } from "next/server";

const legacyChainNames: Record<string, string> = {
  "8453": "base",
  "4663": "robinhood"
};

export function middleware(request: NextRequest) {
  const chain = request.nextUrl.searchParams.get("chain");
  const namedChain = chain ? legacyChainNames[chain] : undefined;
  if (!namedChain) return NextResponse.next();

  const destination = request.nextUrl.clone();
  destination.searchParams.set("chain", namedChain);
  return NextResponse.redirect(destination, 308);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"]
};
