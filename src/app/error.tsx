"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw, Home, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log unhandled error to console in dev/production without leaking credentials
    console.error("Global application error boundary caught:", error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-surface-200 bg-white p-8 shadow-lg text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600 mb-5">
          <ShieldAlert className="h-8 w-8" />
        </div>

        <h1 className="text-xl font-bold tracking-tight text-surface-900">
          Something went wrong
        </h1>

        <p className="mt-2 text-sm text-surface-600">
          An unexpected error occurred while processing this request. Our team has been notified.
        </p>

        {error?.digest && (
          <p className="mt-2 font-mono text-[11px] text-surface-400">
            Reference code: {error.digest}
          </p>
        )}

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <Button
            onClick={() => reset()}
            className="w-full gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Try Again</span>
          </Button>
          <Link href="/" className="w-full">
            <Button
              variant="outline"
              className="w-full gap-2"
            >
              <Home className="h-4 w-4" />
              <span>Go to Home</span>
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
