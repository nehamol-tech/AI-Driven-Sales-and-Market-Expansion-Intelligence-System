"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, MapPin, Target, X } from "lucide-react";
import {
  useAddOperatingState,
  useAddTargetState,
  useCompany,
  useRemoveOperatingState,
  useRemoveTargetState,
  useUpdateCompany,
} from "@/hooks/use-company";
import { useStates } from "@/hooks/use-states";
import { usePermissions } from "@/hooks/use-permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";

const companySchema = z.object({
  name: z.string().min(1, "Company name is required"),
  industry: z.string().min(1, "Industry is required"),
  description: z.string().optional(),
  website: z.string().optional(),
  contactEmail: z.string().email("Enter a valid email").optional().or(z.literal("")),
  contactPhone: z.string().optional(),
  headquartersStateId: z.string().optional(),
});
type CompanyValues = z.infer<typeof companySchema>;

export default function CompanyPage() {
  const { data: company, isLoading, isError, error, refetch } = useCompany();
  const { data: states } = useStates();
  const { canEditCompany } = usePermissions();
  const updateCompany = useUpdateCompany();

  const [editing, setEditing] = React.useState(false);

  const form = useForm<CompanyValues>({
    resolver: zodResolver(companySchema),
    values: company
      ? {
          name: company.name,
          industry: company.industry,
          description: company.description ?? "",
          website: company.website ?? "",
          contactEmail: company.contactEmail ?? "",
          contactPhone: company.contactPhone ?? "",
          headquartersStateId: company.headquartersStateId ?? "",
        }
      : undefined,
  });

  async function onSubmit(values: CompanyValues) {
    try {
      await updateCompany.mutateAsync({
        name: values.name,
        industry: values.industry,
        description: values.description || null,
        website: values.website || null,
        contactEmail: values.contactEmail || null,
        contactPhone: values.contactPhone || null,
        headquartersStateId: values.headquartersStateId || null,
      });
      toast({ title: "Company profile updated" });
      setEditing(false);
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !company) {
    return (
      <EmptyState
        title="Couldn't load company profile"
        description={error instanceof ApiError ? error.message : "Please try again."}
        action={<Button onClick={() => refetch()}>Try again</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Company</h1>
        <p className="text-sm text-muted-foreground">
          Your company profile and expansion footprint.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4" />
              Profile
            </CardTitle>
            <CardDescription>
              {canEditCompany
                ? "Visible to everyone in your workspace. Only admins can edit it."
                : "Visible to everyone in your workspace. Only admins can edit it."}
            </CardDescription>
          </div>
          {canEditCompany && !editing ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {editing && canEditCompany ? (
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Company name</Label>
                  <Input id="name" {...form.register("name")} />
                  {form.formState.errors.name ? (
                    <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="industry">Industry</Label>
                  <Input id="industry" {...form.register("industry")} />
                  {form.formState.errors.industry ? (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.industry.message}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Input id="description" {...form.register("description")} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="website">Website</Label>
                  <Input id="website" {...form.register("website")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="contactEmail">Contact email</Label>
                  <Input id="contactEmail" type="email" {...form.register("contactEmail")} />
                  {form.formState.errors.contactEmail ? (
                    <p className="text-xs text-destructive">
                      {form.formState.errors.contactEmail.message}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="contactPhone">Contact phone</Label>
                  <Input id="contactPhone" {...form.register("contactPhone")} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="headquartersStateId">Headquarters state</Label>
                  <Select
                    value={form.watch("headquartersStateId") || undefined}
                    onValueChange={(v) => form.setValue("headquartersStateId", v)}
                  >
                    <SelectTrigger id="headquartersStateId">
                      <SelectValue placeholder="Select a state" />
                    </SelectTrigger>
                    <SelectContent>
                      {states?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    form.reset();
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" isLoading={form.formState.isSubmitting}>
                  Save changes
                </Button>
              </div>
            </form>
          ) : (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              <Field label="Company name" value={company.name} />
              <Field label="Industry" value={company.industry} />
              <Field label="Description" value={company.description} />
              <Field label="Website" value={company.website} />
              <Field label="Contact email" value={company.contactEmail} />
              <Field label="Contact phone" value={company.contactPhone} />
            </dl>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StatesCard
          title="Operating states"
          icon={MapPin}
          description="States where your company currently does business."
          states={company.operatingStates}
          canEdit={canEditCompany}
          renderAdd={canEditCompany ? <AddOperatingState allStates={states ?? []} existingIds={company.operatingStates.map((s) => s.stateId)} /> : null}
          removeSlot="operating"
        />
        <StatesCard
          title="Target expansion states"
          icon={Target}
          description="States your company is planning to expand into."
          states={company.targetStates}
          canEdit={canEditCompany}
          renderAdd={canEditCompany ? <AddTargetState allStates={states ?? []} existingIds={company.targetStates.map((s) => s.stateId)} /> : null}
          removeSlot="target"
        />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}

function StatesCard({
  title,
  icon: Icon,
  description,
  states,
  canEdit,
  renderAdd,
  removeSlot,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  states: { stateId: string; stateName: string; notes?: string | null }[];
  canEdit: boolean;
  renderAdd: React.ReactNode;
  removeSlot: "operating" | "target";
}) {
  const removeOperating = useRemoveOperatingState();
  const removeTarget = useRemoveTargetState();

  async function handleRemove(stateId: string) {
    try {
      if (removeSlot === "operating") await removeOperating.mutateAsync(stateId);
      else await removeTarget.mutateAsync(stateId);
      toast({ title: "State removed" });
    } catch (err) {
      toast({
        title: "Couldn't remove state",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {states.length === 0 ? (
          <p className="text-sm text-muted-foreground">None added yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {states.map((s) => (
              <Badge key={s.stateId} variant="secondary" className="gap-1 pr-1">
                {s.stateName}
                {canEdit ? (
                  <button
                    onClick={() => handleRemove(s.stateId)}
                    className="ml-1 rounded-full p-0.5 hover:bg-background"
                    aria-label={`Remove ${s.stateName}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </Badge>
            ))}
          </div>
        )}
        {canEdit ? renderAdd : null}
      </CardContent>
    </Card>
  );
}

function AddOperatingState({
  allStates,
  existingIds,
}: {
  allStates: { id: string; name: string }[];
  existingIds: string[];
}) {
  const [selected, setSelected] = React.useState<string>("");
  const addOperating = useAddOperatingState();
  const available = allStates.filter((s) => !existingIds.includes(s.id));

  async function handleAdd() {
    if (!selected) return;
    try {
      await addOperating.mutateAsync(selected);
      setSelected("");
      toast({ title: "Operating state added" });
    } catch (err) {
      toast({
        title: "Couldn't add state",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  if (available.length === 0) return null;

  return (
    <div className="flex gap-2 pt-2">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Add a state..." />
        </SelectTrigger>
        <SelectContent>
          {available.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        disabled={!selected}
        isLoading={addOperating.isPending}
      >
        Add
      </Button>
    </div>
  );
}

function AddTargetState({
  allStates,
  existingIds,
}: {
  allStates: { id: string; name: string }[];
  existingIds: string[];
}) {
  const [selected, setSelected] = React.useState<string>("");
  const addTarget = useAddTargetState();
  const available = allStates.filter((s) => !existingIds.includes(s.id));

  async function handleAdd() {
    if (!selected) return;
    try {
      await addTarget.mutateAsync({ stateId: selected });
      setSelected("");
      toast({ title: "Target state added" });
    } catch (err) {
      toast({
        title: "Couldn't add state",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  if (available.length === 0) return null;

  return (
    <div className="flex gap-2 pt-2">
      <Select value={selected} onValueChange={setSelected}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Add a target state..." />
        </SelectTrigger>
        <SelectContent>
          {available.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        onClick={handleAdd}
        disabled={!selected}
        isLoading={addTarget.isPending}
      >
        Add
      </Button>
    </div>
  );
}
