import type { Metadata } from "next";
import { BlueTransparencyClient } from "@/app/transparency/blue-transparency-client";
import { getBlueTransparency } from "@/lib/blue-transparency";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "BLUE Transparency | BlueFun",
  description: "Live, onchain BLUE token distribution and liquidity transparency on Base."
};

export default async function BlueTransparencyPage() {
  const initialData = await getBlueTransparency().catch(() => null);
  return <BlueTransparencyClient initialData={initialData} />;
}
