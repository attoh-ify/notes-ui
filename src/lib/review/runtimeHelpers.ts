import {
  FormatSuggestionItem,
  ReviewSegment,
  TooltipState,
} from "@/src/types";

import {
  buildFormatOverlayClearDelta,
  buildFormatOverlayDelta,
  getRuntimeTextInRange,
  segmentsToDelta,
} from "../attribution";

import Quill from "quill";

export type ReviewRuntimeContext = {
  quill: Quill | null;
  runtimeSegCtrRef: { current: number };
  reviewSegmentsRef: { current: ReviewSegment[] };
  formatSuggestionsRef: { current: FormatSuggestionItem[] };
  activeSuggestionRef: { current: TooltipState | null };
  activeFormatIdRef: { current: string | null };
};

export function nextRuntimeSegmentId(ctx: ReviewRuntimeContext): string {
  ctx.runtimeSegCtrRef.current += 1;
  return `seg_${ctx.runtimeSegCtrRef.current}`;
}

export function refreshEditorFromRuntime(ctx: ReviewRuntimeContext): void {
  if (!ctx.quill) return;

  const delta = segmentsToDelta(ctx.reviewSegmentsRef.current);
  ctx.quill.setContents(delta, "api");
}

export function refreshPreviewTextsAgainstRuntime(
  ctx: ReviewRuntimeContext,
  items: FormatSuggestionItem[],
): FormatSuggestionItem[] {
  return items.map((item) => {
    const text = item.spans
      .map((span) =>
        getRuntimeTextInRange(
          ctx.reviewSegmentsRef.current,
          span.start,
          span.length,
        ),
      )
      .join("")
      .replace(/\n/g, " ↵ ")
      .slice(0, 60);

    return { ...item, previewText: text };
  });
}

export function cloneTooltipState(
  tooltip: TooltipState | null,
): TooltipState | null {
  return tooltip
    ? {
        ...tooltip,
        references: tooltip.references.map((r) => ({
          reviewStart: r.reviewStart,
          componentStart: r.componentStart,
          length: r.length,
          ref: {
            opId: r.ref.opId,
            componentIndex: r.ref.componentIndex,
          },
        })),
      }
    : null;
}

export function isInsertGroupStillPending(
  ctx: ReviewRuntimeContext,
  groupId: string,
): boolean {
  const quill = ctx.quill;
  if (!quill) return false;

  return !!quill.root.querySelector(
    `[data-suggestion-type="insert"][data-group-id="${groupId}"]`,
  );
}

export function canActOnFormatSuggestion(
  ctx: ReviewRuntimeContext,
  item: FormatSuggestionItem,
): boolean {
  return item.dependsOnInsertGroupIds.every(
    (groupId) => !isInsertGroupStillPending(ctx, groupId),
  );
}

export function suspendActiveFormatOverlay(
  ctx: ReviewRuntimeContext,
): FormatSuggestionItem | null {
  const quill = ctx.quill;
  if (!quill) return null;

  const activeId = ctx.activeFormatIdRef.current;
  if (!activeId) return null;

  const activeItem =
    ctx.formatSuggestionsRef.current.find((f) => f.groupId === activeId) ??
    null;

  if (activeItem) {
    quill.updateContents(buildFormatOverlayClearDelta(activeItem), "api");
  }

  return activeItem;
}

export function restoreActiveFormatOverlay(
  ctx: ReviewRuntimeContext,
  item: FormatSuggestionItem | null,
): void {
  const quill = ctx.quill;
  if (!quill || !item) return;

  quill.updateContents(buildFormatOverlayDelta(item), "api");
}