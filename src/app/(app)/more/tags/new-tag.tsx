"use client";

import { useState } from "react";
import { PlusIcon } from "@/components/icons";
import { Card, buttonClass } from "@/components/ui";
import { TagForm } from "./tag-form";

export function NewTag() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass.secondary} w-fit`}>
        <PlusIcon className="size-5" />
        New tag
      </button>
    );
  }
  return (
    <Card className="p-4 md:p-6">
      <TagForm onDone={() => setOpen(false)} />
    </Card>
  );
}
