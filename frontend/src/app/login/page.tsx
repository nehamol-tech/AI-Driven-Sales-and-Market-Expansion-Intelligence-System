"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery } from "@tanstack/react-query";
import type { UserDTO } from "@ai-sales/shared";
import { apiGet, apiPost, ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/use-toast";
import { AlertCircle, Building2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type LoginValues = z.infer<typeof loginSchema>;

const bootstrapSchema = z.object({
  companyName: z.string().min(1, "Company name is required"),
  companyIndustry: z.string().min(1, "Industry is required"),
  adminName: z.string().min(1, "Your name is required"),
  adminEmail: z.string().min(1, "Email is required").email("Enter a valid email"),
  adminPassword: z.string().min(8, "Password must be at least 8 characters"),
});
type BootstrapValues = z.infer<typeof bootstrapSchema>;

/**
 * Determines whether a company has been set up yet via the public
 * GET /auth/bootstrap-status endpoint (unauthenticated GET /company can't be
 * used for this — it 401s before the controller ever runs, regardless of
 * whether a company exists). Any failure is treated as unknown and both
 * tabs stay available so the user isn't blocked.
 */
function useBootstrapStatus() {
  return useQuery({
    queryKey: ["bootstrap-check"],
    queryFn: async (): Promise<"bootstrapped" | "not-bootstrapped" | "unknown"> => {
      try {
        const { bootstrapped } = await apiGet<{ bootstrapped: boolean }>("/auth/bootstrap-status");
        return bootstrapped ? "bootstrapped" : "not-bootstrapped";
      } catch {
        return "unknown";
      }
    },
    retry: false,
    staleTime: 0,
  });
}

export default function LoginPage() {
  const router = useRouter();
  const { login, user } = useAuth();
  const { data: status, isLoading: statusLoading } = useBootstrapStatus();
  const [tab, setTab] = React.useState<"login" | "setup">("login");
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  React.useEffect(() => {
    if (status === "not-bootstrapped") setTab("setup");
    if (status === "bootstrapped") setTab("login");
  }, [status]);

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const bootstrapForm = useForm<BootstrapValues>({
    resolver: zodResolver(bootstrapSchema),
    defaultValues: {
      companyName: "",
      companyIndustry: "",
      adminName: "",
      adminEmail: "",
      adminPassword: "",
    },
  });

  async function onLogin(values: LoginValues) {
    setServerError(null);
    try {
      await login(values.email, values.password);
      toast({ title: "Welcome back" });
      router.replace("/dashboard");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Login failed";
      setServerError(message);
    }
  }

  async function onBootstrap(values: BootstrapValues) {
    setServerError(null);
    try {
      const newUser = await apiPost<UserDTO>("/auth/bootstrap", values);
      toast({
        title: `Welcome, ${newUser.name}`,
        description: "Your company workspace is ready.",
      });
      // Full navigation so the query cache (in particular /auth/me) is fresh.
      window.location.assign("/dashboard");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Setup failed";
      setServerError(message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
            AI
          </span>
          <h1 className="text-xl font-semibold">AI Sales Expansion Engine</h1>
          <p className="text-sm text-muted-foreground">
            Manage your product catalog, sales history, and expansion dashboard.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-2">
            {statusLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : (
              <>
                <CardTitle>
                  {tab === "login" ? "Sign in" : "Set up your company"}
                </CardTitle>
                <CardDescription>
                  {tab === "login"
                    ? "Enter your credentials to access your workspace."
                    : "Create your company profile and the first admin account."}
                </CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <Tabs value={tab} onValueChange={(v) => setTab(v as "login" | "setup")}>
                <TabsList className="mb-4 grid w-full grid-cols-2">
                  <TabsTrigger value="login">Sign in</TabsTrigger>
                  <TabsTrigger value="setup">
                    <Building2 className="mr-1.5 h-3.5 w-3.5" />
                    First-time setup
                  </TabsTrigger>
                </TabsList>

                {status === "not-bootstrapped" && tab === "login" ? (
                  <p className="mb-3 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    No company workspace exists yet. Use the &quot;First-time setup&quot; tab.
                  </p>
                ) : null}

                <TabsContent value="login">
                  <form
                    className="space-y-4"
                    onSubmit={loginForm.handleSubmit(onLogin)}
                    noValidate
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        {...loginForm.register("email")}
                      />
                      {loginForm.formState.errors.email ? (
                        <p className="text-xs text-destructive">
                          {loginForm.formState.errors.email.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        {...loginForm.register("password")}
                      />
                      {loginForm.formState.errors.password ? (
                        <p className="text-xs text-destructive">
                          {loginForm.formState.errors.password.message}
                        </p>
                      ) : null}
                    </div>
                    {serverError && tab === "login" ? (
                      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {serverError}
                      </p>
                    ) : null}
                    <Button
                      type="submit"
                      className="w-full"
                      isLoading={loginForm.formState.isSubmitting}
                    >
                      Sign in
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="setup">
                  <form
                    className="space-y-4"
                    onSubmit={bootstrapForm.handleSubmit(onBootstrap)}
                    noValidate
                  >
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="companyName">Company name</Label>
                        <Input id="companyName" {...bootstrapForm.register("companyName")} />
                        {bootstrapForm.formState.errors.companyName ? (
                          <p className="text-xs text-destructive">
                            {bootstrapForm.formState.errors.companyName.message}
                          </p>
                        ) : null}
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="companyIndustry">Industry</Label>
                        <Input
                          id="companyIndustry"
                          placeholder="e.g. Manufacturing"
                          {...bootstrapForm.register("companyIndustry")}
                        />
                        {bootstrapForm.formState.errors.companyIndustry ? (
                          <p className="text-xs text-destructive">
                            {bootstrapForm.formState.errors.companyIndustry.message}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="adminName">Your name</Label>
                      <Input id="adminName" {...bootstrapForm.register("adminName")} />
                      {bootstrapForm.formState.errors.adminName ? (
                        <p className="text-xs text-destructive">
                          {bootstrapForm.formState.errors.adminName.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="adminEmail">Admin email</Label>
                      <Input
                        id="adminEmail"
                        type="email"
                        {...bootstrapForm.register("adminEmail")}
                      />
                      {bootstrapForm.formState.errors.adminEmail ? (
                        <p className="text-xs text-destructive">
                          {bootstrapForm.formState.errors.adminEmail.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="adminPassword">Admin password</Label>
                      <Input
                        id="adminPassword"
                        type="password"
                        {...bootstrapForm.register("adminPassword")}
                      />
                      {bootstrapForm.formState.errors.adminPassword ? (
                        <p className="text-xs text-destructive">
                          {bootstrapForm.formState.errors.adminPassword.message}
                        </p>
                      ) : null}
                    </div>
                    {serverError && tab === "setup" ? (
                      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {serverError}
                      </p>
                    ) : null}
                    <Button
                      type="submit"
                      className="w-full"
                      isLoading={bootstrapForm.formState.isSubmitting}
                    >
                      Create workspace
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
