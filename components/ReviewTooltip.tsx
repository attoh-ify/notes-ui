import { Reference, TooltipState, TYPE_CONFIG } from "@/src/types";
import { Button } from "@/components/ui";

interface ReviewTooltipProps {
  tooltip: TooltipState;
  onAccept: (
    groupId: string,
    type: "insert" | "delete" | "format",
    references: Reference[],
  ) => void;
  onReject: (groupId: string, type: "insert" | "delete" | "format") => void;
  onClose: () => void;
  readOnly?: boolean;
}

export function ReviewTooltip({
  tooltip,
  onAccept,
  onReject,
  onClose,
  readOnly = false,
}: ReviewTooltipProps) {
  const config = TYPE_CONFIG[tooltip.type];

  return (
    <aside className="review-tooltip-panel" aria-label="Suggestion details">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: config.color }}
          />
          <div className="min-w-0">
            <p className="m-0 text-sm font-black text-slate-950">{config.label}</p>
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-slate-400">Suggestion details</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
          aria-label="Close suggestion details"
        >
          ×
        </button>
      </div>

      <div className="my-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm">
        <p className="mb-1 text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400">Made by</p>
        <p className="break-all font-bold text-slate-900">{tooltip.actorEmail || "Unknown"}</p>
        <p className="mt-2 text-xs text-slate-500">
          {tooltip.createdAt ? new Date(tooltip.createdAt).toLocaleString() : "Unknown time"}
        </p>
        <p className="mt-1 break-all text-xs text-slate-500">Group ID: {tooltip.groupId || "Unknown group"}</p>

        {readOnly && (
          <p className="mt-1 text-xs text-slate-500">Operation refs: {tooltip.references.length}</p>
        )}
      </div>

      {!readOnly && (
        <div className="grid gap-2">
          <Button
            type="button"
            onClick={() => onAccept(tooltip.groupId, tooltip.type, tooltip.references)}
            style={{ background: config.color, borderColor: config.color }}
          >
            ✓ Accept change
          </Button>

          <Button
            type="button"
            variant="secondary"
            className="border-red-200 text-red-700 hover:bg-red-50"
            onClick={() => onReject(tooltip.groupId, tooltip.type)}
          >
            ✕ Reject change
          </Button>
        </div>
      )}
    </aside>
  );
}
