"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-path";

export type SignInState = { error: string; email: string } | undefined;

export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Enter your email and password.", email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const message =
      error.code === "invalid_credentials"
        ? "Wrong email or password."
        : error.code === "over_request_rate_limit"
          ? "Too many attempts. Wait a minute and try again."
          : "Couldn't sign in. Please try again.";
    return { error: message, email };
  }

  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

export async function signOut() {
  const supabase = await createClient();
  // "local" signs out this device only, so signing out on the laptop
  // doesn't also sign out the phone.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
