import Delta from "quill-delta";
import {
  ReviewSegment,
  Reference,
  TooltipState,
  BlockFormatSuggestionItem,
  ReviewFormatSuggestion,
} from "../types";

// ─── Runtime segment utilities ────────────────────────────────────────────────

export function deltaToSegments(
  delta: Delta,
  nextId: () => string,
): ReviewSegment[] {
  return (delta.ops ?? [])
    .filter((op: any) => op.insert !== undefined && op.insert !== null)
    .map((op: any) => {
      const allAttrs: Record<string, any> = { ...(op.attributes ?? {}) };

      const insertMeta = normalizeSuggestionMeta<any>(
        allAttrs["suggestion-insert"],
      );

      const newlineMeta = normalizeSuggestionMeta<any>(
        allAttrs["suggestion-newline"],
      );

      const deleteMeta =
        normalizeSuggestionMeta<any>(allAttrs["suggestion-delete"]) ??
        normalizeSuggestionMeta<any>(allAttrs["suggestion-delete-singleline"]) ??
        normalizeSuggestionMeta<any>(allAttrs["suggestion-delete-multiline"]) ??
        null;

      const reviewBaseMeta = normalizeSuggestionMeta<any>(
        allAttrs["review-base"],
      );

      const reviewBlockBaseMeta = normalizeSuggestionMeta<any>(
        allAttrs["review-block-base"],
      );

      let baseAttributes: Record<string, any>;
      let suggestionAttributes: Record<string, any>;

      if (insertMeta) {
        baseAttributes = { ...(insertMeta.baseAttributes ?? {}) };
        suggestionAttributes = { ...(insertMeta.suggestionAttributes ?? {}) };
      } else if (newlineMeta) {
        baseAttributes = { ...(newlineMeta.baseAttributes ?? {}) };
        suggestionAttributes = { ...(newlineMeta.suggestionAttributes ?? {}) };
      } else if (deleteMeta) {
        baseAttributes = { ...(deleteMeta.baseAttributes ?? {}) };
        suggestionAttributes = { ...(deleteMeta.suggestionAttributes ?? {}) };
      } else if (reviewBaseMeta) {
        baseAttributes = { ...(reviewBaseMeta.baseAttributes ?? {}) };
        suggestionAttributes = { ...(reviewBaseMeta.suggestionAttributes ?? {}) };
      } else if (reviewBlockBaseMeta) {
        baseAttributes = { ...(reviewBlockBaseMeta.baseAttributes ?? {}) };
        suggestionAttributes = { ...(reviewBlockBaseMeta.suggestionAttributes ?? {}) };
      } else {
        baseAttributes = stripRuntimeSuggestionAttrs(allAttrs);
        suggestionAttributes = {};
      }

      const references: Reference[] = cloneSuggestionReferences(
        insertMeta?.references ??
          newlineMeta?.references ??
          deleteMeta?.references ??
          [],
      );

      const isTextInsert = typeof op.insert === "string";

      return {
        id: nextId(),
        text: isTextInsert ? op.insert : "",
        embed: isTextInsert ? undefined : cloneJsonValue(op.insert),

        baseAttributes,
        suggestionAttributes,
        references,

        insertSuggestion: insertMeta
          ? {
              groupId: insertMeta.groupId,
              actorEmail: insertMeta.actorEmail,
              createdAt: insertMeta.createdAt,
            }
          : undefined,

        newlineSuggestion: newlineMeta
          ? {
              groupId: newlineMeta.groupId,
              actorEmail: newlineMeta.actorEmail,
              createdAt: newlineMeta.createdAt,
              references: cloneSuggestionReferences(newlineMeta.references ?? references),
              dependsOnReviewRunIds: [
                ...(newlineMeta.dependsOnReviewRunIds ?? []),
              ],
              type: newlineMeta.type ?? "STANDALONE",
              marker: newlineMeta.marker === true,
            }
          : undefined,

        deleteSuggestion: deleteMeta
          ? {
              groupId: deleteMeta.groupId,
              actorEmail: deleteMeta.actorEmail,
              createdAt: deleteMeta.createdAt,
              type:
                deleteMeta.type ??
                (allAttrs["suggestion-delete-singleline"]
                  ? "SINGLE_LINE"
                  : allAttrs["suggestion-delete-multiline"]
                    ? "MULTI_LINE"
                    : "TEXT"),
            }
          : undefined,
      };
    });
}

