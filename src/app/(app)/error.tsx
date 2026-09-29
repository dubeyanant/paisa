"use client";

import { buttonClass } from "@/components/ui";

// Shown when a screen can't load, for example when the connection drops.
export default function AppError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 py-10">
      <h1 className="text-xl font-semibold">Couldn&apos;t load this screen</h1>
      <p className="text-muted">Check your connection and try again.</p>
      <button type="button" onClick={() => retry()} className={buttonClass.secondary}>
        Try again
      </button>
    </div>
  );
}
