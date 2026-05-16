import {
  buildFormatOverlayClearDelta,
  buildFormatOverlayDelta,
  restoreFormatSuggestionToBase,
} from "../attribution";
import {
  canActOnFormatSuggestion,
  refreshEditorFromRuntime,
  ReviewRuntimeContext,
} from "./runtimeHelpers";
import { FormatSuggestionItem, ReviewEntry, TooltipState } from "@/src/types";
import { snapshotAndApply } from "./reviewHistory";
import Delta from "quill-delta";

// ---------------------------------------------------------------------------
// activateFormatSuggestion
// ---------------------------------------------------------------------------
// Clears any previously active overlay, then applies the new one and updates
// the tooltip to point at the activated format suggestion.
// Toggling the same groupId twice closes the tooltip instead.
// ---------------------------------------------------------------------------
export function activateFormatSuggestion(
  ctx: ReviewRuntimeContext,
  groupId: string,
  setActiveFormatId: (v: string | null) => void,
  setActiveSuggestion: (v: TooltipState | null) => void,
  closeTooltip: (
    ctx: ReviewRuntimeContext,
    setActiveFormatId: (v: string | null) => void,
    setActiveSuggestion: (v: TooltipState | null) => void,
  ) => void,
) {
  const quill = ctx.quill;
  if (!quill) return;

  const fmts = ctx.formatSuggestionsRef.current;
  const prevId = ctx.activeFormatIdRef.current;

  if (prevId) {
    const prev = fmts.find((f) => f.groupId === prevId);
    if (prev) {
      quill.updateContents(buildFormatOverlayClearDelta(prev), "api");
    }
  }

  // Toggle off if the same item is clicked again.
  if (prevId === groupId) {
    closeTooltip(ctx, setActiveFormatId, setActiveSuggestion);
    return;
  }

  const item = fmts.find((f) => f.groupId === groupId);
  if (!item) return;

  quill.updateContents(buildFormatOverlayDelta(item), "api");
  setActiveFormatId(groupId);
  setActiveSuggestion({
    groupId: item.groupId,
    type: "format",
    actorEmail: item.actorEmail,
    createdAt: item.createdAt,
    references: item.references.map((r) => ({
      reviewStart: r.reviewStart,
      componentStart: r.componentStart,
      length: r.length,
      opId: r.opId,
      componentIndex: r.componentIndex,
    })),
  });
}

// ---------------------------------------------------------------------------
// closeReviewTooltip
// ---------------------------------------------------------------------------
// Clears an active format overlay (if the tooltip is showing a format
// suggestion) then nulls out the tooltip state.
// ---------------------------------------------------------------------------
export function closeReviewTooltip(
  ctx: ReviewRuntimeContext,
  setActiveFormatId: (v: string | null) => void,
  setActiveSuggestion: (v: TooltipState | null) => void,
) {
  const quill = ctx.quill;
  const activeId = ctx.activeFormatIdRef.current;

  if (quill && ctx.activeSuggestionRef.current?.type === "format" && activeId) {
    const activeItem = ctx.formatSuggestionsRef.current.find(
      (f) => f.groupId === activeId,
    );
    if (activeItem) {
      quill.updateContents(buildFormatOverlayClearDelta(activeItem), "api");
    }
    setActiveFormatId(null);
  }

  setActiveSuggestion(null);
}

// ---------------------------------------------------------------------------
// acceptFormatSuggestion
// ---------------------------------------------------------------------------
// Accepts a format suggestion: clears its overlay, removes it from the list,
// records accepted references, and snapshots for undo.
// ---------------------------------------------------------------------------
export function acceptFormatSuggestion(
  ctx: ReviewRuntimeContext,
  item: FormatSuggestionItem,
  deps: {
    snapshotAndApply: typeof snapshotAndApply;
    setFormatSuggestions: (updater: (prev: FormatSuggestionItem[]) => FormatSuggestionItem[]) => void;
    setActiveFormatId: (v: string | null) => void;
    acceptedReferences: { current: any[] };
    reviewHistory: { current: ReviewEntry[] };
  }
) {
  if (!canActOnFormatSuggestion(ctx, item)) return;

  deps.snapshotAndApply(
    ctx,
    () => {
      const quill = ctx.quill!;
      quill.updateContents(buildFormatOverlayClearDelta(item), "api");

      deps.acceptedReferences.current.push(
        item.references.map((ref) => ({
          opId: ref.opId,
          componentIndex: ref.componentIndex,
          componentStart: ref.componentStart,
          length: ref.length,
          attributeKey: item.attributeKey,
        })),
      );

      deps.setFormatSuggestions((prev) =>
        prev.filter((f) => f.groupId !== item.groupId),
      );

      deps.setActiveFormatId(null);
    },
    "ACCEPT",
    {
      reviewHistory: deps.reviewHistory,
    },
  );
}

// ---------------------------------------------------------------------------
// rejectFormatSuggestion
// ---------------------------------------------------------------------------
// Rejects a format suggestion: clears its overlay, restores base formatting
// in the runtime segments, refreshes the editor, and snapshots for undo.
// ---------------------------------------------------------------------------
export function rejectFormatSuggestion(
  ctx: ReviewRuntimeContext,
  item: FormatSuggestionItem,
  deps: {
    snapshotAndApply: typeof snapshotAndApply;
    setFormatSuggestions: (updater: (prev: FormatSuggestionItem[]) => FormatSuggestionItem[]) => void;
    setActiveFormatId: (v: string | null) => void;
    rejectedReferences: { current: any[] };
    reviewHistory: { current: ReviewEntry[] };
  },
) {
  if (!canActOnFormatSuggestion(ctx, item)) return;

  deps.snapshotAndApply(
    ctx,
    () => {
      const quill = ctx.quill!;
      quill.updateContents(buildFormatOverlayClearDelta(item), "api");
      deps.rejectedReferences.current.push(
        item.references.map((ref) => ({
          opId: ref.opId,
          componentIndex: ref.componentIndex,
          componentStart: ref.componentStart,
          length: ref.length,
          attributeKey: item.attributeKey,
        })),
      );

      ctx.reviewSegmentsRef.current = restoreFormatSuggestionToBase(
        ctx.reviewSegmentsRef.current,
        item,
      );

      refreshEditorFromRuntime(ctx);

      deps.setFormatSuggestions((prev) =>
        prev.filter((f) => f.groupId !== item.groupId),
      );
      deps.setActiveFormatId(null);
    },
    "REJECT",
    {
      reviewHistory: deps.reviewHistory,
    },
  );
}