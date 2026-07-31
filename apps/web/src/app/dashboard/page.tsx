import type { Metadata } from "next";
import { CreatorDashboard } from "@/components/creator-dashboard";

export const metadata: Metadata = {
  title: "Creator Dashboard | B20",
  description: "Track your B20 launches, creator fees and token holdings across Base and Robinhood Chain."
};

export default function DashboardPage() {
  return <CreatorDashboard />;
}
