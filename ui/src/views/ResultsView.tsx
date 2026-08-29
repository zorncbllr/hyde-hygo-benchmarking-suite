import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { pyInvokeValidated } from "@/lib/api";
import {
  listRunsResponseSchema,
  runDetailResponseSchema,
  type RunDetailResponse,
  type RunRow,
} from "@/lib/schemas";
import { formatDuration } from "@/lib/formatters";
import RunDetail from "@/components/results/RunDetail";

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
};

/**
 * Results page: full run history on the left; selecting a run opens its
 * detail (metrics, charts, replay, analyses) with exports and run management
 * on the right.
 */
export default function ResultsView() {
  const location = useLocation();
  const handedOffRunId =
    (location.state as { runId?: string } | null)?.runId ?? null;

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selected, setSelected] = useState<string | null>(handedOffRunId);
  const [detail, setDetail] = useState<RunDetailResponse | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadRuns = useCallback(async () => {
    try {
      const res = await pyInvokeValidated("list_runs", listRunsResponseSchema, {
        status: statusFilter === "all" ? null : statusFilter,
        search: search || null,
        per_page: 100,
      });
      setRuns(res.items);
      // prefer the handed-off run; fall back to the newest entry
      if (handedOffRunId && res.items.some((r) => r.id === handedOffRunId)) {
        setSelected(handedOffRunId);
      } else if (!res.items.some((r) => r.id === selected)) {
        setSelected(res.items[0]?.id ?? null);
      }
    } catch (err) {
      toast.error(`Failed to load run history: ${String(err)}`);
    }
  }, [statusFilter, search, selected, handedOffRunId]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    pyInvokeValidated("get_run_detail", runDetailResponseSchema, {
      run_id: selected,
    })
      .then((d: RunDetailResponse) => setDetail(d))
      .catch((err: unknown) => {
        toast.error(String(err));
        setDetail(null);
      });
  }, [selected]);

  function refresh() {
    loadRuns();
  }

  function afterDelete() {
    setSelected(null);
    setDetail(null);
    loadRuns();
  }

  return (
    <div className="flex h-full">
      {/* Runs list */}
      <aside className="flex w-80 shrink-0 flex-col border-r">
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center gap-2">
            <Input
              className="h-8"
              placeholder="Search label or notes..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && refresh()}
            />
            <Button size="icon" variant="ghost" onClick={refresh}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              const value = v ?? "all";
              setStatusFilter(value);
            }}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                "all",
                "draft",
                "running",
                "completed",
                "failed",
                "cancelled",
              ].map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {runs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No runs found.
            </p>
          ) : (
            <div className="space-y-1">
              {runs.map((r) => (
                <button
                  key={r.id}
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/50",
                    selected === r.id && "bg-accent",
                  )}
                  onClick={() => setSelected(r.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">
                      {r.label}
                    </span>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>
                      {r.status}
                    </Badge>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{new Date(r.created_at).toLocaleDateString()}</span>
                    <span>{r.scenarios} scenarios</span>
                    <span>
                      {r.duration_s !== null
                        ? formatDuration(r.duration_s)
                        : "-"}
                    </span>
                  </div>
                  {r.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <Badge
                          key={t}
                          variant="outline"
                          className="px-1 text-[10px]"
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Detail */}
      <main className="flex-1 overflow-y-auto p-6">
        {detail ? (
          <RunDetail
            detail={detail}
            onChanged={refresh}
            onDeleted={afterDelete}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Select a run from the history to see its results.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
