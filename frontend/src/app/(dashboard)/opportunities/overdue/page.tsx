"use client";

import { OverdueAccountsPanel } from "@/components/opportunities/overdue-accounts-view";

/** /opportunities/overdue — a static route, so it takes precedence over /opportunities/[category]. */
export default function OverdueAccountsPage() {
  return <OverdueAccountsPanel />;
}
