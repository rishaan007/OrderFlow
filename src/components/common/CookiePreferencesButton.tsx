"use client";

export function CookiePreferencesButton() {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("open-cookie-preferences"));
        }
      }}
      className="text-surface-500 hover:text-surface-900 transition-colors"
    >
      Cookie Preferences
    </button>
  );
}