function normalizeSuggestionMeta<T = any>(value: any): T | null {
  if (!value) return null;

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  return value as T;
}

// ─── DOM / selector utilities ─────────────────────────────────────────────────

export function getSuggestionSelector(
  groupId: string,
  type: TooltipState["type"] | "delete-inline" = "delete-inline",
): string {
  if (type === "insert") {
    return `[data-suggestion-type="insert"][data-group-id="${groupId}"]`;
  }

  if (type === "newline") {
    return `[data-suggestion-type="newline"][data-group-id="${groupId}"]`;
  }

  if (type === "format") {
    return `[data-suggestion-type="format"][data-group-id="${groupId}"]`;
  }

  return `[data-suggestion-type="delete"][data-group-id="${groupId}"]`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function cloneSuggestionReferences(
  refs: Reference[] = [],
): Reference[] {
  return refs.map((r) => ({
    reviewStart: r.reviewStart,
    componentStart: r.componentStart,
    length: r.length,
    opId: r.opId,
    componentIndex: r.componentIndex,
  }));
}

export type ReviewRange = {
  start: number;
  length: number;
};

export function rangesFromReferences(references: Reference[] = []): ReviewRange[] {
  const raw = references
    .filter((ref) => ref.length > 0)
    .map((ref) => ({
      start: ref.reviewStart,
      length: ref.length,
    }))
    .sort((a, b) => a.start - b.start);

  const merged: ReviewRange[] = [];

  for (const range of raw) {
    const last = merged[merged.length - 1];
    const start = range.start;
    const end = range.start + range.length;

    if (!last) {
      merged.push({ start, length: range.length });
      continue;
    }

    const lastEnd = last.start + last.length;

    if (start <= lastEnd) {
      last.length = Math.max(lastEnd, end) - last.start;
    } else {
      merged.push({ start, length: range.length });
    }
  }

  return merged;
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

function segmentLength(seg: ReviewSegment): number {
  return seg.embed ? 1 : seg.text.length;
}

function stripRuntimeSuggestionAttrs(
  attrs: Record<string, any>,
): Record<string, any> {
  const {
    "review-base": _rb,
    "review-block-base": _rbb,
    "suggestion-format": _f,
    "suggestion-block-format": _bf,
    "suggestion-delete": _d,
    "suggestion-delete-singleline": _dsl,
    "suggestion-delete-multiline": _dml,
    "suggestion-insert": _i,
    "suggestion-newline": _n,
    ...clean
  } = attrs ?? {};

  return clean;
}

export function isBlockFormatSuggestion(
  item: ReviewFormatSuggestion,
): item is BlockFormatSuggestionItem {
  return (
    "behavior" in item ||
    "conflictGroup" in item
  );
}

function isVirtualNewlineMarker(seg: ReviewSegment): boolean {
  return seg.newlineSuggestion?.marker === true;
}

function referenceLength(seg: ReviewSegment): number {
  return isVirtualNewlineMarker(seg) ? 0 : segmentLength(seg);
}

export function referenceIndexToVisualIndex(
  segments: ReviewSegment[],
  referenceIndex: number,
): number {
  let referenceCursor = 0;
  let visualCursor = 0;

  for (const seg of segments) {
    const visualLength = segmentLength(seg);

    /*
     * Virtual standalone newline markers exist in Quill visual space,
     * but they do not exist in backend reference space.
     */
    if (isVirtualNewlineMarker(seg)) {
      visualCursor += visualLength;
      continue;
    }

    const refLength = referenceLength(seg);

    if (referenceIndex < referenceCursor + refLength) {
      return visualCursor + (referenceIndex - referenceCursor);
    }

    referenceCursor += refLength;
    visualCursor += visualLength;
  }

  return visualCursor;
}