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
    // Shows up in the server logs (Vercel → Logs) to tell failures apart.
    console.error("Sign-in failed:", error.code ?? error.status, error.message);
    return { error: signInErrorMessage(error.code), email };
  }

  redirect(safeNextPath(String(formData.get("next") ?? "")));
}

function signInErrorMessage(code: string | undefined) {
  switch (code) {
    case "invalid_credentials":
      return "Wrong email or password.";
    case "email_not_confirmed":
      return "This account's email isn't confirmed yet. Confirm the user in the Supabase dashboard.";
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
    default:
      return "Couldn't sign in. Please try again.";
  }
}

export async function signOut() {
  const supabase = await createClient();
  // "local" signs out this device only, so signing out on the laptop
  // doesn't also sign out the phone.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
