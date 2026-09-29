// Placeholder while a screen's data loads, so navigation responds at once.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse">
      <div className="mb-5 h-11 w-40 rounded-lg bg-foreground/10 md:mb-8" />
      <div className="h-44 rounded-2xl bg-foreground/[0.06]" />
      <div className="mt-6 h-32 rounded-2xl bg-foreground/[0.06]" />
    </div>
  );
}
