"use client";

import * as React from "react";
import Link from "next/link";
import { Receipt, Plus, Pencil, Trash2, Upload } from "lucide-react";
import {
  useCreateSalesRecord,
  useDeleteSalesRecord,
  useSalesRecords,
  useUpdateSalesRecord,
  type SalesRecordInput,
} from "@/hooks/use-sales";
import { useProducts } from "@/hooks/use-products";
import { useStates, useCities } from "@/hooks/use-states";
import { useIndustries } from "@/hooks/use-industries";
import { useUsers } from "@/hooks/use-users";
import { useDistributors } from "@/hooks/use-distributors";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/lib/auth-context";
import type { SalesRecordDTO } from "@ai-sales/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";
import { cn, formatCurrency, formatDate } from "@/lib/utils";

const PAGE_SIZE = 20;
const ALL = "__all__";

export default function SalesPage() {
  const { canManageUsers } = usePermissions();
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [stateId, setStateId] = React.useState(ALL);
  const [productId, setProductId] = React.useState(ALL);
  const [salespersonId, setSalespersonId] = React.useState(ALL);
  const [page, setPage] = React.useState(1);

  const { data: states } = useStates();
  const { data: productsPage } = useProducts({ pageSize: 100 });
  const { data: users } = useUsers();

  const filters = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    stateId: stateId === ALL ? undefined : stateId,
    productId: productId === ALL ? undefined : productId,
    salespersonId: salespersonId === ALL ? undefined : salespersonId,
    page,
    pageSize: PAGE_SIZE,
  };

  React.useEffect(() => {
    setPage(1);
  }, [dateFrom, dateTo, stateId, productId, salespersonId]);

  const { data, isLoading, isError, error, refetch, isFetching } = useSalesRecords(filters);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingRecord, setEditingRecord] = React.useState<SalesRecordDTO | null>(null);
  const [deletingRecord, setDeletingRecord] = React.useState<SalesRecordDTO | null>(null);
  const deleteRecord = useDeleteSalesRecord();

  function openCreate() {
    setEditingRecord(null);
    setDialogOpen(true);
  }
  function openEdit(record: SalesRecordDTO) {
    setEditingRecord(record);
    setDialogOpen(true);
  }

  async function handleDelete() {
    if (!deletingRecord) return;
    try {
      await deleteRecord.mutateAsync(deletingRecord.id);
      toast({ title: "Sales record deleted" });
      setDeletingRecord(null);
    } catch (err) {
      toast({
        title: "Couldn't delete record",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters =
    dateFrom || dateTo || stateId !== ALL || productId !== ALL || salespersonId !== ALL;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
          <p className="text-sm text-muted-foreground">
            Sales history logged manually or imported via CSV.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/sales/import">
              <Upload className="mr-1.5 h-4 w-4" />
              Import CSV
            </Link>
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            Log sale
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="dateFrom" className="text-xs">From</Label>
          <Input
            id="dateFrom"
            type="date"
            className="w-40"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dateTo" className="text-xs">To</Label>
          <Input
            id="dateTo"
            type="date"
            className="w-40"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">State</Label>
          <Select value={stateId} onValueChange={setStateId}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All states</SelectItem>
              {states?.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Product</Label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All products</SelectItem>
              {productsPage?.data.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManageUsers ? (
          <div className="space-y-1.5">
            <Label className="text-xs">Salesperson</Label>
            <Select value={salespersonId} onValueChange={setSalespersonId}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All salespeople</SelectItem>
                {users?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDateFrom("");
              setDateTo("");
              setStateId(ALL);
              setProductId(ALL);
              setSalespersonId(ALL);
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load sales records"
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No sales records yet"
          description={
            hasFilters
              ? "No sales records match your filters."
              : "Log your first sale manually, or import historical sales via CSV."
          }
          action={
            !hasFilters ? (
              <div className="flex gap-2">
                <Button onClick={openCreate}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Log sale
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/sales/import">Import CSV</Link>
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <div className={cn("rounded-lg border border-border bg-card", isFetching && "opacity-70")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Salesperson</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((record) => (
                <TableRow key={record.id}>
                  <TableCell>{formatDate(record.date)}</TableCell>
                  <TableCell className="font-medium">
                    {record.customerName}
                    {record.isNewCustomer ? (
                      <Badge variant="secondary" className="ml-2">New</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {record.productName || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {record.stateName || "—"}
                  </TableCell>
                  <TableCell>{record.quantity}</TableCell>
                  <TableCell>{formatCurrency(record.orderValue)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {record.salespersonName || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {record.source === "CSV_IMPORT" ? "Imported" : "Manual"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(record)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeletingRecord(record)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data && data.data.length > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
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
      ) : null}

      <SalesRecordDialog open={dialogOpen} onOpenChange={setDialogOpen} record={editingRecord} />

      <ConfirmDialog
        open={Boolean(deletingRecord)}
        onOpenChange={(open) => !open && setDeletingRecord(null)}
        title="Delete this sales record?"
        description={`The record for "${deletingRecord?.customerName}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete record"
        isLoading={deleteRecord.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function SalesRecordDialog({
  open,
  onOpenChange,
  record,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: SalesRecordDTO | null;
}) {
  const isEdit = Boolean(record);
  const { user } = useAuth();
  const { canManageUsers } = usePermissions();
  const { data: productsPage } = useProducts({ pageSize: 100, isActive: true });
  const { data: states } = useStates();
  const { data: industries } = useIndustries();
  const { data: users } = useUsers();
  const { data: distributorsPage } = useDistributors();

  const createRecord = useCreateSalesRecord();
  const updateRecord = useUpdateSalesRecord();

  const [form, setForm] = React.useState<SalesRecordInput>(() => emptyForm(user?.id));
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const { data: cities } = useCities(form.stateId || undefined);

  React.useEffect(() => {
    if (!open) return;
    if (record) {
      setForm({
        date: record.date.slice(0, 10),
        productId: record.productId,
        customerName: record.customerName,
        stateId: record.stateId,
        cityId: record.cityId,
        industryId: record.industryId,
        quantity: record.quantity,
        orderValue: record.orderValue,
        salespersonId: record.salespersonId,
        isNewCustomer: record.isNewCustomer,
        distributorId: record.distributorId ?? null,
      });
    } else {
      setForm(emptyForm(user?.id));
    }
    setErrors({});
  }, [open, record, user?.id]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.date) next.date = "Date is required";
    if (!form.customerName.trim()) next.customerName = "Customer name is required";
    if (!form.quantity || form.quantity < 1) next.quantity = "Must be at least 1";
    if (!form.orderValue.trim() || Number.isNaN(Number(form.orderValue)) || Number(form.orderValue) < 0) {
      next.orderValue = "Enter a valid non-negative amount";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    try {
      if (isEdit && record) {
        await updateRecord.mutateAsync({ id: record.id, input: form });
        toast({ title: "Sales record updated" });
      } else {
        await createRecord.mutateAsync(form);
        toast({ title: "Sale logged" });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: isEdit ? "Couldn't update record" : "Couldn't log sale",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const isSubmitting = createRecord.isPending || updateRecord.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit sales record" : "Log a sale"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-date">Date</Label>
              <Input
                id="s-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
              {errors.date ? <p className="text-xs text-destructive">{errors.date}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-customer">Customer name</Label>
              <Input
                id="s-customer"
                value={form.customerName}
                onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              />
              {errors.customerName ? (
                <p className="text-xs text-destructive">{errors.customerName}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Product</Label>
            <Select
              value={form.productId ?? ""}
              onValueChange={(v) => setForm((f) => ({ ...f, productId: v || null }))}
            >
              <SelectTrigger><SelectValue placeholder="Select a product (optional)" /></SelectTrigger>
              <SelectContent>
                {productsPage?.data.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>State</Label>
              <Select
                value={form.stateId ?? ""}
                onValueChange={(v) => setForm((f) => ({ ...f, stateId: v || null, cityId: null }))}
              >
                <SelectTrigger><SelectValue placeholder="Select a state (optional)" /></SelectTrigger>
                <SelectContent>
                  {states?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Select
                value={form.cityId ?? ""}
                onValueChange={(v) => setForm((f) => ({ ...f, cityId: v || null }))}
                disabled={!form.stateId}
              >
                <SelectTrigger><SelectValue placeholder="Select a city (optional)" /></SelectTrigger>
                <SelectContent>
                  {cities?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Industry</Label>
            <Select
              value={form.industryId ?? ""}
              onValueChange={(v) => setForm((f) => ({ ...f, industryId: v || null }))}
            >
              <SelectTrigger><SelectValue placeholder="Select an industry (optional)" /></SelectTrigger>
              <SelectContent>
                {industries?.map((i) => (
                  <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="s-qty">Quantity</Label>
              <Input
                id="s-qty"
                type="number"
                min={1}
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) || 0 }))}
              />
              {errors.quantity ? <p className="text-xs text-destructive">{errors.quantity}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-value">Order value (INR)</Label>
              <Input
                id="s-value"
                inputMode="decimal"
                value={form.orderValue}
                onChange={(e) => setForm((f) => ({ ...f, orderValue: e.target.value }))}
              />
              {errors.orderValue ? (
                <p className="text-xs text-destructive">{errors.orderValue}</p>
              ) : null}
            </div>
          </div>

          {canManageUsers ? (
            <div className="space-y-1.5">
              <Label>Salesperson</Label>
              <Select
                value={form.salespersonId ?? ""}
                onValueChange={(v) => setForm((f) => ({ ...f, salespersonId: v || null }))}
              >
                <SelectTrigger><SelectValue placeholder="Select a salesperson" /></SelectTrigger>
                <SelectContent>
                  {users?.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Salesperson</Label>
              <Input value={user?.name ?? "Me"} disabled />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Distributor</Label>
            <Select
              value={form.distributorId ?? ""}
              onValueChange={(v) => setForm((f) => ({ ...f, distributorId: v || null }))}
            >
              <SelectTrigger><SelectValue placeholder="No distributor (optional)" /></SelectTrigger>
              <SelectContent>
                {distributorsPage?.data.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Which distributor or dealer, if any, this order is attributed to — feeds distributor performance analytics.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={form.isNewCustomer}
              onChange={(e) => setForm((f) => ({ ...f, isNewCustomer: e.target.checked }))}
            />
            This is a new customer
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? "Save changes" : "Log sale"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function emptyForm(userId?: string): SalesRecordInput {
  return {
    date: new Date().toISOString().slice(0, 10),
    productId: null,
    customerName: "",
    stateId: null,
    cityId: null,
    industryId: null,
    quantity: 1,
    orderValue: "",
    salespersonId: userId ?? null,
    isNewCustomer: false,
    distributorId: null,
  };
}
