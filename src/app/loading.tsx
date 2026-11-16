export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-50">
      <div className="flex flex-col items-center gap-4">
        <div className="relative flex h-12 w-12 items-center justify-center">
          <div className="absolute h-12 w-12 rounded-xl bg-brand-600 opacity-20 animate-ping" />
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white font-bold text-lg shadow-md">
            O
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-brand-600 animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="h-2 w-2 rounded-full bg-brand-600 animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="h-2 w-2 rounded-full bg-brand-600 animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <p className="text-xs font-medium text-surface-500">Loading OrderFlow...</p>
      </div>
    </div>
  );
}
