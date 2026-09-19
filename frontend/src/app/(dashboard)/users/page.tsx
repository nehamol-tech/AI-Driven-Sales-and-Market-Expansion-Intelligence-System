"use client";

import * as React from "react";
import { Users as UsersIcon, Plus, ShieldOff, ShieldCheck, ShieldAlert } from "lucide-react";
import { ROLES, ROLE_LABELS, type Role } from "@ai-sales/shared";
import type { UserDTO } from "@ai-sales/shared";
import {
  useCreateUser,
  useDeactivateUser,
  useUpdateUser,
  useUsers,
  type CreateUserInput,
} from "@/hooks/use-users";
import { usePermissions } from "@/hooks/use-permissions";
import { useAuth } from "@/lib/auth-context";
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
import { formatDate } from "@/lib/utils";

export default function UsersPage() {
  const { canManageUsers } = usePermissions();

  if (!canManageUsers) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Access restricted"
        description="Only admins can manage users. Contact your workspace admin if you need access changes."
      />
    );
  }

  return <UsersManager />;
}

function UsersManager() {
  const { user: currentUser } = useAuth();
  const { data: users, isLoading, isError, error, refetch } = useUsers();
  const updateUser = useUpdateUser();
  const deactivateUser = useDeactivateUser();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [deactivating, setDeactivating] = React.useState<UserDTO | null>(null);

  async function handleRoleChange(u: UserDTO, role: Role) {
    try {
      await updateUser.mutateAsync({ id: u.id, input: { role } });
      toast({ title: `${u.name}'s role updated to ${ROLE_LABELS[role]}` });
    } catch (err) {
      toast({
        title: "Couldn't update role",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleReactivate(u: UserDTO) {
    try {
      await updateUser.mutateAsync({ id: u.id, input: { isActive: true } });
      toast({ title: `${u.name} reactivated` });
    } catch (err) {
      toast({
        title: "Couldn't reactivate user",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleDeactivate() {
    if (!deactivating) return;
    try {
      await deactivateUser.mutateAsync(deactivating.id);
      toast({ title: `${deactivating.name} deactivated` });
      setDeactivating(null);
    } catch (err) {
      toast({
        title: "Couldn't deactivate user",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage who has access to your workspace and their roles.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          New user
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          title="Couldn't load users"
          description={error instanceof ApiError ? error.message : "Please try again."}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      ) : !users || users.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No users yet"
          description="Create the first teammate account for this workspace."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              New user
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">
                    {u.name}
                    {u.id === currentUser?.id ? (
                      <Badge variant="outline" className="ml-2">You</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Select
                      value={u.role}
                      onValueChange={(v) => handleRoleChange(u, v as Role)}
                      disabled={u.id === currentUser?.id}
                    >
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? "success" : "outline"}>
                      {u.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    {u.id === currentUser?.id ? null : u.isActive ? (
                      <Button variant="ghost" size="icon" onClick={() => setDeactivating(u)}>
                        <ShieldOff className="h-4 w-4 text-destructive" />
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" onClick={() => handleReactivate(u)}>
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateUserDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={Boolean(deactivating)}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title="Deactivate this user?"
        description={`"${deactivating?.name}" will lose access to the workspace. You can reactivate them later.`}
        confirmLabel="Deactivate"
        isLoading={deactivateUser.isPending}
        onConfirm={handleDeactivate}
      />
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createUser = useCreateUser();
  const [form, setForm] = React.useState<CreateUserInput>({
    name: "",
    email: "",
    password: "",
    role: "SALES_USER",
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (open) {
      setForm({ name: "", email: "", password: "", role: "SALES_USER" });
      setErrors({});
    }
  }, [open]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = "Name is required";
    if (!form.email.trim() || !/^\S+@\S+\.\S+$/.test(form.email)) next.email = "Enter a valid email";
    if (form.password.length < 8) next.password = "Password must be at least 8 characters";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    try {
      await createUser.mutateAsync(form);
      toast({ title: "User created" });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Couldn't create user",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="u-name">Name</Label>
            <Input
              id="u-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-email">Email</Label>
            <Input
              id="u-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
            {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-password">Temporary password</Label>
            <Input
              id="u-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
            {errors.password ? <p className="text-xs text-destructive">{errors.password}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createUser.isPending}>
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
