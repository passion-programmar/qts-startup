import { Card } from "@/app/ui/card";
import { Skeleton, SkeletonRows } from "@/app/ui/feedback";

// Loading screens shaped like the page that is coming, shown at once on a click (loading.tsx) while
// the page's data loads; the sidebar and top bar stay on screen.

function HeaderSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="space-y-2.5">
      <Skeleton className={wide ? "h-8 w-64" : "h-7 w-56"} />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

function Busy({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true" aria-label={label} className={className} role="status">
      {children}
    </div>
  );
}

/** A list page: title, a toolbar (search, filters, actions), then the table. */
export function TablePageSkeleton({ label = "Loading page", columns = 5 }: { label?: string; columns?: number }) {
  return (
    <Busy className="space-y-6 py-1" label={label}>
      <HeaderSkeleton />
      <Card flush>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-72 max-w-full" />
          <Skeleton className="ml-auto h-9 w-36" />
        </div>
        <SkeletonRows columns={columns} rows={8} />
        <div className="flex items-center justify-between border-t border-line px-4 py-3">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-8 w-48" />
        </div>
      </Card>
    </Busy>
  );
}

/** The Overview: title, today's card, the period and zone switches, two charts. */
export function OverviewSkeleton() {
  return (
    <Busy className="mx-auto max-w-[1440px] space-y-6 py-1 2xl:max-w-none" label="Loading overview">
      <HeaderSkeleton wide />
      <Card className="flex items-center gap-5">
        <Skeleton className="size-11 rounded-control" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-7 w-36" />
        </div>
        <Skeleton className="hidden h-2 flex-1 rounded-full sm:block" />
        <Skeleton className="hidden h-4 w-40 md:block" />
      </Card>
      <div className="flex flex-wrap items-center gap-4">
        <Skeleton className="h-10 w-52 rounded-control" />
        <Skeleton className="h-10 w-64 rounded-control" />
        <Skeleton className="h-10 w-40 rounded-control sm:ml-auto" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((chart) => (
          <Card className="space-y-5" key={chart}>
            <div className="flex items-center gap-3">
              <Skeleton className="size-10 rounded-control" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[0, 1, 2].map((stat) => <Skeleton className="h-12" key={stat} />)}
            </div>
            <div className="flex h-44 items-end gap-3">
              {[40, 65, 30, 85, 55, 70, 45].map((height, bar) => (
                <Skeleton className="flex-1 rounded-b-none" key={bar} style={{ height: `${height}%` }} />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </Busy>
  );
}

/** The Interviews page: title, its view switch, then a week calendar. */
export function CalendarPageSkeleton() {
  return (
    <Busy className="space-y-6 py-1" label="Loading interviews">
      <HeaderSkeleton />
      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-56 rounded-control" />
        <Skeleton className="h-10 w-44 rounded-control" />
        <Skeleton className="ml-auto h-10 w-32 rounded-control" />
      </div>
      <Card flush>
        <div className="grid grid-cols-7 gap-px border-b border-line p-3">
          {Array.from({ length: 7 }, (_, day) => <Skeleton className="mx-auto h-4 w-16" key={day} />)}
        </div>
        <div className="grid h-[420px] grid-cols-7 gap-2 p-3">
          {Array.from({ length: 7 }, (_, day) => (
            <div className="space-y-2" key={day}>
              {day % 2 === 0 ? <Skeleton className="h-16" /> : null}
              {day % 3 === 1 ? <Skeleton className="mt-10 h-12" /> : null}
            </div>
          ))}
        </div>
      </Card>
    </Busy>
  );
}

/** Settings and Profile: title, then a column of setting cards. */
export function CardsPageSkeleton({ label = "Loading settings" }: { label?: string }) {
  return (
    <Busy className="mx-auto max-w-3xl space-y-5 py-1" label={label}>
      <HeaderSkeleton />
      {[0, 1, 2].map((card) => (
        <Card className="space-y-4" key={card}>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-10 w-full" />
        </Card>
      ))}
    </Busy>
  );
}
