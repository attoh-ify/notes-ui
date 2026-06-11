import Delta from "quill-delta";
import {
  Segment,
  Reference,
  TooltipState,
  BlockFormatChangeItem,
  FormatChange,
} from "../types";

// ─── Runtime segment utilities ────────────────────────────────────────────────

export function deltaToSegments(delta: Delta, nextId: () => string): Segment[] {
  return (delta.ops ?? [])
    .filter((op: any) => op.insert !== undefined && op.insert !== null)
    .map((op: any) => {
      const allAttrs: Record<string, any> = { ...(op.attributes ?? {}) };

      const insertMeta = normalizeChangeMeta<any>(allAttrs["audit-insert"]);

      const deleteMeta =
        normalizeChangeMeta<any>(allAttrs["audit-delete"]) ??
        normalizeChangeMeta<any>(allAttrs["audit-delete-singleline"]) ??
        normalizeChangeMeta<any>(allAttrs["audit-delete-multiline"]) ??
        null;

      const reviewBaseMeta = normalizeChangeMeta<any>(allAttrs["review-base"]);

      const reviewBlockBaseMeta = normalizeChangeMeta<any>(
        allAttrs["review-block-base"],
      );

      let baseAttributes: Record<string, any>;
      let changeAttributes: Record<string, any>;

      if (insertMeta) {
        baseAttributes = { ...(insertMeta.baseAttributes ?? {}) };
        changeAttributes = { ...(insertMeta.changeAttributes ?? {}) };
      } else if (deleteMeta) {
        baseAttributes = { ...(deleteMeta.baseAttributes ?? {}) };
        changeAttributes = { ...(deleteMeta.changeAttributes ?? {}) };
      } else if (reviewBaseMeta) {
        baseAttributes = { ...(reviewBaseMeta.baseAttributes ?? {}) };
        changeAttributes = {
          ...(reviewBaseMeta.changeAttributes ?? {}),
        };
      } else if (reviewBlockBaseMeta) {
        baseAttributes = { ...(reviewBlockBaseMeta.baseAttributes ?? {}) };
        changeAttributes = {
          ...(reviewBlockBaseMeta.changeAttributes ?? {}),
        };
      } else {
        baseAttributes = stripRuntimeChangeAttrs(allAttrs);
        changeAttributes = {};
      }

      const references: Reference[] = cloneReferences(
        insertMeta?.references ?? deleteMeta?.references ?? [],
      );

      const isTextInsert = typeof op.insert === "string";

      return {
        id: nextId(),
        text: isTextInsert ? op.insert : "",
        embed: isTextInsert ? undefined : cloneJsonValue(op.insert),

        baseAttributes,
        changeAttributes,
        references,

        insertChange: insertMeta
          ? {
              groupId: insertMeta.groupId,
              actorEmail: insertMeta.actorEmail,
              createdAt: insertMeta.createdAt,
            }
          : undefined,

        deleteChange: deleteMeta
          ? {
              groupId: deleteMeta.groupId,
              actorEmail: deleteMeta.actorEmail,
              createdAt: deleteMeta.createdAt,
              type:
                deleteMeta.type ??
                (allAttrs["audit-delete-singleline"]
                  ? "SINGLE_LINE"
                  : allAttrs["audit-delete-multiline"]
                    ? "MULTI_LINE"
                    : "TEXT"),
            }
          : undefined,
      };
    });
}

function normalizeChangeMeta<T = any>(value: any): T | null {
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

export function getChangeSelector(
  groupId: string,
  type: TooltipState["type"] | "delete-inline" = "delete-inline",
): string {
  if (type === "insert") {
    return `[data-change-type="insert"][data-group-id="${groupId}"]`;
  }

  if (type === "format") {
    return `[data-change-type="format"][data-group-id="${groupId}"]`;
  }

  return `[data-change-type="delete"][data-group-id="${groupId}"]`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function cloneReferences(refs: Reference[] = []): Reference[] {
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

export function rangesFromReferences(
  references: Reference[] = [],
): ReviewRange[] {
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

function segmentLength(seg: Segment): number {
  return seg.embed ? 1 : seg.text.length;
}

function stripRuntimeChangeAttrs(
  attrs: Record<string, any>,
): Record<string, any> {
  const {
    "review-base": _rb,
    "review-block-base": _rbb,
    "audit-format": _f,
    "audit-block-format": _bf,
    "audit-delete": _d,
    "audit-delete-singleline": _dsl,
    "audit-delete-multiline": _dml,
    "audit-insert": _i,
    ...clean
  } = attrs ?? {};

  return clean;
}

export function isBlockFormatChange(
  item: FormatChange,
): item is BlockFormatChangeItem {
  return "behavior" in item || "conflictGroup" in item;
}

function referenceLength(seg: Segment): number {
  return segmentLength(seg);
}

export function referenceIndexToVisualIndex(
  segments: Segment[],
  referenceIndex: number,
): number {
  let referenceCursor = 0;
  let visualCursor = 0;

  for (const seg of segments) {
    const visualLength = segmentLength(seg);

    const refLength = referenceLength(seg);

    if (referenceIndex < referenceCursor + refLength) {
      return visualCursor + (referenceIndex - referenceCursor);
    }

    referenceCursor += refLength;
    visualCursor += visualLength;
  }

  return visualCursor;
}
