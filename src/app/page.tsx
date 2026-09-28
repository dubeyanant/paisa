import { requireUser } from "@/lib/auth";
import { signOut } from "./login/actions";

export default async function Home() {
  const user = await requireUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Paisa</h1>
      <p className="max-w-sm text-zinc-600 dark:text-zinc-400">
        Signed in as {user.email}.
      </p>
      <form action={signOut}>
        <button
          type="submit"
          className="h-11 rounded-lg border border-zinc-300 px-4 font-medium dark:border-zinc-700"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
