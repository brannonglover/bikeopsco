const SKELETON_STAGES = [
  "Booked In",
  "Received",
  "Working On",
  "Waiting on Customer",
  "Waiting on Parts",
  "Bike Ready",
  "Completed",
] as const;

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-surface-border bg-surface p-3 shadow-sm dark:shadow-none">
      <div className="flex items-start gap-2.5">
        <div className="h-9 w-9 flex-shrink-0 animate-pulse rounded-full bg-subtle-bg" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-subtle-bg" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-subtle-bg" />
        </div>
      </div>
      <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-subtle-bg" />
      <div className="mt-2 flex gap-2">
        <div className="h-5 w-16 animate-pulse rounded-md bg-subtle-bg" />
        <div className="h-5 w-14 animate-pulse rounded-md bg-subtle-bg" />
      </div>
    </div>
  );
}

function SkeletonColumn({
  label,
  cardCount,
}: {
  label: string;
  cardCount: number;
}) {
  return (
    <div className="flex h-full min-h-[320px] min-w-[200px] flex-1 flex-shrink-0 flex-col sm:min-w-[168px]">
      <div className="mb-3 flex flex-shrink-0 items-center gap-2 rounded-full px-3 py-1.5">
        <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-subtle-bg" />
        <div className="h-3 w-20 animate-pulse rounded bg-subtle-bg" aria-hidden />
        <span className="sr-only">{label}</span>
        <span className="ml-auto h-[22px] w-[22px] animate-pulse rounded-full bg-subtle-bg" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden">
        {Array.from({ length: cardCount }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}

/** Board chrome + empty columns while jobs hydrate (no full-page spinner). */
export function BoardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading job board">
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden rounded-3xl bg-job-board p-5 shadow-float ring-1 ring-black/[0.04] dark:!bg-transparent dark:!shadow-none dark:ring-0 sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between flex-shrink-0">
          <div className="space-y-2">
            <div className="h-7 w-36 animate-pulse rounded-lg bg-subtle-bg sm:h-8 sm:w-40" />
            <div className="hidden md:block h-3 w-56 animate-pulse rounded bg-subtle-bg" />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="h-11 w-28 animate-pulse rounded-xl bg-subtle-bg" />
            <div className="h-11 w-28 animate-pulse rounded-xl bg-subtle-bg" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 gap-5 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-2 w-full">
          {SKELETON_STAGES.map((label, index) => (
            <SkeletonColumn
              key={label}
              label={label}
              cardCount={index === 0 || index === 2 ? 2 : 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
