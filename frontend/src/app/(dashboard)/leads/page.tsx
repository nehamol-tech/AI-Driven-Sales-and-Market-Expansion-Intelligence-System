"use client";

import * as React from "react";
import Link from "next/link";
import { Flame, Plus, Search, Sparkles, Target, Users } from "lucide-react";
import type { AccountDTO, LeadClassification, ProspectDTO } from "@ai-sales/shared";
import {
  useAccounts,
  useProspects,
  useLeadsSummary,
  useScoreAccount,
  useScoreProspect,
  useScoreBatch,
  useDeleteProspect,
} from "@/hooks/use-leads";
import { usePermissions } from "@/hooks/use-permissions";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ClassificationBadge } from "@/components/leads/classification-badge";
import { ProspectDialog } from "@/components/leads/prospect-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

const PAGE_SIZE = 20;
const ALL = "all";
const UNSCORED = "unscored";

type ClassificationFilter = "all" | LeadClassification | "unscored";

export default function LeadsPage() {
  const { isAdmin, isManager } = usePermissions();
  const canManageLeads = isAdmin || isManager;

  const { data: summary, isLoading: isSummaryLoading } = useLeadsSummary();
  const scoreBatch = useScoreBatch();
  const [confirmBatchOpen, setConfirmBatchOpen] = React.useState(false);
  const [prospectDialogOpen, setProspectDialogOpen] = React.useState(false);

  async function handleScoreBatch() {
    try {
      await scoreBatch.mutateAsync();
      toast({ title: "Batch scoring started", description: "Stale and unscored leads are being scored." });
      setConfirmBatchOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't run batch scoring",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
      setConfirmBatchOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Hot/warm/cold scoring across your existing accounts and manually-logged prospects.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageLeads ? (
            <Button variant="outline" onClick={() => setConfirmBatchOpen(true)} isLoading={scoreBatch.isPending}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              Score all
            </Button>
          ) : null}
          <Button onClick={() => setProspectDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New prospect
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Hot leads"
          icon={Flame}
          isLoading={isSummaryLoading}
          metric={summary?.hotCount}
          format={(v) => formatNumber(v)}
          hint="Score your leads to see hot count."
        />
        <MetricCard
          label="Warm leads"
          icon={Target}
          isLoading={isSummaryLoading}
          metric={summary?.warmCount}
          format={(v) => formatNumber(v)}
          hint="Score your leads to see warm count."
        />
        <MetricCard
          label="Cold leads"
          icon={Users}
          isLoading={isSummaryLoading}
          metric={summary?.coldCount}
          format={(v) => formatNumber(v)}
          hint="Score your leads to see cold count."
        />
        <MetricCard
          label="Unscored leads"
          icon={Sparkles}
          isLoading={isSummaryLoading}
          metric={summary?.unscoredCount}
          format={(v) => formatNumber(v)}
          hint="Leads that haven't been scored yet."
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top hot leads</CardTitle>
        </CardHeader>
        <CardContent>
          {isSummaryLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : summary?.topHotLeads.status === "ok" ? (
            summary.topHotLeads.value.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                None yet — score your leads to surface your hottest opportunities.
              </p>
            ) : (
              <ul className="space-y-2">
                {summary.topHotLeads.value.map((lead) => (
                  <li key={`${lead.leadType}-${lead.id}`} className="flex items-center justify-between gap-2">
                    <Link href={`/leads/${lead.leadType}/${lead.id}`} className="text-sm font-medium hover:underline">
                      {lead.name}
                    </Link>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-muted-foreground">
                        {lead.leadType === "accounts" ? "Account" : "Prospect"}
                      </Badge>
                      <ClassificationBadge classification={lead.classification} />
                      <span className="text-sm text-muted-foreground">{lead.score}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              Insufficient data yet — score your leads to see top hot leads.
            </p>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="prospects">Prospects</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts">
          <AccountsPanel canManageLeads={canManageLeads} />
        </TabsContent>
        <TabsContent value="prospects">
          <ProspectsPanel canManageLeads={canManageLeads} />
        </TabsContent>
      </Tabs>

      <ProspectDialog open={prospectDialogOpen} onOpenChange={setProspectDialogOpen} prospect={null} />

      <ConfirmDialog
        open={confirmBatchOpen}
        onOpenChange={setConfirmBatchOpen}
        title="Score all stale and unscored leads?"
        description="This scores up to 25 accounts/prospects that are new or overdue for a rescore. Each score calls the AI provider."
        confirmLabel="Score now"
        destructive={false}
        isLoading={scoreBatch.isPending}
        onConfirm={handleScoreBatch}
      />
    </div>
  );
}

function classificationFilterToParams(filter: ClassificationFilter) {
  if (filter === ALL) return {};
  if (filter === UNSCORED) return { hasScore: false as const };
  return { classification: filter };
}

function ClassificationFilterSelect({
  value,
  onChange,
}: {
  value: ClassificationFilter;
  onChange: (v: ClassificationFilter) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ClassificationFilter)}>
      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All classifications</SelectItem>
        <SelectItem value="HOT">Hot</SelectItem>
        <SelectItem value="WARM">Warm</SelectItem>
        <SelectItem value="COLD">Cold</SelectItem>
        <SelectItem value={UNSCORED}>Not scored</SelectItem>
      </SelectContent>
    </Select>
  );
}

function AccountsPanel({ canManageLeads }: { canManageLeads: boolean }) {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [classification, setClassification] = React.useState<ClassificationFilter>(ALL);
  const [page, setPage] = React.useState(1);
  const [scoringId, setScoringId] = React.useState<string | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, classification]);

  const { data, isLoading, isError, error, refetch, isFetching } = useAccounts({
    search: debouncedSearch || undefined,
    page,
    pageSize: PAGE_SIZE,
    ...classificationFilterToParams(classification),
  });

  const scoreAccount = useScoreAccount();

  async function handleScore(account: AccountDTO) {
    setScoringId(account.id);
    try {
      const result = await scoreAccount.mutateAsync({ id: account.id });
      if (result.status === "ok") {
        toast({ title: `Scored ${account.name}`, description: `${result.score.score} — ${result.score.classification}` });
      } else {
        toast({
          title: `Couldn't score ${account.name}`,
          description: `Missing: ${result.missing.join(", ")}`,
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Couldn't score account",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setScoringId(null);
    }
  }

  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(debouncedSearch) || classification !== ALL;

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search accounts..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ClassificationFilterSelect value={classification} onChange={setClassification} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load accounts"
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No accounts yet"
          description={
            hasFilters
              ? "No accounts match your filters."
              : "Accounts are created automatically from your sales history. Log a sale to see one here."
          }
        />
      ) : (
        <div className={cn("rounded-lg border border-border bg-card", isFetching && "opacity-70")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Orders</TableHead>
                <TableHead>Total value</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Score</TableHead>
                {canManageLeads ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">
                    <Link href={`/leads/accounts/${account.id}`} className="hover:underline">
                      {account.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{account.industryName || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{account.cityName || account.stateName || "—"}</TableCell>
                  <TableCell>{account.orderCount}</TableCell>
                  <TableCell>{formatCurrency(account.totalOrderValue)}</TableCell>
                  <TableCell>
                    <ClassificationBadge classification={account.latestScore?.classification ?? null} />
                  </TableCell>
                  <TableCell>{account.latestScore?.score ?? "—"}</TableCell>
                  {canManageLeads ? (
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        isLoading={scoringId === account.id}
                        onClick={() => handleScore(account)}
                      >
                        {account.latestScore ? "Rescore" : "Score"}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data && data.data.length > 0 ? (
        <PaginationBar page={page} setPage={setPage} totalPages={totalPages} total={total} />
      ) : null}
    </div>
  );
}

function ProspectsPanel({ canManageLeads }: { canManageLeads: boolean }) {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [classification, setClassification] = React.useState<ClassificationFilter>(ALL);
  const [page, setPage] = React.useState(1);
  const [scoringId, setScoringId] = React.useState<string | null>(null);
  const [editingProspect, setEditingProspect] = React.useState<ProspectDTO | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [deletingProspect, setDeletingProspect] = React.useState<ProspectDTO | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, classification]);

  const { data, isLoading, isError, error, refetch, isFetching } = useProspects({
    search: debouncedSearch || undefined,
    page,
    pageSize: PAGE_SIZE,
    ...classificationFilterToParams(classification),
  });

  const scoreProspect = useScoreProspect();
  const deleteProspect = useDeleteProspect();

  async function handleScore(prospect: ProspectDTO) {
    setScoringId(prospect.id);
    try {
      const result = await scoreProspect.mutateAsync({ id: prospect.id });
      if (result.status === "ok") {
        toast({
          title: `Scored ${prospect.businessName}`,
          description: `${result.score.score} — ${result.score.classification}`,
        });
      } else {
        toast({
          title: `Couldn't score ${prospect.businessName}`,
          description: `Missing: ${result.missing.join(", ")}`,
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Couldn't score prospect",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setScoringId(null);
    }
  }

  async function handleDelete() {
    if (!deletingProspect) return;
    try {
      await deleteProspect.mutateAsync(deletingProspect.id);
      toast({ title: "Prospect deleted" });
      setDeletingProspect(null);
    } catch (err) {
      toast({
        title: "Couldn't delete prospect",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = Boolean(debouncedSearch) || classification !== ALL;

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search prospects..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ClassificationFilterSelect value={classification} onChange={setClassification} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load prospects"
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No prospects yet"
          description={
            hasFilters
              ? "No prospects match your filters."
              : "Log your first prospect to start tracking potential customers."
          }
          action={
            !hasFilters ? (
              <Button
                onClick={() => {
                  setEditingProspect(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                New prospect
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={cn("rounded-lg border border-border bg-card", isFetching && "opacity-70")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assigned</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Score</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((prospect) => (
                <TableRow key={prospect.id}>
                  <TableCell className="font-medium">
                    <Link href={`/leads/prospects/${prospect.id}`} className="hover:underline">
                      {prospect.businessName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{prospect.industryName || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{prospect.cityName || prospect.stateName || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{prospect.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{prospect.assignedUserName || "Unassigned"}</TableCell>
                  <TableCell>
                    <ClassificationBadge classification={prospect.latestScore?.classification ?? null} />
                  </TableCell>
                  <TableCell>{prospect.latestScore?.score ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canManageLeads ? (
                        <Button
                          variant="outline"
                          size="sm"
                          isLoading={scoringId === prospect.id}
                          onClick={() => handleScore(prospect)}
                        >
                          {prospect.latestScore ? "Rescore" : "Score"}
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingProspect(prospect);
                          setDialogOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      {canManageLeads ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setDeletingProspect(prospect)}
                        >
                          Delete
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data && data.data.length > 0 ? (
        <PaginationBar page={page} setPage={setPage} totalPages={totalPages} total={total} />
      ) : null}

      <ProspectDialog open={dialogOpen} onOpenChange={setDialogOpen} prospect={editingProspect} />

      <ConfirmDialog
        open={Boolean(deletingProspect)}
        onOpenChange={(open) => !open && setDeletingProspect(null)}
        title="Delete this prospect?"
        description={`"${deletingProspect?.businessName}" and its score history will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete prospect"
        isLoading={deleteProspect.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function PaginationBar({
  page,
  setPage,
  totalPages,
  total,
}: {
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  totalPages: number;
  total: number;
}) {
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
