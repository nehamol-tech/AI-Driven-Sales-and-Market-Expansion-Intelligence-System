import { AlertCircle } from "lucide-react";

const FIELD_LABELS: Record<string, string> = {
  industryId: "Industry",
  stateId: "State",
  cityId: "City",
  "stateId or cityId": "State or city",
};

function humanizeMissing(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

/**
 * Renders the exact "insufficient_data" contract from the scoring endpoint —
 * never a disabled button with no explanation, always the concrete list of
 * what's missing before this lead can be scored.
 */
export function InsufficientDataNotice({ missing }: { missing: string[] }) {
  return (
    <div className="flex gap-3 rounded-md border border-dashed border-border bg-muted/30 p-4">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="text-sm">
        <p className="font-medium">Not enough data to score this lead yet.</p>
        {missing.length > 0 ? (
          <>
            <p className="mt-1 text-muted-foreground">Add the following, then try again:</p>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {missing.map((m) => (
                <li key={m}>{humanizeMissing(m)}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </div>
  );
}
