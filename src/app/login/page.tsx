import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Paisa",
};

// There is no sign-up page on purpose: sign-ups are off in Supabase Auth and
// the owner's account is created in the Supabase dashboard (TD-10).
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-semibold tracking-tight">Paisa</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Sign in to continue.
        </p>
        <LoginForm next={typeof next === "string" ? next : "/"} />
      </div>
    </main>
  );
}
