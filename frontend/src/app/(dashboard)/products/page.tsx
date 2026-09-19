"use client";

import * as React from "react";
import { Package, Plus, Search, Pencil, Trash2 } from "lucide-react";
import {
  useCreateProduct,
  useDeleteProduct,
  useProducts,
  useUpdateProduct,
  type ProductInput,
} from "@/hooks/use-products";
import { useIndustries, useBusinessTypes } from "@/hooks/use-industries";
import { usePermissions } from "@/hooks/use-permissions";
import type { ProductDTO } from "@ai-sales/shared";
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
import { cn, formatCurrency } from "@/lib/utils";

const PAGE_SIZE = 20;

export default function ProductsPage() {
  const { canManageProducts } = usePermissions();
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [activeFilter, setActiveFilter] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, activeFilter]);

  const { data, isLoading, isError, error, refetch, isFetching } = useProducts({
    search: debouncedSearch || undefined,
    isActive: activeFilter === "all" ? undefined : activeFilter === "active",
    page,
    pageSize: PAGE_SIZE,
  });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingProduct, setEditingProduct] = React.useState<ProductDTO | null>(null);
  const [deletingProduct, setDeletingProduct] = React.useState<ProductDTO | null>(null);

  const deleteProduct = useDeleteProduct();

  function openCreate() {
    setEditingProduct(null);
    setDialogOpen(true);
  }

  function openEdit(product: ProductDTO) {
    setEditingProduct(product);
    setDialogOpen(true);
  }

  async function handleDelete() {
    if (!deletingProduct) return;
    try {
      await deleteProduct.mutateAsync(deletingProduct.id);
      toast({ title: "Product deleted" });
      setDeletingProduct(null);
    } catch (err) {
      toast({
        title: "Couldn't delete product",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-sm text-muted-foreground">
            Your product catalog, targeting, and pricing.
          </p>
        </div>
        {canManageProducts ? (
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            New product
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or SKU..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="inactive">Inactive only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load products"
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No products yet"
          description={
            debouncedSearch || activeFilter !== "all"
              ? "No products match your filters."
              : "Add your first product to start logging sales against it."
          }
          action={
            canManageProducts && !debouncedSearch && activeFilter === "all" ? (
              <Button onClick={openCreate}>
                <Plus className="mr-1.5 h-4 w-4" />
                New product
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
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Status</TableHead>
                {canManageProducts ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell className="text-muted-foreground">{product.sku}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {product.category || "—"}
                  </TableCell>
                  <TableCell>{formatCurrency(product.price)}</TableCell>
                  <TableCell>{product.availableQty}</TableCell>
                  <TableCell>
                    <Badge variant={product.isActive ? "success" : "outline"}>
                      {product.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  {canManageProducts ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(product)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeletingProduct(product)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
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

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editingProduct}
      />

      <ConfirmDialog
        open={Boolean(deletingProduct)}
        onOpenChange={(open) => !open && setDeletingProduct(null)}
        title="Delete this product?"
        description={`"${deletingProduct?.name}" will be permanently removed from your catalog. This cannot be undone.`}
        confirmLabel="Delete product"
        isLoading={deleteProduct.isPending}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function ProductDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductDTO | null;
}) {
  const isEdit = Boolean(product);
  const { data: industries } = useIndustries();
  const { data: businessTypes } = useBusinessTypes();
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();

  const [form, setForm] = React.useState<ProductInput>(() => emptyForm());
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    if (product) {
      setForm({
        name: product.name,
        sku: product.sku,
        category: product.category ?? "",
        description: product.description ?? "",
        price: product.price,
        minOrderQty: product.minOrderQty,
        availableQty: product.availableQty,
        keywords: product.keywords,
        isActive: product.isActive,
        targetIndustryIds: product.targetIndustryIds,
        targetBusinessTypeIds: product.targetBusinessTypeIds,
      });
    } else {
      setForm(emptyForm());
    }
    setErrors({});
  }, [open, product]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Name is required";
    if (!form.sku.trim()) next.sku = "SKU is required";
    if (!form.price.trim() || Number.isNaN(Number(form.price)) || Number(form.price) < 0) {
      next.price = "Enter a valid non-negative price";
    }
    if (form.minOrderQty < 1) next.minOrderQty = "Must be at least 1";
    if (form.availableQty < 0) next.availableQty = "Cannot be negative";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    try {
      if (isEdit && product) {
        await updateProduct.mutateAsync({ id: product.id, input: form });
        toast({ title: "Product updated" });
      } else {
        await createProduct.mutateAsync(form);
        toast({ title: "Product created" });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: isEdit ? "Couldn't update product" : "Couldn't create product",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  const isSubmitting = createProduct.isPending || updateProduct.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit product" : "New product"}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-name">Name</Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-sku">SKU</Label>
              <Input
                id="p-sku"
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              />
              {errors.sku ? <p className="text-xs text-destructive">{errors.sku}</p> : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="p-category">Category</Label>
              <Input
                id="p-category"
                value={form.category ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-keywords">Keywords (comma separated)</Label>
              <Input
                id="p-keywords"
                value={form.keywords.join(", ")}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    keywords: e.target.value
                      .split(",")
                      .map((k) => k.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-description">Description</Label>
            <Input
              id="p-description"
              value={form.description ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-price">Price (INR)</Label>
              <Input
                id="p-price"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
              {errors.price ? <p className="text-xs text-destructive">{errors.price}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-minOrderQty">Min order qty</Label>
              <Input
                id="p-minOrderQty"
                type="number"
                min={1}
                value={form.minOrderQty}
                onChange={(e) =>
                  setForm((f) => ({ ...f, minOrderQty: Number(e.target.value) || 0 }))
                }
              />
              {errors.minOrderQty ? (
                <p className="text-xs text-destructive">{errors.minOrderQty}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-availableQty">Available qty</Label>
              <Input
                id="p-availableQty"
                type="number"
                min={0}
                value={form.availableQty}
                onChange={(e) =>
                  setForm((f) => ({ ...f, availableQty: Number(e.target.value) || 0 }))
                }
              />
              {errors.availableQty ? (
                <p className="text-xs text-destructive">{errors.availableQty}</p>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <MultiCheckList
              label="Target industries"
              options={industries ?? []}
              selectedIds={form.targetIndustryIds}
              onChange={(ids) => setForm((f) => ({ ...f, targetIndustryIds: ids }))}
            />
            <MultiCheckList
              label="Target business types"
              options={businessTypes ?? []}
              selectedIds={form.targetBusinessTypeIds}
              onChange={(ids) => setForm((f) => ({ ...f, targetBusinessTypeIds: ids }))}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            Active (visible for sales entry)
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? "Save changes" : "Create product"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MultiCheckList({
  label,
  options,
  selectedIds,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="max-h-36 overflow-y-auto rounded-md border border-border p-2">
        {options.length === 0 ? (
          <p className="text-xs text-muted-foreground">None available.</p>
        ) : (
          <div className="space-y-1">
            {options.map((opt) => (
              <label key={opt.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border"
                  checked={selectedIds.includes(opt.id)}
                  onChange={() => toggle(opt.id)}
                />
                {opt.name}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function emptyForm(): ProductInput {
  return {
    name: "",
    sku: "",
    category: "",
    description: "",
    price: "",
    minOrderQty: 1,
    availableQty: 0,
    keywords: [],
    isActive: true,
    targetIndustryIds: [],
    targetBusinessTypeIds: [],
  };
}
