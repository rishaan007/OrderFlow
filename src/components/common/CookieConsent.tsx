"use client";

import { useEffect, useState, useId } from "react";
import Link from "next/link";
import { Cookie, Shield, Check, X, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface CookiePreferences {
  essential: boolean; // Always true
  analytics: boolean;
  timestamp: string;
}

const STORAGE_KEY = "orderflow_cookie_consent";

export function getStoredCookieConsent(): CookiePreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function CookieConsent() {
  const [isOpen, setIsOpen] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [analyticsAllowed, setAnalyticsAllowed] = useState(false);
  const modalId = useId();

  useEffect(() => {
    const stored = getStoredCookieConsent();
    if (!stored) {
      // Delay display slightly to prevent layout jarring on initial page load
      const timer = setTimeout(() => setIsOpen(true), 800);
      return () => clearTimeout(timer);
    } else {
      setAnalyticsAllowed(stored.analytics);
    }

    // Allow opening cookie preferences from anywhere via window event
    const handleOpenPreferences = () => {
      setShowModal(true);
      setIsOpen(false);
    };

    window.addEventListener("open-cookie-preferences", handleOpenPreferences);
    return () => {
      window.removeEventListener("open-cookie-preferences", handleOpenPreferences);
    };
  }, []);

  const savePreferences = (analytics: boolean) => {
    const prefs: CookiePreferences = {
      essential: true,
      analytics,
      timestamp: new Date().toISOString(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      // Also write cookie so server can read if needed
      document.cookie = `orderflow_cookie_consent=${encodeURIComponent(
        JSON.stringify(prefs)
      )}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Ignore storage errors in restrictive environments
    }

    setAnalyticsAllowed(analytics);
    setIsOpen(false);
    setShowModal(false);

    // Notify analytics listeners
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("cookie-consent-updated", { detail: prefs })
      );
    }
  };

  const handleAcceptAll = () => savePreferences(true);
  const handleRejectOptional = () => savePreferences(false);
  const handleSaveModal = () => savePreferences(analyticsAllowed);

  return (
    <>
      {/* Bottom Sticky Banner */}
      {isOpen && !showModal && (
        <aside
          role="region"
          aria-label="Cookie consent banner"
          className="fixed bottom-0 inset-x-0 z-50 p-4 sm:p-6"
        >
          <div className="mx-auto max-w-4xl rounded-2xl border border-surface-200 bg-white/95 p-5 shadow-2xl backdrop-blur-md transition-all sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                  <Cookie className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-surface-900">
                    We value your privacy & transparency
                  </p>
                  <p className="text-xs text-surface-600 leading-relaxed max-w-2xl">
                    OrderFlow uses strictly necessary cookies for authentication and workspace security. With your consent, we also use optional performance cookies to improve user experience. Learn more in our{" "}
                    <Link href="/privacy" className="text-brand-600 underline hover:text-brand-700">
                      Privacy Policy
                    </Link>.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 sm:shrink-0">
                <button
                  type="button"
                  onClick={() => setShowModal(true)}
                  className="rounded-lg border border-surface-300 bg-white px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-50 transition-colors"
                >
                  Preferences
                </button>
                <button
                  type="button"
                  onClick={handleRejectOptional}
                  className="rounded-lg border border-surface-300 bg-white px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-50 transition-colors"
                >
                  Essential Only
                </button>
                <button
                  type="button"
                  onClick={handleAcceptAll}
                  className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
                >
                  Accept All
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Detailed Cookie Preferences Modal */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${modalId}-title`}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-950/50 backdrop-blur-sm"
        >
          <div className="w-full max-w-lg rounded-2xl border border-surface-200 bg-white p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-surface-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <Settings2 className="h-4 w-4" />
                </div>
                <h3 id={`${modalId}-title`} className="text-base font-bold text-surface-900">
                  Cookie & Privacy Preferences
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-600"
                aria-label="Close preferences"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-surface-600 leading-relaxed">
              Customize which categories of cookies you permit. You can update these choices at any time from our website footer.
            </p>

            <div className="space-y-3">
              {/* Essential Cookies */}
              <div className="rounded-xl border border-surface-200 p-4 bg-surface-50/50">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-surface-900 flex items-center gap-1.5">
                      Strictly Essential Cookies
                      <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 rounded px-1.5 py-0.2">
                        Always Active
                      </span>
                    </h4>
                    <p className="mt-1 text-xs text-surface-500 leading-relaxed">
                      Required for login sessions (<code className="font-mono">orderflow_session</code>), active workspace routing, CSRF protection, and rate limiting. The service cannot operate without these.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={true}
                    disabled={true}
                    aria-label="Strictly essential cookies (always required)"
                    className="h-4 w-4 rounded text-brand-600 cursor-not-allowed opacity-70"
                  />
                </div>
              </div>

              {/* Performance & Analytics Cookies */}
              <div className="rounded-xl border border-surface-200 p-4 bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-surface-900">
                      Performance & Analytics Cookies
                    </h4>
                    <p className="mt-1 text-xs text-surface-500 leading-relaxed">
                      Allows us to anonymously measure page load speeds and error occurrences to improve platform performance. No personally identifiable data or customer messages are ever shared.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer mt-0.5">
                    <input
                      type="checkbox"
                      checked={analyticsAllowed}
                      onChange={(e) => setAnalyticsAllowed(e.target.checked)}
                      aria-label="Allow optional analytics cookies"
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-surface-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-surface-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-600" />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-surface-100">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRejectOptional}
              >
                Reject Optional
              </Button>
              <Button
                size="sm"
                onClick={handleSaveModal}
              >
                Save Preferences
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
