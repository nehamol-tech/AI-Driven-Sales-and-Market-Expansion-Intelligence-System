"use client";

import * as React from "react";
import { AlertTriangle, CalendarClock, CalendarDays, ListChecks, Plus } from "lucide-react";
import type { FollowUpDTO, FollowUpDueByFilter, FollowUpStatus, LeadType } from "@ai-sales/shared";
import { useFollowUps } from "@/hooks/use-follow-ups";
import { FollowUpDialog } from "@/components/follow-ups/follow-up-dialog";
import { FollowUpRow } from "@/components/follow-ups/follow-up-row";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError } from "@/lib/api-client";
import { formatNumber } from "@/lib/utils";

const ALL = "all";
type StatusFilter = "all" | FollowUpStatus;
type LeadTypeFilter = "all" | LeadType;

export default function FollowUpsPage() {
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>(ALL);
  const [dueByFilter, setDueByFilter] = React.useState<FollowUpDueByFilter>("all");
  const [leadTypeFilter, setLeadTypeFilter] = React.useState<LeadTypeFilter>(ALL);

  const filters = {
    status: statusFilter === ALL ? undefined : statusFilter,
    dueBy: dueByFilter,
    leadType: leadTypeFilter === ALL ? undefined : leadTypeFilter,
  };

  const { data, isLoading, isError, error, refetch } = useFollowUps(filters);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingFollowUp, setEditingFollowUp] = React.useState<FollowUpDTO | null>(null);

  function openCreate() {
    setEditingFollowUp(null);
    setDialogOpen(true);
  }
  function openReschedule(followUp: FollowUpDTO) {
    setEditingFollowUp(followUp);
    setDialogOpen(true);
  }

  const items = data?.items ?? [];
  const hasFilters = statusFilter !== ALL || dueByFilter !== "all" || leadTypeFilter !== ALL;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Follow-ups</h1>
          <p className="text-sm text-muted-foreground">
            Scheduled and completed follow-ups against your accounts and prospects.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          New follow-up
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Overdue"
          icon={AlertTriangle}
          isLoading={isLoading}
          metric={data ? { status: "ok" as const, value: data.overdueCount } : undefined}
          format={(v) => formatNumber(v)}
        />
        <MetricCard
          label="Due Today"
          icon={CalendarClock}
          isLoading={isLoading}
          metric={data ? { status: "ok" as const, value: data.todayCount } : undefined}
          format={(v) => formatNumber(v)}
        />
        <MetricCard
          label="Due This Week"
          icon={CalendarDays}
          isLoading={isLoading}
          metric={data ? { status: "ok" as const, value: data.weekCount } : undefined}
          format={(v) => formatNumber(v)}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Select value={dueByFilter} onValueChange={(v) => setDueByFilter(v as FollowUpDueByFilter)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any due date</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="today">Due today</SelectItem>
            <SelectItem value="week">Due this week</SelectItem>
          </SelectContent>
        </Select>
        <Select value={leadTypeFilter} onValueChange={(v) => setLeadTypeFilter(v as LeadTypeFilter)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Accounts &amp; prospects</SelectItem>
            <SelectItem value="accounts">Accounts</SelectItem>
            <SelectItem value="prospects">Prospects</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter(ALL);
              setDueByFilter("all");
              setLeadTypeFilter(ALL);
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load follow-ups"
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={hasFilters ? "No follow-ups match your filters." : "No follow-ups scheduled yet."}
          description={
            hasFilters
              ? "Try a different status, due date, or lead type filter."
              : "Schedule a follow-up against an account or prospect to keep your pipeline moving."
          }
          action={!hasFilters ? <Button onClick={openCreate}>New follow-up</Button> : undefined}
        />
      ) : (
        <div className="space-y-3">
          {items.map((followUp) => (
            <FollowUpRow key={followUp.id} followUp={followUp} onReschedule={openReschedule} />
          ))}
        </div>
      )}

      <FollowUpDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingFollowUp(null);
        }}
        followUp={editingFollowUp}
      />
    </div>
  );
}
