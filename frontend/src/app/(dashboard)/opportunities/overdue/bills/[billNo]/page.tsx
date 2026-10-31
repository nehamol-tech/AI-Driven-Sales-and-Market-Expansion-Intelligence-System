"use client";

import { useParams, useSearchParams } from "next/navigation";
import { OverdueBillDetailPanel } from "@/components/opportunities/overdue-bills-view";

/** /opportunities/overdue/bills/<billNo>[?account=<accountId>] — one bill's details; `account` is the customer list it was opened from. */
export default function OverdueBillDetailPage() {
  const params = useParams<{ billNo: string }>();
  const searchParams = useSearchParams();
  const billNo = decodeURIComponent(params.billNo);
  return <OverdueBillDetailPanel key={billNo} billNo={billNo} fromAccountId={searchParams.get("account") ?? undefined} />;
}
