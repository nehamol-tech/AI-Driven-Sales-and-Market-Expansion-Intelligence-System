"use client";

import * as React from "react";
import type { AdConnectionDTO } from "@ai-sales/shared";
import { RefreshCw, Unplug } from "lucide-react";
import { ConnectionStatusBadge } from "./connection-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { useConnectPlatform, useDisconnectPlatform, useSyncPlatform } from "@/hooks/use-advertising";
import { ApiError } from "@/lib/api-client";
import { formatDate } from "@/lib/utils";

const PLATFORM_TITLES: Record<AdConnectionDTO["platform"], string> = {
  META: "Meta Ads",
  GOOGLE: "Google Ads",
};

export function ConnectionCard({ connection }: { connection: AdConnectionDTO }) {
  const { isAdmin, isManager } = usePermissions();
  const canConnect = isAdmin;
  const canSync = isAdmin || isManager;

  const connect = useConnectPlatform();
  const disconnect = useDisconnectPlatform();
  const sync = useSyncPlatform();
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = React.useState(false);

  async function handleConnect() {
    try {
      const result = await connect.mutateAsync(connection.platform);
      if (result.configured && result.url) {
        window.location.href = result.url;
        return;
      }
      toast({ title: `${PLATFORM_TITLES[connection.platform]} isn't connectable yet`, description: result.message });
    } catch (err) {
      toast({
        title: "Couldn't start the connection",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  async function handleDisconnect() {
    try {
      await disconnect.mutateAsync(connection.platform);
      toast({ title: `${PLATFORM_TITLES[connection.platform]} disconnected` });
      setConfirmDisconnectOpen(false);
    } catch (err) {
      toast({
        title: "Couldn't disconnect",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
      setConfirmDisconnectOpen(false);
    }
  }

  async function handleSync() {
    try {
      const result = await sync.mutateAsync(connection.platform);
      if (!result.configured) {
        toast({ title: "Sync unavailable", description: result.message });
        return;
      }
      toast({
        title: "Sync complete",
        description: `${result.campaignsSynced ?? 0} campaign(s), ${result.spendRecordsSynced ?? 0} spend record(s) synced.${
          result.errors && result.errors.length > 0 ? ` ${result.errors.length} row(s) skipped.` : ""
        }`,
      });
    } catch (err) {
      toast({
        title: "Sync failed",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{PLATFORM_TITLES[connection.platform]}</CardTitle>
        <ConnectionStatusBadge status={connection.status} />
      </CardHeader>
      <CardContent className="space-y-3">
        {!connection.configured ? (
          <p className="text-sm text-muted-foreground">
            Not configured on this server — ask an admin to set the corresponding{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">*_CLIENT_ID</code> /{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">*_CLIENT_SECRET</code> environment
            variables to enable this.
          </p>
        ) : connection.status === "CONNECTED" ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Account: {connection.externalAccountId ?? "—"}</p>
            <p>Last synced: {connection.lastSyncedAt ? formatDate(connection.lastSyncedAt) : "Never"}</p>
            <p>Connected by: {connection.connectedByUserName ?? "—"}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not connected yet.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {connection.configured && connection.status !== "CONNECTED" && canConnect ? (
            <Button size="sm" onClick={handleConnect} isLoading={connect.isPending}>
              Connect
            </Button>
          ) : null}
          {connection.status === "CONNECTED" && canSync ? (
            <Button variant="outline" size="sm" onClick={handleSync} isLoading={sync.isPending}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Sync now
            </Button>
          ) : null}
          {connection.status === "CONNECTED" && canConnect ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDisconnectOpen(true)}
            >
              <Unplug className="mr-1.5 h-3.5 w-3.5 text-destructive" />
              Disconnect
            </Button>
          ) : null}
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmDisconnectOpen}
        onOpenChange={setConfirmDisconnectOpen}
        title={`Disconnect ${PLATFORM_TITLES[connection.platform]}?`}
        description="This company will stop syncing real campaigns and spend from this platform until reconnected."
        confirmLabel="Disconnect"
        isLoading={disconnect.isPending}
        onConfirm={handleDisconnect}
      />
    </Card>
  );
}
