"use client";

import { useState, useTransition } from "react";
import { inputClass } from "@/components/ui";
import { formatINR } from "@/lib/finance/money";
import { SMALL_SPEND_OPTIONS } from "@/lib/insights";
import { setSmallSpendThreshold, type SettingsResult } from "./actions";

// Saves as soon as an amount is chosen.
export function SmallSpend({ threshold }: { threshold: number }) {
  const [value, setValue] = useState(threshold);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();
  const [pending, startTransition] = useTransition();
  const options = SMALL_SPEND_OPTIONS.includes(threshold)
    ? SMALL_SPEND_OPTIONS
    : [...SMALL_SPEND_OPTIONS, threshold].sort((a, b) => a - b);

  function change(next: number) {
    setValue(next);
    setStatus(undefined);
    startTransition(async () => {
      let result: SettingsResult;
      try {
        result = await setSmallSpendThreshold(next);
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      setStatus(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Spends under</span>
        <select
          value={value}
          disabled={pending}
          onChange={(e) => change(Number(e.target.value))}
          className={`${inputClass} max-w-48 px-2`}
        >
          {options.map((paise) => (
            <option key={paise} value={paise}>
              {formatINR(paise)}
            </option>
          ))}
        </select>
      </label>
      {status && (
        <p role={status.ok ? "status" : "alert"} className={`text-sm ${status.ok ? "text-accent" : "text-negative"}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
