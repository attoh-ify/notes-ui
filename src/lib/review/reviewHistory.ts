import { ReviewAction, ReviewEntry, TooltipState } from "@/src/types";
import {
  captureRuntimeSnapshot,
  cloneTooltipState,
  refreshEditorFromRuntime,
  restoreActiveFormatOverlay,
  ReviewRuntimeContext,
  suspendActiveFormatOverlay,
} from "./runtimeHelpers";
import {
  cloneFormatSuggestions,
  cloneSegments,
  segmentsToDelta,
  stripSuggestionAttributes,
} from "../attribution";

// ---------------------------------------------------------------------------
// snapshotAndApply
// ---------------------------------------------------------------------------
// Captures a runtime snapshot, runs fn(), then pushes an entry to
// reviewHistory. If the action is REJECT it also computes the stripped
// redo-delta and pushes it to rejectedChanges.
// ---------------------------------------------------------------------------
export function snapshotAndApply(
  ctx: ReviewRuntimeContext,
  fn: () => void,
  type: ReviewAction,
  deps: {
    reviewHistory: { current: ReviewEntry[] };
    rejectedChanges: { current: import("quill-delta").default[] };
  },
) {
  const snapshot = captureRuntimeSnapshot(ctx);

  const beforeDelta =
    type === "REJECT" ? segmentsToDelta(snapshot.segments) : null;

  fn();

  deps.reviewHistory.current.push({ type, snapshot });

  if (type === "REJECT") {
    const afterDelta = ctx.quill!.getContents();
    const redoDelta = stripSuggestionAttributes(beforeDelta!.diff(afterDelta));
    deps.rejectedChanges.current.push(redoDelta);
  }
}

// ---------------------------------------------------------------------------
// undo
// ---------------------------------------------------------------------------
// Pops the last history entry and restores the runtime to that snapshot.
// ---------------------------------------------------------------------------
export function undo(
  ctx: ReviewRuntimeContext,
  deps: {
    reviewHistory: { current: ReviewEntry[] };
    rejectedChanges: { current: any[] };
    acceptedReferences: { current: any[] };
    setFormatSuggestions: (v: any) => void;
    setActiveFormatId: (v: string | null) => void;
    setActiveSuggestion: (v: TooltipState | null) => void;
  },
) {
  if (deps.reviewHistory.current.length === 0) return;

  const entry =
    deps.reviewHistory.current[deps.reviewHistory.current.length - 1];

  const suspended = suspendActiveFormatOverlay(ctx);

  try {
    ctx.reviewSegmentsRef.current = cloneSegments(entry.snapshot.segments);

    refreshEditorFromRuntime(ctx);

    deps.setFormatSuggestions(
      cloneFormatSuggestions(entry.snapshot.formatSuggestions),
    );
    deps.setActiveFormatId(entry.snapshot.activeFormatId);
    deps.setActiveSuggestion(cloneTooltipState(entry.snapshot.activeSuggestion));
  } finally {
    restoreActiveFormatOverlay(ctx, suspended);
  }

  if (entry.type === "REJECT") {
    deps.rejectedChanges.current.pop();
  } else {
    deps.acceptedReferences.current.pop();
  }

  deps.reviewHistory.current.pop();
}