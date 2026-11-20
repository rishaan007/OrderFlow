"use client";

import { useEffect, useState } from "react";
import {
  Instagram,
  MessageSquare,
  Facebook,
  Twitter,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Unplug,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
  Activity,
  Layers,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

interface ConnectionItem {
  id: string;
  platform: "INSTAGRAM" | "WHATSAPP" | "FACEBOOK" | "X";
  accountIdentifier: string;
  accountName?: string;
  avatarUrl?: string;
  status: "CONNECTED" | "CONNECTING" | "REAUTH_REQUIRED" | "ERROR" | "DISCONNECTED";
  healthStatus: "HEALTHY" | "DEGRADED" | "AUTHENTICATION_REQUIRED" | "WEBHOOK_ERROR" | "RATE_LIMITED" | "DISCONNECTED";
  connectedAt?: string;
  lastSyncAt?: string;
  lastWebhookAt?: string;
  lastError?: string;
  capabilities?: Record<string, { status: string; description: string; notes?: string }>;
}

export default function IntegrationsSettingsPage() {
  const [connections, setConnections] = useState<ConnectionItem[]>([]);
  const [capabilitiesMatrix, setCapabilitiesMatrix] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Manual connect modal state
  const [manualModalPlatform, setManualModalPlatform] = useState<string | null>(null);
  const [manualAccountIdentifier, setManualAccountIdentifier] = useState("");
  const [manualAccountName, setManualAccountName] = useState("");

  const fetchConnections = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/connections");
      const data = await res.json();
      if (data.success) {
        setConnections(data.data.connections || []);
        setCapabilitiesMatrix(data.data.availablePlatforms || {});
      }
    } catch {
      setErrorMessage("Failed to load platform connections");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();

    // Check for OAuth redirect query parameters
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");

    if (connected) {
      setSuccessMessage(`Successfully connected ${connected.toUpperCase()} channel!`);
      window.history.replaceState({}, "", "/settings/integrations");
    } else if (error) {
      setErrorMessage(decodeURIComponent(error));
      window.history.replaceState({}, "", "/settings/integrations");
    }
  }, []);

  const handleTestHealth = async (connectionId: string) => {
    setActionLoading(connectionId);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`/api/connections/${connectionId}/health`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(`Health check completed: Status is ${data.data.status}`);
        fetchConnections();
      } else {
        setErrorMessage(data.error || "Health check failed");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to test health");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisconnect = async (connectionId: string, platform: string) => {
    if (!confirm(`Are you sure you want to disconnect ${platform}? Inbound messages will no longer sync automatically.`)) {
      return;
    }
    setActionLoading(connectionId);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`/api/connections/${connectionId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(`${platform} successfully disconnected.`);
        fetchConnections();
      } else {
        setErrorMessage(data.error || "Failed to disconnect");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to disconnect channel");
    } finally {
      setActionLoading(null);
    }
  };

  const handleManualConnectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualModalPlatform || !manualAccountIdentifier) return;
    setActionLoading("manual");
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: manualModalPlatform,
          accountIdentifier: manualAccountIdentifier,
          accountName: manualAccountName || manualAccountIdentifier,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccessMessage(`${manualModalPlatform} connected successfully.`);
        setManualModalPlatform(null);
        setManualAccountIdentifier("");
        setManualAccountName("");
        fetchConnections();
      } else {
        setErrorMessage(data.error || "Failed to connect platform");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Error connecting platform");
    } finally {
      setActionLoading(null);
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case "INSTAGRAM":
        return <Instagram className="h-6 w-6 text-pink-600" />;
      case "WHATSAPP":
        return <MessageSquare className="h-6 w-6 text-emerald-600" />;
      case "FACEBOOK":
        return <Facebook className="h-6 w-6 text-blue-600" />;
      case "X":
        return <Twitter className="h-6 w-6 text-slate-800" />;
      default:
        return <Layers className="h-6 w-6 text-surface-600" />;
    }
  };

  const getStatusBadge = (status: string, health: string) => {
    if (status === "CONNECTED" && health === "HEALTHY") {
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" /> Connected
        </Badge>
      );
    }
    if (status === "CONNECTED" && health === "DEGRADED") {
      return (
        <Badge variant="warning" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> Degraded
        </Badge>
      );
    }
    if (status === "REAUTH_REQUIRED" || health === "AUTHENTICATION_REQUIRED") {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="h-3 w-3" /> Reauth Required
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-surface-500">
        Disconnected
      </Badge>
    );
  };

  const getCapabilityBadge = (status: string) => {
    switch (status) {
      case "SUPPORTED":
        return <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-medium">Supported</span>;
      case "PARTIALLY_SUPPORTED":
        return <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium">Partial</span>;
      case "REQUIRES_APPROVAL":
        return <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-medium">Requires Approval</span>;
      case "REQUIRES_BUSINESS_ACCOUNT":
        return <span className="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-medium">Business Acct</span>;
      case "NOT_SUPPORTED":
      default:
        return <span className="text-[10px] bg-surface-100 text-surface-500 px-1.5 py-0.5 rounded">Not Supported</span>;
    }
  };

  const platformsList = [
    {
      key: "INSTAGRAM",
      name: "Instagram Direct & Stories",
      description: "Sync DMs, story mentions, and customer inquiries directly into transaction threads.",
      oauthUrl: "/api/auth/oauth/instagram/authorize",
    },
    {
      key: "WHATSAPP",
      name: "WhatsApp Cloud API",
      description: "Official Meta WhatsApp Business messaging with customer service 24h window.",
      oauthUrl: "/api/auth/oauth/whatsapp/authorize",
    },
    {
      key: "FACEBOOK",
      name: "Facebook Messenger & Pages",
      description: "Manage Page conversations, Marketplace inquiries, and direct buyer payments.",
      oauthUrl: "/api/auth/oauth/facebook/authorize",
    },
    {
      key: "X",
      name: "X / Twitter Direct Messages",
      description: "Capture X customer intent, send tracking room links, and close social sales.",
      oauthUrl: "/api/auth/oauth/x/authorize",
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-surface-200 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/settings"
              className="text-xs text-surface-500 hover:text-surface-700 flex items-center gap-1 font-medium"
            >
              <ArrowLeft className="h-3 w-3" /> Back to Settings
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight flex items-center gap-2">
            Social Commerce Channels & Integrations
          </h1>
          <p className="text-sm text-surface-500 mt-1">
            Connect official social platforms to power OrderFlow&apos;s transaction and synchronization layer.
          </p>
        </div>
      </div>

      {/* Messages */}
      {successMessage && (
        <Alert variant="success" className="animate-in fade-in">
          {successMessage}
        </Alert>
      )}

      {errorMessage && (
        <Alert variant="error" className="animate-in fade-in">
          {errorMessage}
        </Alert>
      )}

      {/* Info Notice on Honest Capabilities */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-xs text-blue-900 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-blue-950">Official API Guarantee: </span>
          OrderFlow integrates strictly with official platform APIs and never scrapes, automates private sessions, or misrepresents platform features. Unsupported platform features are transparently documented below.
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="flex items-center justify-center p-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {platformsList.map((p) => {
            const activeConn = connections.find((c) => c.platform === p.key && c.status !== "DISCONNECTED");
            const platformCaps = capabilitiesMatrix[p.key] || {};

            return (
              <Card key={p.key} className="overflow-hidden border-surface-200 transition-all hover:border-surface-300">
                <CardHeader className="bg-surface-50/50 border-b border-surface-100 pb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-white rounded-xl shadow-xs border border-surface-200">
                        {getPlatformIcon(p.key)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-semibold text-surface-900">
                            {p.name}
                          </CardTitle>
                          {activeConn && getStatusBadge(activeConn.status, activeConn.healthStatus)}
                        </div>
                        <CardDescription className="text-xs text-surface-500 mt-0.5">
                          {p.description}
                        </CardDescription>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      {activeConn ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleTestHealth(activeConn.id)}
                            disabled={actionLoading === activeConn.id}
                            className="text-xs h-8 gap-1.5"
                          >
                            <Activity className={`h-3.5 w-3.5 ${actionLoading === activeConn.id ? "animate-spin" : ""}`} />
                            Test Health
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleDisconnect(activeConn.id, p.name)}
                            disabled={actionLoading === activeConn.id}
                            className="text-xs h-8 gap-1.5"
                          >
                            <Unplug className="h-3.5 w-3.5" />
                            Disconnect
                          </Button>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setManualModalPlatform(p.key);
                              setManualAccountIdentifier("");
                              setManualAccountName("");
                            }}
                            className="text-xs h-8"
                          >
                            Configure ID
                          </Button>
                          <a href={p.oauthUrl}>
                            <Button size="sm" className="text-xs h-8 gap-1.5 bg-brand-600 hover:bg-brand-700 text-white">
                              Connect via OAuth
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="pt-4 text-xs space-y-4">
                  {/* Connected Account Metadata */}
                  {activeConn && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-surface-50 rounded-lg border border-surface-200 text-surface-600">
                      <div>
                        <span className="text-[11px] text-surface-400 block uppercase font-medium">Connected Account</span>
                        <span className="font-semibold text-surface-900">{activeConn.accountName || activeConn.accountIdentifier}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-surface-400 block uppercase font-medium">Connected Since</span>
                        <span>{activeConn.connectedAt ? formatDate(activeConn.connectedAt) : "Recently"}</span>
                      </div>
                      <div>
                        <span className="text-[11px] text-surface-400 block uppercase font-medium">Last Synchronized</span>
                        <span>{activeConn.lastSyncAt ? formatDate(activeConn.lastSyncAt) : "Pending webhook"}</span>
                      </div>
                    </div>
                  )}

                  {/* Active Error Notice */}
                  {activeConn?.lastError && (
                    <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-900 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      <span>{activeConn.lastError}</span>
                    </div>
                  )}

                  {/* Explicit Platform Capabilities Matrix */}
                  <div>
                    <h5 className="font-semibold text-surface-800 mb-2 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-surface-500" /> Platform Capability Matrix
                    </h5>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                      {Object.entries(platformCaps).map(([capKey, capDetail]: [string, any]) => (
                        <div
                          key={capKey}
                          className="p-2 rounded border border-surface-100 bg-white hover:bg-surface-50 transition-colors flex flex-col justify-between"
                        >
                          <div className="flex items-center justify-between mb-1 gap-1">
                            <span className="font-medium text-surface-700 truncate" title={capKey}>
                              {capKey.replace(/_/g, " ")}
                            </span>
                            {getCapabilityBadge(capDetail?.status || "NOT_SUPPORTED")}
                          </div>
                          <p className="text-[11px] text-surface-500 leading-tight">
                            {capDetail?.description || ""}
                          </p>
                          {capDetail?.notes && (
                            <span className="text-[10px] text-amber-700 italic mt-1 block">
                              * {capDetail.notes}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Manual Account Configuration Modal */}
      {manualModalPlatform && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-surface-200 space-y-4">
            <h3 className="text-lg font-bold text-surface-900">
              Connect {manualModalPlatform} Channel
            </h3>
            <p className="text-xs text-surface-500">
              Enter your {manualModalPlatform} business identifier or handle to connect inbound webhooks and order attribution.
            </p>

            <form onSubmit={handleManualConnectSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-surface-700 block mb-1">
                  {manualModalPlatform === "WHATSAPP"
                    ? "WhatsApp Phone Number ID or Number (+1...)"
                    : manualModalPlatform === "INSTAGRAM"
                    ? "Instagram Handle or Page ID (@handle)"
                    : manualModalPlatform === "FACEBOOK"
                    ? "Facebook Page ID"
                    : "X Handle (@handle)"}
                </label>
                <input
                  type="text"
                  required
                  placeholder={manualModalPlatform === "WHATSAPP" ? "+15551234567" : "@storename"}
                  value={manualAccountIdentifier}
                  onChange={(e) => setManualAccountIdentifier(e.target.value)}
                  className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-surface-700 block mb-1">
                  Display Account Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Main Brand Channel"
                  value={manualAccountName}
                  onChange={(e) => setManualAccountName(e.target.value)}
                  className="w-full text-sm border border-surface-300 rounded-lg px-3 py-2 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setManualModalPlatform(null)}
                  disabled={actionLoading === "manual"}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={actionLoading === "manual"}
                  className="bg-brand-600 text-white hover:bg-brand-700"
                >
                  {actionLoading === "manual" ? "Connecting..." : "Save Connection"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
