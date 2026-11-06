/* Shown the moment /admin is opened or reloaded, while the data loads — so the screen answers
   at once instead of staying blank. */
export default function Loading() {
  return (
    <div className="flex min-h-screen" aria-busy="true" aria-label="Loading">
      <div className="hidden w-[260px] shrink-0 flex-col gap-3 bg-slate-900 p-5 lg:flex">
        <div className="mb-4 h-9 w-40 animate-pulse rounded-lg bg-white/10" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-xl bg-white/10" />
        ))}
      </div>
      <div className="flex-1 space-y-4 p-4 sm:p-6">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-slate-200" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    </div>
  );
}
