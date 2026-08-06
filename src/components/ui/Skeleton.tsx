/** Shared loading skeletons for staff pages. */

export function SkeletonPulse({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-slate-200 dark:bg-slate-700 ${className}`}
      aria-hidden
    />
  );
}

export function PageHeaderSkeleton({
  hasSubtitle = true,
  hasAction = true,
}: {
  hasSubtitle?: boolean;
  hasAction?: boolean;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <SkeletonPulse className="h-8 w-48" />
        {hasSubtitle && <SkeletonPulse className="h-4 w-80 max-w-full" />}
      </div>
      {hasAction && <SkeletonPulse className="h-10 w-36 rounded-lg" />}
    </div>
  );
}

export function ListSkeleton({
  rows = 6,
  withAvatar = true,
  label = "Loading",
}: {
  rows?: number;
  withAvatar?: boolean;
  label?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"
      aria-busy="true"
      aria-label={label}
    >
      <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 bg-white px-4 py-3.5 dark:bg-slate-900/20"
          >
            {withAvatar && (
              <SkeletonPulse className="h-10 w-10 shrink-0 rounded-full" />
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonPulse className="h-3.5 w-1/3 max-w-[12rem]" />
              <SkeletonPulse className="h-3 w-1/2 max-w-[16rem]" />
            </div>
            <SkeletonPulse className="hidden h-6 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({
  rows = 6,
  cols = 4,
  label = "Loading",
}: {
  rows?: number;
  cols?: number;
  label?: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700"
      aria-busy="true"
      aria-label={label}
    >
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="flex gap-6">
          {Array.from({ length: cols }, (_, i) => (
            <SkeletonPulse key={i} className="h-3 w-16" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-6 bg-white px-4 py-3.5 dark:bg-slate-900/20"
          >
            {Array.from({ length: cols }, (_, j) => (
              <SkeletonPulse
                key={j}
                className={`h-3.5 ${j === 0 ? "w-40" : j === cols - 1 ? "ml-auto w-16" : "w-20"}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsSkeleton({
  count = 6,
  columns = "sm:grid-cols-2 lg:grid-cols-3",
  label = "Loading",
}: {
  count?: number;
  columns?: string;
  label?: string;
}) {
  return (
    <div
      className={`grid gap-3 ${columns}`}
      aria-busy="true"
      aria-label={label}
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-2">
              <SkeletonPulse className="h-4 w-28" />
              <SkeletonPulse className="h-3 w-20" />
            </div>
            <SkeletonPulse className="h-7 w-16 rounded-lg" />
          </div>
          <div className="mt-4 flex justify-between">
            <SkeletonPulse className="h-3 w-14" />
            <SkeletonPulse className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/40"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <SkeletonPulse className="h-3.5 w-24" />
              <SkeletonPulse className="h-8 w-16" />
              <SkeletonPulse className="h-3 w-28" />
            </div>
            <SkeletonPulse className="h-10 w-10 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Catalog-style page: header + toolbar + list/table body. */
export function CatalogPageSkeleton({
  titleWidth = "w-40",
  variant = "list",
  label = "Loading page",
}: {
  titleWidth?: string;
  variant?: "list" | "table" | "cards";
  label?: string;
}) {
  return (
    <div className="w-full min-w-0 space-y-6" aria-busy="true" aria-label={label}>
      <div className="space-y-2">
        <SkeletonPulse className={`h-8 ${titleWidth}`} />
        <SkeletonPulse className="h-4 w-full max-w-xl" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SkeletonPulse className="h-10 w-32 rounded-lg" />
        <SkeletonPulse className="h-10 w-48 rounded-lg" />
        <SkeletonPulse className="ml-auto h-10 w-24 rounded-lg" />
      </div>
      {variant === "table" ? (
        <TableSkeleton rows={7} cols={5} />
      ) : variant === "cards" ? (
        <CardsSkeleton count={6} />
      ) : (
        <ListSkeleton rows={7} />
      )}
    </div>
  );
}

export function FormSectionSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/40"
      aria-busy="true"
      aria-label="Loading settings"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-1">
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonPulse className="h-4 w-36" />
            <SkeletonPulse className="h-3 w-full max-w-md" />
          </div>
          <SkeletonPulse className="h-7 w-12 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function BillingSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_16rem]" aria-busy="true" aria-label="Loading billing">
      <div className="space-y-3">
        <SkeletonPulse className="h-6 w-28 rounded-full" />
        <SkeletonPulse className="h-7 w-56" />
        <SkeletonPulse className="h-4 w-full max-w-lg" />
        <SkeletonPulse className="h-4 w-3/4 max-w-md" />
      </div>
      <div className="flex flex-col gap-3">
        <SkeletonPulse className="h-10 w-full rounded-lg" />
        <SkeletonPulse className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function ChatPageSkeleton() {
  return (
    <div
      className="flex h-[calc(100vh-8rem)] min-h-[40vh] overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 md:h-[calc(100vh-5rem)]"
      aria-busy="true"
      aria-label="Loading chat"
    >
      <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40 md:flex lg:w-80">
        <SkeletonPulse className="mb-3 h-6 w-20" />
        <SkeletonPulse className="mb-3 h-9 w-full rounded-lg" />
        <div className="space-y-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <SkeletonPulse className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <SkeletonPulse className="h-3.5 w-2/3" />
                <SkeletonPulse className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-4 dark:border-slate-700">
          <SkeletonPulse className="h-10 w-10 rounded-full" />
          <SkeletonPulse className="h-5 w-40" />
        </div>
        <div className="flex flex-1 flex-col justify-end gap-3">
          <SkeletonPulse className="ml-auto h-12 w-2/3 max-w-sm rounded-2xl" />
          <SkeletonPulse className="h-12 w-1/2 max-w-xs rounded-2xl" />
          <SkeletonPulse className="ml-auto h-16 w-3/5 max-w-md rounded-2xl" />
          <SkeletonPulse className="h-12 w-2/5 max-w-xs rounded-2xl" />
        </div>
        <SkeletonPulse className="mt-4 h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}

export function StatsPageSkeleton() {
  return (
    <div className="w-full min-w-0 space-y-6" aria-busy="true" aria-label="Loading stats">
      <div className="space-y-2">
        <SkeletonPulse className="h-8 w-24" />
        <SkeletonPulse className="h-4 w-72 max-w-full" />
      </div>
      <StatCardsSkeleton count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/40"
          >
            <SkeletonPulse className="mb-4 h-4 w-32" />
            <SkeletonPulse className="mb-2 h-48 w-full rounded-lg" />
            <div className="flex gap-2">
              <SkeletonPulse className="h-3 w-16" />
              <SkeletonPulse className="h-3 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmailPageSkeleton() {
  return (
    <div className="w-full min-w-0 space-y-6" aria-busy="true" aria-label="Loading email">
      <div className="space-y-2">
        <SkeletonPulse className="h-8 w-48" />
        <SkeletonPulse className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/40"
            >
              <SkeletonPulse className="mb-2 h-4 w-40" />
              <SkeletonPulse className="h-3 w-56" />
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/40">
          <SkeletonPulse className="mb-4 h-5 w-32" />
          <SkeletonPulse className="h-64 w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** Compact card used on customer-facing status / pay / chat login. */
export function CustomerCardSkeleton({
  label = "Loading",
  className = "max-w-md",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`w-full space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}
      aria-busy="true"
      aria-label={label}
    >
      <SkeletonPulse className="h-6 w-40" />
      <SkeletonPulse className="h-4 w-full" />
      <SkeletonPulse className="h-4 w-3/4" />
      <div className="space-y-3 pt-2">
        <SkeletonPulse className="h-16 w-full rounded-lg" />
        <SkeletonPulse className="h-16 w-full rounded-lg" />
        <SkeletonPulse className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}
