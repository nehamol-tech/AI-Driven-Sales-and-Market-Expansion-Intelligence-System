import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown instantly while a dashboard page's code loads after a sidebar click.
 * The sidebar, top bar and Back/Dashboard bar stay mounted (they live in the
 * layout); only the page area shows this placeholder.
 */
export default function DashboardPageLoading() {
  return (
    <div aria-busy="true" aria-label="Loading page" className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
