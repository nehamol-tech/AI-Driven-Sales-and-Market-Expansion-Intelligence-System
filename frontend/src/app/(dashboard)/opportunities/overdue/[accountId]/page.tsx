"use client";

import { useParams } from "next/navigation";
import { OverdueCustomerBillsPanel } from "@/components/opportunities/overdue-bills-view";

/** /opportunities/overdue/<accountId> — one overdue customer's bills. */
export default function OverdueCustomerBillsPage() {
  const params = useParams<{ accountId: string }>();
  const accountId = decodeURIComponent(params.accountId);
  // Keyed so another customer starts again at page 1.
  return <OverdueCustomerBillsPanel key={accountId} accountId={accountId} />;
}
