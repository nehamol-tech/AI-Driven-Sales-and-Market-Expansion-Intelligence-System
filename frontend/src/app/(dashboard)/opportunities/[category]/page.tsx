"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { OpportunityAccountsPanel } from "@/components/opportunities/opportunity-accounts-view";
import { categoryFromSlug } from "@/components/opportunities/opportunity-categories";

/** /opportunities/<card> — e.g. /opportunities/high-priority. */
export default function OpportunityCategoryPage() {
  const params = useParams<{ category: string }>();
  const category = categoryFromSlug(params.category);

  if (!category) {
    return (
      <EmptyState
        title="Unknown opportunity category."
        description="This link doesn't match any Opportunity Center card."
        action={
          <Button asChild variant="outline">
            <Link href="/opportunities">Back to Opportunity Center</Link>
          </Button>
        }
      />
    );
  }

  // Keyed so switching cards resets search, filters and page.
  return <OpportunityAccountsPanel key={category} category={category} />;
}
