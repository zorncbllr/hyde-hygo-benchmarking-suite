import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

const RUN_ROW_COUNT = 6;

export function RunsListSkeleton() {
  return (
    <div className="space-y-1" aria-busy="true" aria-live="polite">
      {Array.from({ length: RUN_ROW_COUNT }).map((_, i) => (
        <div key={i} className="rounded-md px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <Skeleton
              className="h-4"
              style={{ width: `${45 + ((i * 13) % 35)}%` }}
            />
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

const TABLE_ROW_COUNT = 5;

export function RunDetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-16" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-4">
            {["w-16", "w-14", "w-20", "w-24"].map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-4 w-4 rounded-sm" />
                <Skeleton className={`h-4 ${w}`} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-28 rounded-md" />
            <Skeleton className="h-8 w-44 rounded-md" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex gap-4">
              {["w-24", "w-20", "w-28", "w-24", "w-20", "w-24", "w-24"].map(
                (w, i) => (
                  <Skeleton key={i} className={`h-3 ${w}`} />
                ),
              )}
            </div>
            {Array.from({ length: TABLE_ROW_COUNT }).map((_, i) => (
              <div key={i} className="flex gap-4">
                {["w-20", "w-24", "w-24", "w-20", "w-16", "w-20", "w-20"].map(
                  (w, j) => (
                    <Skeleton
                      key={j}
                      className={`h-3 ${w}`}
                      style={{ opacity: 1 - i * 0.15 }}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-28" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-6 w-64" />
          <Skeleton className="mt-4 h-[300px] w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

/** Bar-shaped placeholder mimicking a chart area while its data loads. */
export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div
      data-testid="chart-skeleton"
      className="space-y-2"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-end gap-2" style={{ height }}>
        {[55, 75, 40, 85, 60, 70, 45, 80].map((pct, i) => (
          <Skeleton key={i} className="w-full" style={{ height: `${pct}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Document-shaped placeholder for the statistical analyses report. */
export function ReportSkeleton() {
  return (
    <div
      data-testid="report-skeleton"
      className="space-y-6"
      aria-busy="true"
      aria-live="polite"
    >
      {["w-48", "w-64", "w-40"].map((w, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className={`h-5 ${w}`} />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
