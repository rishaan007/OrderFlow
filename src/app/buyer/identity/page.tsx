"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  ShieldAlert,
  Smartphone,
  Mail,
  Instagram,
  MessageSquare,
  Link2,
  Unlink,
  CheckCircle2,
  AlertCircle,
  Lock,
  ArrowRight,
  GitMerge,
  Eye,
  RefreshCw,
  UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

interface ConnectedIdentity {
  linkId: string;
  provider: string;
  confidence: "UNVERIFIED" | "VERIFIED" | "STRONGLY_VERIFIED";
  verificationMethod?: string;
  displayValue: string;
  verifiedAt?: string | null;
  lastVerifiedAt?: string | null;
  canUnlink: boolean;
}

interface BuyerProfile {
  buyerId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  verificationLevel: "UNVERIFIED" | "VERIFIED" | "STRONGLY_VERIFIED";
  purchaseCount: number;
  unreadNotifications: number;
  privacySettings?: {
    allowCrossSellerIdentityResolution?: boolean;
    marketingNotifications?: boolean;
  };
  connectedIdentities: ConnectedIdentity[];
}

export default function BuyerIdentityPage() {
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Link new account form state
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkProvider, setLinkProvider] = useState("INSTAGRAM");
  const [linkIdentifier, setLinkIdentifier] = useState("");
  const [isLinking, setIsLinking] = useState(false);

  // Verification challenge state
  const [verifyingTarget, setVerifyingTarget] = useState<{ type: "EMAIL" | "PHONE"; value: string } | null>(null);
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [isRequestingCode, setIsRequestingCode] = useState(false);
  const [isSubmittingCode, setIsSubmittingCode] = useState(false);

  // Identity merge state
  const [showMergeForm, setShowMergeForm] = useState(false);
  const [mergeContact, setMergeContact] = useState("");
  const [mergeRequestId, setMergeRequestId] = useState<string | null>(null);
  const [mergeCode, setMergeCode] = useState("");
  const [isSubmittingMergeRequest, setIsSubmittingMergeRequest] = useState(false);
  const [isConfirmingMerge, setIsConfirmingMerge] = useState(false);

  const fetchProfile = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/buyer/profile");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load identity profile");
      setProfile(json.data);
    } catch (err: any) {
      setError(err.message || "Unable to connect to OrderFlow");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleLinkIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkIdentifier.trim()) return;
    setIsLinking(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/buyer/identities/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: linkProvider,
          externalIdentityId: linkIdentifier.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to connect identity");
      setSuccessMsg(`Successfully connected ${linkProvider}`);
      setShowLinkForm(false);
      setLinkIdentifier("");
      await fetchProfile();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlink = async (linkId: string) => {
    if (!confirm("Are you sure you want to disconnect this identity?")) return;
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/buyer/identities/${linkId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to unlink");
      setSuccessMsg("Identity disconnected");
      await fetchProfile();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleStartVerification = async (type: "EMAIL" | "PHONE", value: string) => {
    setIsRequestingCode(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch("/api/buyer/identities/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to request verification code");
      setActiveChallengeId(json.data.challengeId);
      setVerifyingTarget({ type, value });
      setSuccessMsg(`Verification code sent to ${value}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsRequestingCode(false);
    }
  };

  const handleConfirmVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChallengeId || !verificationCode.trim()) return;
    setIsSubmittingCode(true);
    setError(null);
    try {
      const res = await fetch("/api/buyer/identities/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: activeChallengeId,
          code: verificationCode.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Verification failed");
      setSuccessMsg("Contact successfully verified!");
      setActiveChallengeId(null);
      setVerifyingTarget(null);
      setVerificationCode("");
      await fetchProfile();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmittingCode(false);
    }
  };

  const handleRequestMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeContact.trim()) return;
    setIsSubmittingMergeRequest(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const isEmail = mergeContact.includes("@");
      const body = isEmail ? { targetEmail: mergeContact.trim() } : { targetPhone: mergeContact.trim() };
      const res = await fetch("/api/buyer/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Merge request failed");
      setMergeRequestId(json.data.requestId);
      setSuccessMsg(`Verification code sent to ${mergeContact}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmittingMergeRequest(false);
    }
  };

  const handleConfirmMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeRequestId || !mergeCode.trim()) return;
    setIsConfirmingMerge(true);
    setError(null);
    try {
      const res = await fetch("/api/buyer/merge/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: mergeRequestId,
          code: mergeCode.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Merge confirmation failed");
      setSuccessMsg("Identities merged! All transactions are now consolidated.");
      setMergeRequestId(null);
      setMergeCode("");
      setShowMergeForm(false);
      await fetchProfile();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsConfirmingMerge(false);
    }
  };

  const handleTogglePrivacy = async (field: "allowCrossSellerIdentityResolution" | "marketingNotifications", currentVal: boolean) => {
    setError(null);
    try {
      const res = await fetch("/api/buyer/privacy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          privacySettings: {
            ...profile?.privacySettings,
            [field]: !currentVal,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update privacy");
      await fetchProfile();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case "INSTAGRAM":
        return <Instagram className="h-5 w-5 text-pink-600" />;
      case "WHATSAPP":
        return <MessageSquare className="h-5 w-5 text-emerald-600" />;
      case "FACEBOOK":
        return <span className="h-5 w-5 rounded-full bg-blue-600 text-xs font-bold text-white flex items-center justify-center">f</span>;
      case "X":
        return <span className="h-5 w-5 rounded-full bg-slate-900 text-xs font-bold text-white flex items-center justify-center">𝕏</span>;
      case "EMAIL":
        return <Mail className="h-5 w-5 text-blue-600" />;
      case "PHONE":
        return <Smartphone className="h-5 w-5 text-amber-600" />;
      default:
        return <UserCheck className="h-5 w-5 text-brand-600" />;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-50 py-8 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
          <Skeleton className="h-48 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between border-b border-surface-200 pb-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-brand-600 text-white font-bold flex items-center justify-center text-sm">
              OF
            </div>
            <span className="font-semibold text-surface-900">Your OrderFlow</span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/buyer/dashboard">
              <Button variant="ghost" size="sm">Purchases</Button>
            </Link>
            <Link href="/buyer/notifications">
              <Button variant="ghost" size="sm">Notifications</Button>
            </Link>
            <Button variant="default" size="sm">Identity</Button>
          </div>
        </div>

        {error && (
          <Alert variant="error" title="Action Failed">
            {error}
          </Alert>
        )}

        {successMsg && (
          <Alert variant="success" title="Success">
            {successMsg}
          </Alert>
        )}

        {/* 1. Identity Overview Card */}
        <Card className="border-surface-200 shadow-sm overflow-hidden bg-white">
          <div className="bg-gradient-to-r from-surface-900 via-surface-800 to-surface-900 p-6 text-white">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-white/10 text-white font-bold text-xl flex items-center justify-center border border-white/20">
                  {profile?.displayName?.slice(0, 2).toUpperCase() || "OF"}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-bold">{profile?.displayName || "OrderFlow Buyer"}</h1>
                    <Badge variant={profile?.verificationLevel === "STRONGLY_VERIFIED" ? "success" : profile?.verificationLevel === "VERIFIED" ? "default" : "warning"}>
                      {profile?.verificationLevel || "UNVERIFIED"}
                    </Badge>
                  </div>
                  <p className="text-xs text-surface-300 mt-1">
                    Universal commerce identity linking your social transactions across platforms.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-surface-200">
                <div className="text-center">
                  <div className="text-lg font-bold text-white">{profile?.purchaseCount || 0}</div>
                  <div>Purchases</div>
                </div>
                <div className="h-8 w-px bg-white/20" />
                <div className="text-center">
                  <div className="text-lg font-bold text-white">{profile?.connectedIdentities.length || 0}</div>
                  <div>Connected</div>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* 2. Connected Accounts Card */}
        <Card className="border-surface-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-semibold text-surface-900">Connected Social & Contact Accounts</CardTitle>
              <CardDescription className="text-xs text-surface-500">
                Purchases discovered across these platforms automatically aggregate into your universal account.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLinkForm(!showLinkForm)}
              className="gap-1.5"
            >
              <Link2 className="h-3.5 w-3.5" />
              {showLinkForm ? "Cancel" : "Connect Platform"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {showLinkForm && (
              <form onSubmit={handleLinkIdentity} className="p-4 rounded-xl bg-surface-50 border border-surface-200 space-y-3">
                <h4 className="text-xs font-semibold text-surface-900">Add Social Platform Assertion</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-surface-600 mb-1">Platform</label>
                    <select
                      value={linkProvider}
                      onChange={(e) => setLinkProvider(e.target.value)}
                      className="w-full rounded-md border border-surface-300 px-3 py-1.5 text-xs focus:border-brand-500"
                    >
                      <option value="INSTAGRAM">Instagram (@handle)</option>
                      <option value="WHATSAPP">WhatsApp (Phone number)</option>
                      <option value="FACEBOOK">Facebook Messenger</option>
                      <option value="X">X / Twitter (@handle)</option>
                      <option value="EMAIL">Email Address</option>
                      <option value="PHONE">Phone Number</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-surface-600 mb-1">Identifier</label>
                    <input
                      type="text"
                      required
                      placeholder={linkProvider === "INSTAGRAM" || linkProvider === "X" ? "@username" : linkProvider === "WHATSAPP" || linkProvider === "PHONE" ? "+1234567890" : "you@example.com"}
                      value={linkIdentifier}
                      onChange={(e) => setLinkIdentifier(e.target.value)}
                      className="w-full rounded-md border border-surface-300 px-3 py-1.5 text-xs focus:border-brand-500"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowLinkForm(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" isLoading={isLinking}>
                    Connect Identity
                  </Button>
                </div>
              </form>
            )}

            {/* List of Connected Identities */}
            <div className="space-y-2">
              {profile?.connectedIdentities.map((item) => (
                <div
                  key={item.linkId}
                  className="flex items-center justify-between p-3 rounded-xl border border-surface-200 bg-surface-50/50 hover:bg-surface-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-white border border-surface-200 flex items-center justify-center shadow-2xs">
                      {getProviderIcon(item.provider)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-xs text-surface-900">{item.provider}</span>
                        <span className="text-xs text-surface-600 font-mono">{item.displayValue}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-surface-400 mt-0.5">
                        <Badge
                          variant={item.confidence === "VERIFIED" || item.confidence === "STRONGLY_VERIFIED" ? "success" : "secondary"}
                        >
                          {item.confidence}
                        </Badge>
                        {item.verifiedAt ? (
                          <span>Verified {new Date(item.verifiedAt).toLocaleDateString()}</span>
                        ) : (
                          <span>Asserted</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.confidence === "UNVERIFIED" && (item.provider === "EMAIL" || item.provider === "PHONE") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleStartVerification(item.provider as any, item.displayValue)}
                        isLoading={isRequestingCode}
                        className="text-xs h-7 px-2.5"
                      >
                        Verify
                      </Button>
                    )}
                    {item.canUnlink && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUnlink(item.linkId)}
                        className="text-surface-400 hover:text-red-600 h-7 w-7 p-0"
                        title="Disconnect identity"
                      >
                        <Unlink className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* OTP Verification Modal / Box */}
            {activeChallengeId && (
              <form onSubmit={handleConfirmVerification} className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 space-y-3">
                <div className="flex items-center gap-2 text-blue-900 font-semibold text-xs">
                  <ShieldCheck className="h-4 w-4 text-blue-600" />
                  <span>Enter Verification Code</span>
                </div>
                <p className="text-xs text-blue-700">
                  We sent a 6-digit confirmation code to {verifyingTarget?.value}. Enter it below to verify control of this contact.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    required
                    maxLength={10}
                    placeholder="123456"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    className="w-36 rounded-md border border-blue-300 px-3 py-1.5 text-sm font-mono tracking-widest text-center focus:border-blue-500 bg-white"
                  />
                  <Button type="submit" size="sm" isLoading={isSubmittingCode}>
                    Verify Code
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setActiveChallengeId(null);
                      setVerifyingTarget(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>

        {/* 3. Consolidate Past Purchases (Identity Merge) */}
        <Card className="border-surface-200 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-surface-900">Merge Guest Purchases</CardTitle>
                <CardDescription className="text-xs text-surface-500">
                  Bought from Instagram or WhatsApp using a different phone or email before signing up? Consolidate them here.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMergeForm(!showMergeForm)}
                className="gap-1.5"
              >
                <GitMerge className="h-3.5 w-3.5" />
                {showMergeForm ? "Close" : "Start Merge"}
              </Button>
            </div>
          </CardHeader>
          {showMergeForm && (
            <CardContent className="space-y-4 pt-1">
              {!mergeRequestId ? (
                <form onSubmit={handleRequestMerge} className="p-4 rounded-xl bg-surface-50 border border-surface-200 space-y-3">
                  <p className="text-xs text-surface-600">
                    Enter the phone number or email you previously used when purchasing. We will send a one-time verification code to prove ownership.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      placeholder="e.g. +1234567890 or previous@email.com"
                      value={mergeContact}
                      onChange={(e) => setMergeContact(e.target.value)}
                      className="flex-1 rounded-md border border-surface-300 px-3 py-1.5 text-xs focus:border-brand-500"
                    />
                    <Button type="submit" size="sm" isLoading={isSubmittingMergeRequest}>
                      Send Code
                    </Button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleConfirmMerge} className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-900 font-semibold text-xs">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    <span>Enter Code to Consolidate Purchases</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      required
                      placeholder="6-digit code"
                      value={mergeCode}
                      onChange={(e) => setMergeCode(e.target.value)}
                      className="w-36 rounded-md border border-emerald-300 px-3 py-1.5 text-sm font-mono tracking-widest text-center focus:border-emerald-500 bg-white"
                    />
                    <Button type="submit" size="sm" isLoading={isConfirmingMerge}>
                      Confirm Merge
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setMergeRequestId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          )}
        </Card>

        {/* 4. Privacy & Data Minimization Controls */}
        <Card className="border-surface-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-surface-900">Privacy & Cross-Platform Settings</CardTitle>
            <CardDescription className="text-xs text-surface-500">
              OrderFlow is designed with privacy-first principles. Your cross-platform purchases are unified for you, not sold to advertisers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-xl border border-surface-200">
              <div>
                <div className="text-xs font-semibold text-surface-900">Deterministic Seller Customer Resolution</div>
                <div className="text-[11px] text-surface-500">
                  Allow sellers you purchase from to associate your verified contact info with their internal customer record.
                </div>
              </div>
              <input
                type="checkbox"
                checked={profile?.privacySettings?.allowCrossSellerIdentityResolution ?? true}
                onChange={() =>
                  handleTogglePrivacy(
                    "allowCrossSellerIdentityResolution",
                    profile?.privacySettings?.allowCrossSellerIdentityResolution ?? true
                  )
                }
                className="h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl border border-surface-200">
              <div>
                <div className="text-xs font-semibold text-surface-900">Marketing & Promotional Updates</div>
                <div className="text-[11px] text-surface-500">
                  Receive promotional updates from platforms and sellers.
                </div>
              </div>
              <input
                type="checkbox"
                checked={profile?.privacySettings?.marketingNotifications ?? false}
                onChange={() =>
                  handleTogglePrivacy(
                    "marketingNotifications",
                    profile?.privacySettings?.marketingNotifications ?? false
                  )
                }
                className="h-4 w-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
              />
            </div>

            <div className="rounded-xl bg-surface-50 p-3 text-[11px] text-surface-600 space-y-1">
              <div className="font-semibold text-surface-900 flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-brand-600" /> OrderFlow Privacy Guarantees:
              </div>
              <div>• Zero advertising profiling or behavioral tracking across sellers.</div>
              <div>• No facial recognition, fingerprinting, or probabilistic guess-matching.</div>
              <div>• Identity merges are strictly cryptographic and require explicit buyer proof.</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
