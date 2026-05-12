import {
  FormatSuggestionItem,
  FormatSuggestionUndoPatch,
  ReviewAction,
  ReviewEntry,
  ReviewSegment,
  SegmentUndoPatch,
  TooltipState,
} from "@/src/types";

import {
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

import type Delta from "quill-delta";

function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sameSegment(a: ReviewSegment, b: ReviewSegment): boolean {
  return stableStringify(a) === stableStringify(b);
}

function sameFormatSuggestion(
  a: FormatSuggestionItem,
  b: FormatSuggestionItem,
): boolean {
  return stableStringify(a) === stableStringify(b);
}

function buildSegmentUndoPatch(
  before: ReviewSegment[],
  after: ReviewSegment[],
): SegmentUndoPatch | null {
  let prefix = 0;

  while (
    prefix < before.length &&
    prefix < after.length &&
    sameSegment(before[prefix], after[prefix])
  ) {
    prefix++;
  }

  let beforeSuffix = before.length - 1;
  let afterSuffix = after.length - 1;

  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    sameSegment(before[beforeSuffix], after[afterSuffix])
  ) {
    beforeSuffix--;
    afterSuffix--;
  }

  const beforeChanged = before.slice(prefix, beforeSuffix + 1);
  const afterChanged = after.slice(prefix, afterSuffix + 1);

  if (beforeChanged.length === 0 && afterChanged.length === 0) {
    return null;
  }

  return {
    index: prefix,
    deleteCount: afterChanged.length,
    before: cloneSegments(beforeChanged),
  };
}

function buildFormatSuggestionUndoPatch(
  before: FormatSuggestionItem[],
  after: FormatSuggestionItem[],
): FormatSuggestionUndoPatch | null {
  let prefix = 0;

  while (
    prefix < before.length &&
    prefix < after.length &&
    sameFormatSuggestion(before[prefix], after[prefix])
  ) {
    prefix++;
  }

  let beforeSuffix = before.length - 1;
  let afterSuffix = after.length - 1;

  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    sameFormatSuggestion(before[beforeSuffix], after[afterSuffix])
  ) {
    beforeSuffix--;
    afterSuffix--;
  }

  const beforeChanged = before.slice(prefix, beforeSuffix + 1);
  const afterChanged = after.slice(prefix, afterSuffix + 1);

  if (beforeChanged.length === 0 && afterChanged.length === 0) {
    return null;
  }

  return {
    index: prefix,
    deleteCount: afterChanged.length,
    before: cloneFormatSuggestions(beforeChanged),
  };
}

function applySegmentUndoPatch(
  current: ReviewSegment[],
  patch: SegmentUndoPatch | null,
): ReviewSegment[] {
  if (!patch) return current;

  const next = [...current];

  next.splice(
    patch.index,
    patch.deleteCount,
    ...cloneSegments(patch.before),
  );

  return next;
}

function applyFormatSuggestionUndoPatch(
  current: FormatSuggestionItem[],
  patch: FormatSuggestionUndoPatch | null,
): FormatSuggestionItem[] {
  if (!patch) return current;

  const next = [...current];

  next.splice(
    patch.index,
    patch.deleteCount,
    ...cloneFormatSuggestions(patch.before),
  );

  return next;
}

export function snapshotAndApply(
  ctx: ReviewRuntimeContext,
  fn: () => void,
  type: ReviewAction,
  deps: {
    reviewHistory: { current: ReviewEntry[] };
    rejectedChanges: { current: Delta[] };
  },
) {
  const beforeSegments = cloneSegments(ctx.reviewSegmentsRef.current);

  const beforeFormatSuggestions = cloneFormatSuggestions(
    ctx.formatSuggestionsRef.current,
  );

  const activeSuggestionBefore = cloneTooltipState(
    ctx.activeSuggestionRef.current,
  );

  const activeFormatIdBefore = ctx.activeFormatIdRef.current;

  const beforeDelta =
    type === "REJECT" ? segmentsToDelta(beforeSegments) : null;

  fn();

  const afterSegments = cloneSegments(ctx.reviewSegmentsRef.current);

  const afterFormatSuggestions = cloneFormatSuggestions(
    ctx.formatSuggestionsRef.current,
  );

  const patch = {
    segmentsPatch: buildSegmentUndoPatch(beforeSegments, afterSegments),
    formatSuggestionsPatch: buildFormatSuggestionUndoPatch(
      beforeFormatSuggestions,
      afterFormatSuggestions,
    ),
    activeSuggestionBefore,
    activeFormatIdBefore,
  };

  deps.reviewHistory.current.push({
    type,
    patch,
  });

  if (type === "REJECT") {
    const afterDelta = ctx.quill!.getContents();
    const redoDelta = stripSuggestionAttributes(beforeDelta!.diff(afterDelta));
    deps.rejectedChanges.current.push(redoDelta);
  }
}

export function undo(
  ctx: ReviewRuntimeContext,
  deps: {
    reviewHistory: { current: ReviewEntry[] };
    rejectedChanges: { current: any[] };
    acceptedReferences: { current: any[] };
    setFormatSuggestions: (v: FormatSuggestionItem[]) => void;
    setActiveFormatId: (v: string | null) => void;
    setActiveSuggestion: (v: TooltipState | null) => void;
  },
) {
  if (deps.reviewHistory.current.length === 0) return;

  const entry =
    deps.reviewHistory.current[deps.reviewHistory.current.length - 1];

  const suspended = suspendActiveFormatOverlay(ctx);

  try {
    ctx.reviewSegmentsRef.current = applySegmentUndoPatch(
      ctx.reviewSegmentsRef.current,
      entry.patch.segmentsPatch,
    );

    refreshEditorFromRuntime(ctx);

    const restoredFormatSuggestions = applyFormatSuggestionUndoPatch(
      ctx.formatSuggestionsRef.current,
      entry.patch.formatSuggestionsPatch,
    );

    ctx.formatSuggestionsRef.current = restoredFormatSuggestions;
    deps.setFormatSuggestions(restoredFormatSuggestions);

    ctx.activeFormatIdRef.current = entry.patch.activeFormatIdBefore;
    deps.setActiveFormatId(entry.patch.activeFormatIdBefore);

    const restoredActiveSuggestion = cloneTooltipState(
      entry.patch.activeSuggestionBefore,
    );

    ctx.activeSuggestionRef.current = restoredActiveSuggestion;
    deps.setActiveSuggestion(restoredActiveSuggestion);
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