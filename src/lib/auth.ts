import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Returns the signed-in user, or sends the visitor to /login.
// Call it in every page, Server Function and Route Handler that reads or
// changes data. The redirect in src/proxy.ts is only a first, optimistic check;
// RLS in the database is the last line of defence.
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  return { id: data.claims.sub, email: data.claims.email ?? "" };
});
