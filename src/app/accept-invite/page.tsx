"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CheckCircle2, AlertCircle, Building2, ArrowRight } from "lucide-react";

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("No invitation token provided. Please check your invitation link.");
    }
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/team/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        if (res.status === 401) {
          router.push(`/login?redirect=/accept-invite?token=${token}`);
          return;
        }
        throw new Error(json.error || "Failed to accept invitation");
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invitation");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-50 p-4">
      <Card className="w-full max-w-md shadow-md border-surface-200">
        <CardHeader className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700 mb-2">
            <Building2 className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Join Workspace</CardTitle>
          <CardDescription>
            You have been invited to collaborate on an OrderFlow workspace
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <Alert variant="error" title="Invitation Error">
              {error}
            </Alert>
          )}

          {success && (
            <Alert variant="success" title="Success!">
              Invitation accepted! Redirecting to dashboard...
            </Alert>
          )}

          {!success && !error && (
            <p className="text-sm text-surface-600 text-center">
              Click below to accept this invitation and access team orders, inbox, and products.
            </p>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-2">
          {!success && (
            <Button
              className="w-full gap-2"
              onClick={handleAccept}
              isLoading={isLoading}
              disabled={!token}
            >
              <span>Accept & Enter Workspace</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
      <AcceptInviteContent />
    </Suspense>
  );
}
