import { Card } from "@/app/ui/card";
import { Skeleton, SkeletonRows } from "@/app/ui/feedback";

// Shown in the content area while a page loads; the sidebar and top bar stay on screen.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading page" className="space-y-6 py-1" role="status">
      <div className="space-y-2.5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Card flush>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="ml-auto h-8 w-24" />
        </div>
        <SkeletonRows columns={5} rows={7} />
      </Card>
    </div>
  );
}
