"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Building2,
  Instagram,
  MessageSquare,
  Shield,
  Users,
  Save,
  Check,
  Zap,
  CreditCard,
  UserPlus,
  Trash2,
  Mail,
  Copy,
  History,
  Lock,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

interface Member {
  id: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
  };
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  token: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  invitedBy: string;
}

interface SubscriptionData {
  plan: string;
  planName: string;
  priceMonthly: number;
  ordersUsed: number;
  ordersLimit: number;
  ordersPercentage: number;
  membersUsed: number;
  membersLimit: number;
  membersPercentage: number;
  canCreateOrder: boolean;
  canAddMember: boolean;
  features: string[];
}

interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userName: string;
  createdAt: string;
}

export default function SettingsPage() {
  const [business, setBusiness] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string>("STAFF");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Invite modal state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("STAFF");
  const [isInviting, setIsInviting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    instagramHandle: "",
    whatsappNumber: "",
    taxId: "",
    bankDetails: "",
    orderPrefix: "ORD-",
  });

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [profileRes, subRes, invitesRes, auditRes] = await Promise.all([
        fetch("/api/business/profile"),
        fetch("/api/subscription"),
        fetch("/api/team/invitations"),
        fetch("/api/audit-logs?limit=10"),
      ]);

      const profileJson = await profileRes.json();
      if (!profileRes.ok || !profileJson.success) {
        throw new Error(profileJson.error || "Failed to load business profile");
      }

      const b = profileJson.data.business;
      setBusiness(b);
      setMembers(profileJson.data.members || []);
      setCurrentUserRole(profileJson.data.currentUserRole || "STAFF");

      setFormData({
        name: b.name || "",
        phone: b.phone || "",
        email: b.email || "",
        address: b.address || "",
        instagramHandle: b.profile?.instagramHandle || "",
        whatsappNumber: b.profile?.whatsappNumber || "",
        taxId: b.profile?.taxId || "",
        bankDetails: b.profile?.bankDetails || "",
        orderPrefix: b.profile?.orderPrefix || "ORD-",
      });

      if (subRes.ok) {
        const subJson = await subRes.json();
        if (subJson.success) setSubscription(subJson.data);
      }

      if (invitesRes.ok) {
        const invitesJson = await invitesRes.json();
        if (invitesJson.success) setInvitations(invitesJson.data);
      }

      if (auditRes.ok) {
        const auditJson = await auditRes.json();
        if (auditJson.success) setAuditLogs(auditJson.data.items || []);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error fetching settings";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/business/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update profile");
      }

      setSuccessMessage("Business profile updated successfully");
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error saving profile";
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePlanUpgrade = async (plan: string) => {
    try {
      const res = await fetch("/api/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to update plan");
      }
      setSuccessMessage(`Subscription updated to ${plan}!`);
      setSubscription(json.data);
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update subscription");
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsInviting(true);
    setError(null);
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to invite member");
      }

      setSuccessMessage(`Invitation sent to ${inviteEmail}`);
      setIsInviteOpen(false);
      setInviteEmail("");
      fetchData();
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite member");
    } finally {
      setIsInviting(false);
    }
  };

  const handleRevokeInvite = async (id: string) => {
    try {
      const res = await fetch(`/api/team/invitations/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to revoke invitation");
      }
      setInvitations(invitations.filter((inv) => inv.id !== id));
      setSuccessMessage("Invitation revoked");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke invitation");
    }
  };

  const handleRemoveMember = async (id: string) => {
    if (!confirm("Are you sure you want to remove this team member?")) return;
    try {
      const res = await fetch(`/api/team/members/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to remove member");
      }
      setMembers(members.filter((m) => m.id !== id));
      setSuccessMessage("Member removed from workspace");
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const isOwnerOrAdmin = currentUserRole === "OWNER" || currentUserRole === "ADMIN";

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-4xl">
        <Skeleton className="h-8 w-48 mb-2" />
        <Skeleton className="h-4 w-72 mb-6" />
        <Card className="p-6">
          <Skeleton className="h-64 w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-4xl pb-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-surface-900 sm:text-3xl">
          Store Settings & Governance
        </h1>
        <p className="mt-1 text-sm text-surface-500">
          Manage business parameters, subscription quotas, role-based access, and audit logs
        </p>
      </div>

      {error && (
        <Alert variant="error" title="Error">
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success" title="Success">
          {successMessage}
        </Alert>
      )}

      {/* Subscription & Quota Card */}
      <Card className="shadow-sm border-surface-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Subscription Plan & Quotas</CardTitle>
                <CardDescription>Order limits, member seats, and tier features</CardDescription>
              </div>
            </div>
            <Badge variant="default" className="text-xs bg-brand-600 text-white uppercase tracking-wider font-bold">
              {subscription?.plan || "FREE"} Plan
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Orders Quota */}
            <div className="rounded-xl border border-surface-200 bg-surface-50/50 p-4 space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-surface-700">Monthly Orders Quota</span>
                <span className="text-surface-900">
                  {subscription?.ordersUsed || 0} / {subscription?.ordersLimit || 50}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-200">
                <div
                  style={{ width: `${subscription?.ordersPercentage || 0}%` }}
                  className={`h-full rounded-full transition-all duration-300 ${
                    (subscription?.ordersPercentage || 0) >= 90 ? "bg-red-500" : "bg-brand-600"
                  }`}
                />
              </div>
              <p className="text-[11px] text-surface-400">
                Resets on the 1st of each calendar month.
              </p>
            </div>

            {/* Team Members Quota */}
            <div className="rounded-xl border border-surface-200 bg-surface-50/50 p-4 space-y-2">
              <div className="flex justify-between text-xs font-semibold">
                <span className="text-surface-700">Team Member Seats</span>
                <span className="text-surface-900">
                  {subscription?.membersUsed || 1} / {subscription?.membersLimit || 2}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-200">
                <div
                  style={{ width: `${subscription?.membersPercentage || 50}%` }}
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                />
              </div>
              <p className="text-[11px] text-surface-400">
                Active members plus pending invitations.
              </p>
            </div>
          </div>

          {/* Upgrade Buttons */}
          {isOwnerOrAdmin && (
            <div className="flex flex-wrap items-center justify-between border-t border-surface-100 pt-4 text-xs gap-3">
              <span className="text-surface-500">Need more throughput for your business?</span>
              <div className="flex items-center gap-2">
                <Button
                  variant={subscription?.plan === "FREE" ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => handlePlanUpgrade("FREE")}
                  disabled={subscription?.plan === "FREE"}
                  className="text-xs h-8"
                >
                  Free (50/mo)
                </Button>
                <Button
                  variant={subscription?.plan === "PRO" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePlanUpgrade("PRO")}
                  disabled={subscription?.plan === "PRO"}
                  className="text-xs h-8 font-semibold"
                >
                  Upgrade to Pro ($29)
                </Button>
                <Button
                  variant={subscription?.plan === "ENTERPRISE" ? "default" : "outline"}
                  size="sm"
                  onClick={() => handlePlanUpgrade("ENTERPRISE")}
                  disabled={subscription?.plan === "ENTERPRISE"}
                  className="text-xs h-8 font-semibold"
                >
                  Scale to Enterprise ($99)
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Business Profile Form */}
      <Card className="shadow-sm border-surface-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Business Profile</CardTitle>
              <CardDescription>
                Public store details, currency, and invoice formatting
              </CardDescription>
            </div>
            <Badge variant="default" className="text-xs">
              Role: {currentUserRole}
            </Badge>
          </div>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <Input
                label="Store Name *"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={!isOwnerOrAdmin || isSaving}
                required
              />

              <Input
                label="Invoice Order Prefix"
                value={formData.orderPrefix}
                helperText="E.g. ORD- will produce ORD-1001"
                onChange={(e) =>
                  setFormData({ ...formData, orderPrefix: e.target.value })
                }
                disabled={!isOwnerOrAdmin || isSaving}
              />
            </div>

            <div className="border-t border-surface-200 pt-6">
              <h4 className="text-sm font-semibold text-surface-900 mb-1">
                Connected Sales Channels
              </h4>
              <p className="text-xs text-surface-500 mb-4">
                These handles are linked to customer order confirmations and WhatsApp receipts.
              </p>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Input
                  label="WhatsApp Business Number"
                  placeholder="+1 555 123 4567"
                  leftIcon={<MessageSquare className="h-4 w-4 text-emerald-600" />}
                  value={formData.whatsappNumber}
                  onChange={(e) =>
                    setFormData({ ...formData, whatsappNumber: e.target.value })
                  }
                  disabled={!isOwnerOrAdmin || isSaving}
                />

                <Input
                  label="Instagram Handle"
                  placeholder="@yourbrand"
                  leftIcon={<Instagram className="h-4 w-4 text-pink-600" />}
                  value={formData.instagramHandle}
                  onChange={(e) =>
                    setFormData({ ...formData, instagramHandle: e.target.value })
                  }
                  disabled={!isOwnerOrAdmin || isSaving}
                />
              </div>
            </div>

            <div className="border-t border-surface-200 pt-6">
              <h4 className="text-sm font-semibold text-surface-900 mb-1">
                Contact & Banking Details
              </h4>
              <p className="text-xs text-surface-500 mb-4">
                Shown to buyers on invoices and payment request links.
              </p>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Input
                  label="Support Phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={!isOwnerOrAdmin || isSaving}
                />

                <Input
                  label="Support Email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={!isOwnerOrAdmin || isSaving}
                />

                <Input
                  label="Tax ID / Registration Number"
                  value={formData.taxId}
                  onChange={(e) => setFormData({ ...formData, taxId: e.target.value })}
                  disabled={!isOwnerOrAdmin || isSaving}
                />

                <Input
                  label="Store Dispatch Address"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  disabled={!isOwnerOrAdmin || isSaving}
                />
              </div>

              <div className="mt-4">
                <Input
                  label="Bank Account / Payment Instructions"
                  placeholder="e.g. Bank Name, Account Number, UPI ID or Zelle handle"
                  value={formData.bankDetails}
                  onChange={(e) =>
                    setFormData({ ...formData, bankDetails: e.target.value })
                  }
                  disabled={!isOwnerOrAdmin || isSaving}
                />
              </div>
            </div>
          </CardContent>

          {isOwnerOrAdmin && (
            <CardFooter className="flex justify-end border-t border-surface-100 bg-surface-50/50 p-6 rounded-b-xl">
              <Button type="submit" isLoading={isSaving} className="gap-2">
                <Save className="h-4 w-4" />
                <span>Save Changes</span>
              </Button>
            </CardFooter>
          )}
        </form>
      </Card>

      {/* Team Members & Invitations */}
      <Card className="shadow-sm border-surface-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5 text-surface-500" />
                Team Members & Access Control
              </CardTitle>
              <CardDescription>
                Assign staff roles, invite teammates, and manage permissions
              </CardDescription>
            </div>
            {isOwnerOrAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsInviteOpen(!isInviteOpen)}
                className="gap-1.5 text-xs"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Invite Member
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Invite form modal inline */}
          {isInviteOpen && (
            <form onSubmit={handleSendInvite} className="rounded-xl border border-brand-200 bg-brand-50/40 p-4 space-y-3">
              <h4 className="text-xs font-bold text-brand-900 uppercase tracking-wider">Invite New Team Member</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <Input
                    placeholder="teammate@company.com"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="w-full h-10 px-3 rounded-lg border border-surface-300 bg-white text-xs font-medium text-surface-800"
                  >
                    <option value="STAFF">Staff (Inbox & Orders)</option>
                    <option value="MANAGER">Manager (Inventory & CRM)</option>
                    <option value="ADMIN">Admin (Full Control)</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" type="button" onClick={() => setIsInviteOpen(false)} className="text-xs">
                  Cancel
                </Button>
                <Button variant="default" size="sm" type="submit" isLoading={isInviting} className="text-xs">
                  Send Invitation
                </Button>
              </div>
            </form>
          )}

          {/* Active Members List */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Active Workspace Members</h4>
            <div className="divide-y divide-surface-100 border rounded-lg overflow-hidden">
              {members.map((member) => (
                <div key={member.id} className="flex items-center justify-between p-3.5 bg-white">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-semibold text-sm border border-brand-200">
                      {member.user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-surface-900 leading-tight">
                        {member.user.name}
                      </p>
                      <p className="text-xs text-surface-500">{member.user.email}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        member.role === "OWNER"
                          ? "default"
                          : member.role === "ADMIN"
                          ? "secondary"
                          : "outline"
                      }
                      className="text-xs"
                    >
                      {member.role}
                    </Badge>
                    {isOwnerOrAdmin && member.role !== "OWNER" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveMember(member.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 p-1.5 h-8 w-8"
                        title="Remove member"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pending Invitations */}
          {invitations.length > 0 && (
            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-semibold text-surface-500 uppercase tracking-wider">Pending Invitations</h4>
              <div className="divide-y divide-surface-100 border rounded-lg overflow-hidden">
                {invitations.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between p-3 bg-surface-50/50">
                    <div>
                      <p className="text-xs font-semibold text-surface-900">{inv.email}</p>
                      <p className="text-[11px] text-surface-400">
                        Invited as {inv.role} by {inv.invitedBy} • Expires {formatDate(inv.expiresAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const link = `${window.location.origin}/accept-invite?token=${inv.token}`;
                          navigator.clipboard.writeText(link);
                          setCopiedToken(inv.id);
                          setTimeout(() => setCopiedToken(null), 2000);
                        }}
                        className="text-xs h-7 gap-1"
                      >
                        {copiedToken === inv.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                        {copiedToken === inv.id ? "Copied" : "Copy Link"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevokeInvite(inv.id)}
                        className="text-xs text-red-600 h-7"
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security Audit Trail */}
      {isOwnerOrAdmin && (
        <Card className="shadow-sm border-surface-200">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-surface-500" />
                  Security & Access Audit Trail
                </CardTitle>
                <CardDescription>Immutable log of critical system operations and administrative events</CardDescription>
              </div>
              <Badge variant="outline" className="text-xs">
                Encrypted & Persisted
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {auditLogs.length === 0 ? (
              <p className="py-6 text-center text-xs text-surface-400">No audit events recorded yet.</p>
            ) : (
              <div className="divide-y divide-surface-100 text-xs">
                {auditLogs.map((log) => (
                  <div key={log.id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-surface-800">{log.action}</span>
                      <span className="text-surface-400 ml-2">by {log.userName}</span>
                    </div>
                    <span className="text-surface-400">{formatDate(log.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
