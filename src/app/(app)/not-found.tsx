import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3 py-10">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-muted">This page doesn&apos;t exist, or it was deleted.</p>
      <Link href="/" className={buttonClass.secondary}>
        Go home
      </Link>
    </div>
  );
}
