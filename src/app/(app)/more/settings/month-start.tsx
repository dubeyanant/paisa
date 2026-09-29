"use client";

import { useState, useTransition } from "react";
import { inputClass } from "@/components/ui";
import { ordinal } from "@/lib/accounts";
import { setMonthStartDay, type SettingsResult } from "./actions";

// Saves as soon as a day is chosen.
export function MonthStart({ day }: { day: number }) {
  const [value, setValue] = useState(day);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();
  const [pending, startTransition] = useTransition();

  function change(next: number) {
    setValue(next);
    setStatus(undefined);
    startTransition(async () => {
      let result: SettingsResult;
      try {
        result = await setMonthStartDay(next);
      } catch {
        result = { ok: false, error: "Couldn't reach Paisa. Check your connection and try again." };
      }
      setStatus(result.ok ? { ok: true, text: "Saved." } : { ok: false, text: result.error });
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Month starts on the</span>
        <select
          value={value}
          disabled={pending}
          onChange={(e) => change(Number(e.target.value))}
          className={`${inputClass} max-w-48 px-2`}
        >
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {ordinal(d)}
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
