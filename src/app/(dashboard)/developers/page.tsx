"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Code2,
  Key,
  Webhook,
  Plus,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  ExternalLink,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

interface ApiKeyItem {
  id: string;
  name: string;
  keyType: string;
  environment: "SANDBOX" | "LIVE";
  keyPrefix: string;
  scopes: string[];
  status: string;
  lastUsedAt: string | null;
}

interface DeveloperApp {
  id: string;
  name: string;
  description: string | null;
  environment: "SANDBOX" | "LIVE";
  status: string;
  apiKeys: ApiKeyItem[];
  webhooks: Array<{
    id: string;
    targetUrl: string;
    eventTypes: string[];
    status: string;
    failureCount: number;
  }>;
}

export default function DeveloperPortalPage() {
  const [applications, setApplications] = useState<DeveloperApp[]>([]);
  const [usage, setUsage] = useState<{
    totalRequests: number;
    errorRequests: number;
    avgLatencyMs: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [newAppName, setNewAppName] = useState("");
  const [newAppEnv, setNewAppEnv] = useState<"SANDBOX" | "LIVE">("SANDBOX");
  const [creatingApp, setCreatingApp] = useState(false);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedAppId, setSelectedAppId] = useState<string>("");

  const loadPortal = async () => {
    setLoading(true);
    setError(null);
    try {
      const [appsRes, usageRes] = await Promise.all([
        fetch("/api/developer/apps"),
        fetch("/api/developer/usage"),
      ]);
      const appsJson = await appsRes.json();
      const usageJson = await usageRes.json();
      if (!appsRes.ok || !appsJson.success) {
        throw new Error(appsJson.error || "Failed to load developer apps");
      }
      const apps = appsJson.data.applications || [];
      setApplications(apps);
      if (apps.length > 0 && !selectedAppId) {
        setSelectedAppId(apps[0].id);
      }
      if (usageRes.ok && usageJson.success) {
        setUsage(usageJson.data);
      }
    } catch (err: any) {
      setError(err.message || "Error loading Developer Portal");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPortal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) return;
    setCreatingApp(true);
    setError(null);
    try {
      const res = await fetch("/api/developer/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newAppName.trim(),
          environment: newAppEnv,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to create app");
      setNewAppName("");
      await loadPortal();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreatingApp(false);
    }
  };

  const handleGenerateKey = async (appId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/developer/apps/${appId}/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Key ${new Date().toLocaleDateString()}`,
          keyType: "SERVER",
          scopes: [
            "orders:read",
            "orders:write",
            "products:read",
            "customers:read",
            "transactions:read",
            "webhooks:manage",
            "analytics:read",
          ],
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to generate key");
      setRevealedSecret(json.data.secretKey);
      await loadPortal();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRotateKey = async (appId: string, apiKeyId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/developer/apps/${appId}/keys`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeyId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to rotate key");
      setRevealedSecret(json.data.secretKey);
      await loadPortal();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRevokeKey = async (appId: string, apiKeyId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/developer/apps/${appId}/keys?keyId=${encodeURIComponent(apiKeyId)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to revoke key");
      await loadPortal();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppId || !webhookUrl.trim()) return;
    setError(null);
    try {
      const res = await fetch(`/api/developer/apps/${selectedAppId}/webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: webhookUrl.trim(),
          eventTypes: ["order.created", "payment.captured", "shipment.delivered"],
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Failed to add webhook");
      setRevealedSecret(json.data.signingSecret);
      setWebhookUrl("");
      await loadPortal();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-surface-950 flex items-center gap-2">
            <Code2 className="h-6 w-6 text-brand-600" />
            OrderFlow Developer Platform
          </h1>
          <p className="text-sm text-surface-500 mt-1">
            Scoped API keys, SANDBOX vs LIVE isolation, signed outbound webhooks, and OpenAPI v1 specs.
          </p>
        </div>
        <Link href="/api/v1/openapi.json" target="_blank">
          <Button variant="outline" size="sm" className="gap-1.5">
            <ExternalLink className="h-4 w-4" /> View OpenAPI 3.1 Spec
          </Button>
        </Link>
      </div>

      {error && <Alert variant="error" title="Error">{error}</Alert>}

      {revealedSecret && (
        <Alert
          variant="warning"
          title="Save This Secret Now — It Will Not Be Shown Again"
          onClose={() => setRevealedSecret(null)}
        >
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-black/10 px-2 py-1 font-mono text-xs break-all">
              {revealedSecret}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(revealedSecret);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </Alert>
      )}

      {usage && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-surface-500 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5" /> API Requests Logged
              </div>
              <div className="text-2xl font-bold text-surface-950 mt-1">{usage.totalRequests}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-surface-500">4xx / 5xx Errors</div>
              <div className="text-2xl font-bold text-surface-950 mt-1">{usage.errorRequests}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-surface-500">Average Latency</div>
              <div className="text-2xl font-bold text-surface-950 mt-1">{usage.avgLatencyMs} ms</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Developer Application</CardTitle>
          <CardDescription>
            Create separate SANDBOX (non-production) and LIVE API applications linked to your active workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateApp} className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 w-full">
              <Input
                label="Application Name"
                placeholder="e.g. Storefront ERP Sync"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-surface-700 mb-1.5">Environment</label>
              <select
                value={newAppEnv}
                onChange={(e) => setNewAppEnv(e.target.value as "SANDBOX" | "LIVE")}
                className="h-10 rounded-lg border border-surface-300 bg-white px-3 text-sm"
              >
                <option value="SANDBOX">SANDBOX</option>
                <option value="LIVE">LIVE</option>
              </select>
            </div>
            <Button type="submit" isLoading={creatingApp} className="gap-1.5">
              <Plus className="h-4 w-4" /> Create App
            </Button>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <div className="text-sm text-surface-500">Loading applications...</div>
      ) : (
        <div className="space-y-4">
          {applications.map((app) => (
            <Card key={app.id}>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {app.name}
                    <Badge variant={app.environment === "SANDBOX" ? "warning" : "success"}>
                      {app.environment}
                    </Badge>
                  </CardTitle>
                  <CardDescription>{app.description || "OrderFlow Developer Application"}</CardDescription>
                </div>
                <Button size="sm" onClick={() => handleGenerateKey(app.id)} className="gap-1.5">
                  <Key className="h-3.5 w-3.5" /> Generate API Key
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-2">
                    API Keys ({app.apiKeys.length})
                  </h4>
                  {app.apiKeys.length === 0 ? (
                    <p className="text-xs text-surface-500">No keys generated yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {app.apiKeys.map((k) => (
                        <div
                          key={k.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-surface-200 p-3 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-surface-900 flex items-center gap-2">
                              {k.name}
                              <code className="bg-surface-100 px-1.5 py-0.5 rounded font-mono">
                                {k.keyPrefix}...
                              </code>
                              <Badge variant={k.status === "ACTIVE" ? "success" : "secondary"}>
                                {k.status}
                              </Badge>
                            </div>
                            <div className="text-surface-500 mt-1">
                              Scopes: {k.scopes.join(", ")}
                            </div>
                          </div>
                          {k.status === "ACTIVE" && (
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRotateKey(app.id, k.id)}
                                title="Rotate Key"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleRevokeKey(app.id, k.id)}
                                title="Revoke Key"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-500 mb-2 flex items-center gap-1.5">
                    <Webhook className="h-3.5 w-3.5" /> Webhooks ({app.webhooks.length})
                  </h4>
                  {app.webhooks.map((wh) => (
                    <div
                      key={wh.id}
                      className="flex items-center justify-between rounded-lg border border-surface-200 p-2.5 text-xs mb-2"
                    >
                      <div>
                        <div className="font-mono text-surface-900">{wh.targetUrl}</div>
                        <div className="text-surface-500">{wh.eventTypes.join(", ")}</div>
                      </div>
                      <Badge variant={wh.status === "ACTIVE" ? "success" : "secondary"}>
                        {wh.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}

          {applications.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Register Outbound Webhook Subscription</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleAddWebhook} className="flex flex-col sm:flex-row gap-3 items-end">
                  <div>
                    <label className="block text-sm font-medium text-surface-700 mb-1.5">Application</label>
                    <select
                      value={selectedAppId}
                      onChange={(e) => setSelectedAppId(e.target.value)}
                      className="h-10 rounded-lg border border-surface-300 bg-white px-3 text-sm"
                    >
                      {applications.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({a.environment})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 w-full">
                    <Input
                      label="HTTPS Webhook Endpoint"
                      type="url"
                      placeholder="https://example.com/webhooks/orderflow"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit">Add Webhook</Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
