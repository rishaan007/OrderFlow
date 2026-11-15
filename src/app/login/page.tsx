"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { loginSchema } from "@/lib/validations";
import { Mail, Lock, ArrowRight } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/dashboard";

  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setErrors({});

    const validation = loginSchema.safeParse(formData);
    if (!validation.success) {
      const fieldErrors: Record<string, string> = {};
      validation.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = err.message;
        }
      });
      setErrors(fieldErrors);
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.error || "Invalid email or password.");
        setIsLoading(false);
        return;
      }

      if (!data.data.hasBusiness) {
        router.push("/onboarding");
      } else {
        router.push(redirectPath);
      }
      router.refresh();
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
      setIsLoading(false);
    }
  };

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Sign In</CardTitle>
        <CardDescription>
          Enter your merchant credentials to continue
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {errorMessage && (
            <Alert variant="error" title="Authentication Error">
              {errorMessage}
            </Alert>
          )}

          <Input
            label="Email Address"
            type="email"
            placeholder="sarah@example.com"
            leftIcon={<Mail className="h-4 w-4" />}
            value={formData.email}
            error={errors.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            autoComplete="email"
            disabled={isLoading}
          />

          <Input
            label="Password"
            type="password"
            placeholder="••••••••"
            leftIcon={<Lock className="h-4 w-4" />}
            value={formData.password}
            error={errors.password}
            onChange={(e) =>
              setFormData({ ...formData, password: e.target.value })
            }
            autoComplete="current-password"
            disabled={isLoading}
          />
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <Button
            type="submit"
            className="w-full"
            isLoading={isLoading}
          >
            Sign In <ArrowRight className="ml-2 h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="outline"
            className="w-full text-xs font-semibold text-brand-700 bg-brand-50/70 border-brand-200 hover:bg-brand-100"
            onClick={async () => {
              setFormData({ email: "sarah@orderflow.test", password: "Password123" });
              setIsLoading(true);
              try {
                const res = await fetch("/api/auth/login", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: "sarah@orderflow.test", password: "Password123" }),
                });
                const data = await res.json();
                if (data.success) {
                  router.push(redirectPath);
                  router.refresh();
                } else {
                  setErrorMessage(data.error);
                  setIsLoading(false);
                }
              } catch {
                setErrorMessage("Connection error");
                setIsLoading(false);
              }
            }}
            disabled={isLoading}
          >
            ⚡ 1-Click Demo Login (Sarah&apos;s Atelier)
          </Button>

          <div className="text-center text-sm text-surface-500">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="font-semibold text-brand-600 hover:text-brand-500 hover:underline"
            >
              Create one now
            </Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white font-bold text-2xl shadow-sm mb-4">
            O
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-surface-900">
            Welcome back to OrderFlow
          </h2>
          <p className="mt-2 text-sm text-surface-500">
            Sign in to manage your orders, chats, and customers
          </p>
        </div>

        <Suspense fallback={<Card className="p-8"><Spinner /></Card>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
