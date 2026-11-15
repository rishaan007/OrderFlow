"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { registerSchema } from "@/lib/validations";
import { Mail, Lock, User, ArrowRight } from "lucide-react";

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "",
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

    // Client-side validation
    const validation = registerSchema.safeParse(formData);
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
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.error || "Failed to create account. Please try again.");
        setIsLoading(false);
        return;
      }

      // Success: navigate to onboarding
      router.push("/onboarding");
      router.refresh();
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white font-bold text-2xl shadow-sm mb-4">
            O
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-surface-900">
            Create your OrderFlow account
          </h2>
          <p className="mt-2 text-sm text-surface-500">
            Start managing orders, chats, and inventory in minutes
          </p>
        </div>

        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Sign Up</CardTitle>
            <CardDescription>
              Enter your details to create a new merchant account
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              {errorMessage && (
                <Alert variant="error" title="Registration Failed">
                  {errorMessage}
                </Alert>
              )}

              <Input
                label="Full Name"
                placeholder="Sarah Jenkins"
                leftIcon={<User className="h-4 w-4" />}
                value={formData.name}
                error={errors.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                autoComplete="name"
                disabled={isLoading}
              />

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
                placeholder="At least 8 characters with 1 number & 1 uppercase"
                leftIcon={<Lock className="h-4 w-4" />}
                value={formData.password}
                error={errors.password}
                helperText="Must be at least 8 characters with 1 uppercase letter and 1 number"
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                autoComplete="new-password"
                disabled={isLoading}
              />
            </CardContent>

            <CardFooter className="flex flex-col space-y-4">
              <Button
                type="submit"
                className="w-full"
                isLoading={isLoading}
              >
                Create Account <ArrowRight className="ml-2 h-4 w-4" />
              </Button>

              <div className="text-center text-sm text-surface-500">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-semibold text-brand-600 hover:text-brand-500 hover:underline"
                >
                  Sign in
                </Link>
              </div>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
