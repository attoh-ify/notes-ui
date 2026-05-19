import {
  BlockFormatSuggestionItem,
  FormatSuggestionItem,
  ReviewFormatSuggestion,
  ReviewSegment,
  TooltipState,
} from "@/src/types";

import {
  buildFormatOverlayClearDelta,
  getRuntimeTextInRange,
  isBlockFormatSuggestion,
  rangesFromReferences,
  segmentLength,
  segmentsToBaseDelta,
  segmentsToSuggestionOverlayDelta,
} from "../attribution";

import Quill from "quill";

export type ReviewRuntimeContext = {
  quill: Quill | null;
  runtimeSegCtrRef: { current: number };
  reviewSegmentsRef: { current: ReviewSegment[] };
  formatSuggestionsRef: { current: FormatSuggestionItem[] };
  blockFormatSuggestionsRef: { current: BlockFormatSuggestionItem[] };
  activeSuggestionRef: { current: TooltipState | null };
  activeFormatIdRef: { current: string | null };
};

export function nextRuntimeSegmentId(ctx: ReviewRuntimeContext): string {
  ctx.runtimeSegCtrRef.current += 1;
  return `seg_${ctx.runtimeSegCtrRef.current}`;
}

export function refreshEditorFromRuntime(ctx: ReviewRuntimeContext): void {
  const quill = ctx.quill;
  if (!quill) return;

  const baseDelta = segmentsToBaseDelta(ctx.reviewSegmentsRef.current);
  const overlayDelta = segmentsToSuggestionOverlayDelta(
    ctx.reviewSegmentsRef.current,
  );

  quill.setContents(baseDelta, "api");
  quill.updateContents(overlayDelta, "api");
}

export function refreshPreviewTextsAgainstRuntime(
  ctx: ReviewRuntimeContext,
  items: FormatSuggestionItem[],
): FormatSuggestionItem[] {
  return items.map((item) => {
    const ranges = rangesFromReferences(item.references ?? []);

    let text = "";
    let previousEnd: number | null = null;

    for (const range of ranges) {
      if (previousEnd !== null && range.start > previousEnd) {
        text += " ... ";
      }

      text += getRuntimeTextInRange(
        ctx.reviewSegmentsRef.current,
        range.start,
        range.length,
      ).replace(/\n/g, " ↵ ");

      previousEnd = range.start + range.length;
    }

    return { ...item, previewText: text.slice(0, 60) };
  });
}

export function refreshBlockPreviewTextsAgainstRuntime(
  ctx: ReviewRuntimeContext,
  items: BlockFormatSuggestionItem[],
): BlockFormatSuggestionItem[] {
  return items.map((item) => {
    const ranges = rangesFromReferences(item.references ?? []);

    let text = "";
    let previousEnd: number | null = null;

    for (const range of ranges) {
      if (previousEnd !== null && range.start > previousEnd) {
        text += " ... ";
      }

      text += getRuntimeLineTextForNewlineRef(
        ctx.reviewSegmentsRef.current,
        range.start,
      );

      previousEnd = range.start + range.length;
    }

    return { ...item, previewText: text.slice(0, 60) };
  });
}

function getRuntimeLineTextForNewlineRef(
  segments: ReviewSegment[],
  newlineIndex: number,
): string {
  let cursor = 0;
  let line = "";

  for (const seg of segments) {
    const len = segmentLength(seg);
    const start = cursor;
    const end = cursor + len;

    if (end <= newlineIndex) {
      if (!seg.embed && seg.text === "\n") {
        line = "";
      } else if (seg.embed) {
        line += "[image]";
      } else {
        line += seg.text;
      }

      cursor = end;
      continue;
    }

    if (start <= newlineIndex && newlineIndex < end) {
      if (seg.embed) {
        line += "[image]";
      } else {
        const offset = newlineIndex - start;
        line += seg.text.slice(0, offset);
      }
      break;
    }

    cursor = end;
  }

  return line.trim() || "[empty line]";
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
          opId: r.opId,
          componentIndex: r.componentIndex,
        })),
      }
    : null;
}

export function isInsertGroupStillPending(
  ctx: ReviewRuntimeContext,
  groupId: string,
): boolean {
  return ctx.reviewSegmentsRef.current.some(
    (seg) => seg.insertSuggestion?.groupId === groupId,
  );
}

export function isDeleteGroupStillPending(
  ctx: ReviewRuntimeContext,
  groupId: string,
): boolean {
  return ctx.reviewSegmentsRef.current.some(
    (seg) => seg.deleteSuggestion?.groupId === groupId,
  );
}

export function canActOnFormatSuggestion(
  ctx: ReviewRuntimeContext,
  item: ReviewFormatSuggestion,
): boolean {
  const insertDepsResolved = (item.dependsOnInsertGroupIds ?? []).every(
    (groupId) => !isInsertGroupStillPending(ctx, groupId),
  );

  const deleteDepsResolved = (item.dependsOnDeleteGroupIds ?? []).every(
    (groupId) => !isDeleteGroupStillPending(ctx, groupId),
  );

  return insertDepsResolved && deleteDepsResolved;
}

export function findRuntimeFormatSuggestion(
  ctx: ReviewRuntimeContext,
  groupId: string,
): ReviewFormatSuggestion | null {
  return (
    ctx.formatSuggestionsRef.current.find((f) => f.groupId === groupId) ??
    ctx.blockFormatSuggestionsRef.current.find((f) => f.groupId === groupId) ??
    null
  );
}

export function clearBlockFormatDomOverlay(ctx: ReviewRuntimeContext): void {
  const quill = ctx.quill;
  if (!quill) return;

  quill.root
    .querySelectorAll(".format-block-active")
    .forEach((el) => {
      el.classList.remove("format-block-active");
      el.removeAttribute("data-active-format-block-group-id");
    });
}

export function applyBlockFormatDomOverlay(
  ctx: ReviewRuntimeContext,
  item: BlockFormatSuggestionItem,
): void {
  const quill = ctx.quill;
  if (!quill) return;

  clearBlockFormatDomOverlay(ctx);

  for (const ref of item.references ?? []) {
    const result = quill.getLine(ref.reviewStart);

    if (!result) continue;

    const [line] = result as any;
    const domNode = line?.domNode as HTMLElement | undefined;

    if (!domNode) continue;

    domNode.classList.add("format-block-active");
    domNode.setAttribute("data-active-format-block-group-id", item.groupId);
  }
}

export function clearActiveFormatOverlay(ctx: ReviewRuntimeContext): void {
  const quill = ctx.quill;
  if (!quill) return;

  const activeId = ctx.activeFormatIdRef.current;
  if (!activeId) {
    clearBlockFormatDomOverlay(ctx);
    return;
  }

  const activeItem = findRuntimeFormatSuggestion(ctx, activeId);

  if (!activeItem) {
    clearBlockFormatDomOverlay(ctx);
    return;
  }

  if (isBlockFormatSuggestion(activeItem)) {
    clearBlockFormatDomOverlay(ctx);
    return;
  }

  quill.updateContents(buildFormatOverlayClearDelta(activeItem), "api");
}