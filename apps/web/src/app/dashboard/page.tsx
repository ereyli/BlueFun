import type { Metadata } from "next";
import { CreatorDashboard } from "@/components/creator-dashboard";

export const metadata: Metadata = {
  title: "Creator Dashboard | BlueFun",
  description: "Track your BlueFun launches, creator fees and token holdings across Base and Robinhood Chain."
};

export default function DashboardPage() {
  return <CreatorDashboard />;
}
