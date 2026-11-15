"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { businessOnboardingSchema } from "@/lib/validations";
import { slugify } from "@/lib/utils";
import { Building2, Globe, MessageSquare, Instagram, Phone, ArrowRight } from "lucide-react";

const CURRENCIES = [
  { value: "USD", label: "USD - US Dollar ($)" },
  { value: "EUR", label: "EUR - Euro (€)" },
  { value: "GBP", label: "GBP - British Pound (£)" },
  { value: "INR", label: "INR - Indian Rupee (₹)" },
  { value: "CAD", label: "CAD - Canadian Dollar ($)" },
  { value: "AUD", label: "AUD - Australian Dollar ($)" },
  { value: "SGD", label: "SGD - Singapore Dollar ($)" },
  { value: "AED", label: "AED - UAE Dirham (د.إ)" },
];

const TIMEZONES = [
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
  { value: "America/New_York", label: "Eastern Time (US & Canada)" },
  { value: "America/Chicago", label: "Central Time (US & Canada)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
  { value: "Europe/London", label: "London / GMT" },
  { value: "Europe/Paris", label: "Paris / Berlin (CET)" },
  { value: "Asia/Kolkata", label: "India Standard Time (IST)" },
  { value: "Asia/Dubai", label: "Gulf Standard Time (GST)" },
  { value: "Asia/Singapore", label: "Singapore Time (SGT)" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    currency: "USD",
    timezone: "UTC",
    phone: "",
    email: "",
    address: "",
    instagramHandle: "",
    whatsappNumber: "",
  });

  const [hasManuallyEditedSlug, setHasManuallyEditedSlug] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setFormData((prev) => ({
      ...prev,
      name: newName,
      slug: hasManuallyEditedSlug ? prev.slug : slugify(newName),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setErrors({});

    const validation = businessOnboardingSchema.safeParse(formData);
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
      const res = await fetch("/api/business/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMessage(data.error || "Failed to set up business workspace.");
        setIsLoading(false);
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-50 px-4 py-12 sm:px-6 lg:px-8">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white font-bold text-2xl shadow-sm mb-4">
            O
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-surface-900">
            Set up your Business Workspace
          </h2>
          <p className="mt-2 text-surface-600">
            Configure your store details to start syncing orders and customer conversations
          </p>
        </div>

        <Card className="shadow-lg border-surface-200">
          <CardHeader>
            <CardTitle>Business Information</CardTitle>
            <CardDescription>
              This information will be displayed on invoices, order confirmations, and WhatsApp receipts.
            </CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-6">
              {errorMessage && (
                <Alert variant="error" title="Setup Error">
                  {errorMessage}
                </Alert>
              )}

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Input
                  label="Business Name *"
                  placeholder="e.g. Bella Atelier"
                  leftIcon={<Building2 className="h-4 w-4" />}
                  value={formData.name}
                  error={errors.name}
                  onChange={handleNameChange}
                  disabled={isLoading}
                  required
                />

                <Input
                  label="Workspace URL Slug *"
                  placeholder="e.g. bella-atelier"
                  leftIcon={<Globe className="h-4 w-4" />}
                  value={formData.slug}
                  error={errors.slug}
                  helperText={`App URL: orderflow.app/${formData.slug || "your-slug"}`}
                  onChange={(e) => {
                    setHasManuallyEditedSlug(true);
                    setFormData({ ...formData, slug: slugify(e.target.value) });
                  }}
                  disabled={isLoading}
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Select
                  label="Default Store Currency *"
                  value={formData.currency}
                  options={CURRENCIES}
                  onChange={(e) =>
                    setFormData({ ...formData, currency: e.target.value })
                  }
                  disabled={isLoading}
                />

                <Select
                  label="Store Timezone *"
                  value={formData.timezone}
                  options={TIMEZONES}
                  onChange={(e) =>
                    setFormData({ ...formData, timezone: e.target.value })
                  }
                  disabled={isLoading}
                />
              </div>

              <div className="border-t border-surface-200 pt-6">
                <h4 className="text-sm font-semibold text-surface-900 mb-1">
                  Social & Sales Channels
                </h4>
                <p className="text-xs text-surface-500 mb-4">
                  Where your customers reach you. You can connect official integrations later.
                </p>

                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <Input
                    label="WhatsApp Business Number"
                    placeholder="+1 555 123 4567"
                    leftIcon={<MessageSquare className="h-4 w-4 text-emerald-600" />}
                    value={formData.whatsappNumber}
                    error={errors.whatsappNumber}
                    onChange={(e) =>
                      setFormData({ ...formData, whatsappNumber: e.target.value })
                    }
                    disabled={isLoading}
                  />

                  <Input
                    label="Instagram Handle"
                    placeholder="@bellaatelier"
                    leftIcon={<Instagram className="h-4 w-4 text-pink-600" />}
                    value={formData.instagramHandle}
                    error={errors.instagramHandle}
                    onChange={(e) =>
                      setFormData({ ...formData, instagramHandle: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="border-t border-surface-200 pt-6">
                <h4 className="text-sm font-semibold text-surface-900 mb-1">
                  Contact & Dispatch Details
                </h4>
                <p className="text-xs text-surface-500 mb-4">
                  Default address for shipping labels and store receipts.
                </p>

                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <Input
                    label="Store Phone"
                    placeholder="+1 555 987 6543"
                    leftIcon={<Phone className="h-4 w-4" />}
                    value={formData.phone}
                    error={errors.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    disabled={isLoading}
                  />

                  <Input
                    label="Store Address / City"
                    placeholder="123 Fashion Ave, Suite 4B, NY"
                    value={formData.address}
                    error={errors.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex justify-end gap-3 border-t border-surface-100 bg-surface-50/50 p-6 rounded-b-xl">
              <Button
                type="submit"
                size="lg"
                isLoading={isLoading}
                className="w-full sm:w-auto"
              >
                Complete Workspace Setup <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </form>
        </Card>
      </div>
    </div>
  );
}
