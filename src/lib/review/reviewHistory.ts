import {
  BlockFormatSuggestionItem,
  BlockFormatSuggestionUndoPatch,
  FormatSuggestionItem,
  FormatSuggestionUndoPatch,
  ReviewAction,
  ReviewEntry,
  ReviewSegment,
  SegmentUndoPatch,
  TooltipState,
} from "@/src/types";

import {
  clearActiveFormatOverlay,
  cloneTooltipState,
  refreshEditorFromRuntime,
  ReviewRuntimeContext,
} from "./runtimeHelpers";

import {
  cloneBlockFormatSuggestions,
  cloneFormatSuggestions,
  cloneSegments,
} from "../attribution";

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

function sameBlockFormatSuggestion(
  a: BlockFormatSuggestionItem,
  b: BlockFormatSuggestionItem,
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

function buildBlockFormatSuggestionUndoPatch(
  before: BlockFormatSuggestionItem[],
  after: BlockFormatSuggestionItem[],
): BlockFormatSuggestionUndoPatch | null {
  let prefix = 0;

  while (
    prefix < before.length &&
    prefix < after.length &&
    sameBlockFormatSuggestion(before[prefix], after[prefix])
  ) {
    prefix++;
  }

  let beforeSuffix = before.length - 1;
  let afterSuffix = after.length - 1;

  while (
    beforeSuffix >= prefix &&
    afterSuffix >= prefix &&
    sameBlockFormatSuggestion(before[beforeSuffix], after[afterSuffix])
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
    before: cloneBlockFormatSuggestions(beforeChanged),
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

function applyBlockFormatSuggestionUndoPatch(
  current: BlockFormatSuggestionItem[],
  patch: BlockFormatSuggestionUndoPatch | null,
): BlockFormatSuggestionItem[] {
  if (!patch) return current;

  const next = [...current];

  next.splice(
    patch.index,
    patch.deleteCount,
    ...cloneBlockFormatSuggestions(patch.before),
  );

  return next;
}

export function snapshotAndApply(
  ctx: ReviewRuntimeContext,
  fn: () => void,
  type: ReviewAction,
  deps: {
    reviewHistory: { current: ReviewEntry[] };
  },
) {
  const beforeSegments = cloneSegments(ctx.reviewSegmentsRef.current);

  const beforeFormatSuggestions = cloneFormatSuggestions(
    ctx.formatSuggestionsRef.current,
  );

  const beforeBlockFormatSuggestions = cloneBlockFormatSuggestions(
    ctx.blockFormatSuggestionsRef.current,
  );

  const activeSuggestionBefore = cloneTooltipState(
    ctx.activeSuggestionRef.current,
  );

  const activeFormatIdBefore = ctx.activeFormatIdRef.current;

  fn();

  const afterSegments = cloneSegments(ctx.reviewSegmentsRef.current);

  const afterFormatSuggestions = cloneFormatSuggestions(
    ctx.formatSuggestionsRef.current,
  );

  const afterBlockFormatSuggestions = cloneBlockFormatSuggestions(
    ctx.blockFormatSuggestionsRef.current,
  );

  deps.reviewHistory.current.push({
    type,
    patch: {
      segmentsPatch: buildSegmentUndoPatch(beforeSegments, afterSegments),
      formatSuggestionsPatch: buildFormatSuggestionUndoPatch(
        beforeFormatSuggestions,
        afterFormatSuggestions,
      ),
      blockFormatSuggestionsPatch: buildBlockFormatSuggestionUndoPatch(
        beforeBlockFormatSuggestions,
        afterBlockFormatSuggestions,
      ),
      activeSuggestionBefore,
      activeFormatIdBefore,
    },
  });
}

export function undo(
  ctx: ReviewRuntimeContext,
  deps: {
    reviewHistory: { current: ReviewEntry[] };
    rejectedReferences: { current: any[] };
    acceptedReferences: { current: any[] };
    setFormatSuggestions: (v: FormatSuggestionItem[]) => void;
    setBlockFormatSuggestions: (v: BlockFormatSuggestionItem[]) => void;
    setActiveFormatId: (v: string | null) => void;
    setActiveSuggestion: (v: TooltipState | null) => void;
  },
) {
  if (deps.reviewHistory.current.length === 0) return;

  const entry =
    deps.reviewHistory.current[deps.reviewHistory.current.length - 1];

  clearActiveFormatOverlay(ctx);
  ctx.activeFormatIdRef.current = null;
  ctx.activeSuggestionRef.current = null;
  deps.setActiveFormatId(null);
  deps.setActiveSuggestion(null);

  ctx.reviewSegmentsRef.current = applySegmentUndoPatch(
    ctx.reviewSegmentsRef.current,
    entry.patch.segmentsPatch,
  );

  refreshEditorFromRuntime(ctx);

  const restoredFormatSuggestions = applyFormatSuggestionUndoPatch(
    ctx.formatSuggestionsRef.current,
    entry.patch.formatSuggestionsPatch,
  );

  const restoredBlockFormatSuggestions = applyBlockFormatSuggestionUndoPatch(
    ctx.blockFormatSuggestionsRef.current,
    entry.patch.blockFormatSuggestionsPatch,
  );

  ctx.formatSuggestionsRef.current = restoredFormatSuggestions;
  ctx.blockFormatSuggestionsRef.current = restoredBlockFormatSuggestions;

  deps.setFormatSuggestions(restoredFormatSuggestions);
  deps.setBlockFormatSuggestions(restoredBlockFormatSuggestions);

  if (entry.type === "REJECT") {
    deps.rejectedReferences.current.pop();
  } else {
    deps.acceptedReferences.current.pop();
  }

  deps.reviewHistory.current.pop();
}