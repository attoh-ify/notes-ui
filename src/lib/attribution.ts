import Delta from "quill-delta";
import {
  DeleteSuggestion,
  FormatSuggestionItem,
  InsertSuggestion,
  ReviewSegment,
  Reference,
  TooltipState,
} from "../types";

// ─── Format suggestion utilities ──────────────────────────────────────────────

export function cloneFormatSuggestions(
  items: FormatSuggestionItem[],
): FormatSuggestionItem[] {
  return items.map((item) => ({
    groupId: item.groupId,
    actorEmail: item.actorEmail,
    createdAt: item.createdAt,
    attributeKey: item.attributeKey,
    attributeValue: cloneJsonValue(item.attributeValue),
    references: cloneSuggestionReferences(item.references ?? []),
    previewText: item.previewText,
    dependsOnInsertGroupIds: [...(item.dependsOnInsertGroupIds ?? [])],
    dependsOnDeleteGroupIds: [...(item.dependsOnDeleteGroupIds ?? [])],
  }));
}

// ─── Quill delta utilities ────────────────────────────────────────────────────

export function stripSuggestionAttributes(delta: Delta): Delta {
  return new Delta(
    (delta.ops ?? []).map((op: any) => {
      if (!op.attributes) return op;

      const {
        "suggestion-format": _f,
        "suggestion-delete": _d,
        "suggestion-delete-newline": _dn,
        "suggestion-delete-singleline": _dsl,
        "suggestion-delete-multiline": _dml,
        "suggestion-insert": _i,
        ...attrs
      } = op.attributes;

      return {
        ...op,
        attributes: Object.keys(attrs).length ? attrs : undefined,
      };
    }),
  );
}

export function buildFormatOverlayDelta(item: FormatSuggestionItem): Delta {
  const delta = new Delta();
  let pos = 0;

  const attributes = {
    [item.attributeKey]: item.attributeValue,
  };

  const ranges = rangesFromReferences(item.references ?? []);

  for (const range of ranges) {
    if (range.start > pos) {
      delta.retain(range.start - pos);
    }

    delta.retain(range.length, {
      "suggestion-format": {
        groupId: item.groupId,
        actorEmail: item.actorEmail,
        createdAt: item.createdAt,
        attributes,
        references: cloneSuggestionReferences(item.references ?? []),
      },
    });

    pos = range.start + range.length;
  }

  return delta;
}

export function buildFormatOverlayClearDelta(item: FormatSuggestionItem): Delta {
  const delta = new Delta();
  let pos = 0;

  const ranges = rangesFromReferences(item.references ?? []);

  for (const range of ranges) {
    if (range.start > pos) {
      delta.retain(range.start - pos);
    }

    delta.retain(range.length, {
      "suggestion-format": null,
    });

    pos = range.start + range.length;
  }

  return delta;
}

// ─── Runtime segment utilities ────────────────────────────────────────────────

function hasSuggestionAttr(seg: ReviewSegment): boolean {
  return !!(seg.insertSuggestion || seg.deleteSuggestion);
}

export function deltaToSegments(
  delta: Delta,
  nextId: () => string,
): ReviewSegment[] {
  return (delta.ops ?? [])
    .filter((op: any) => op.insert !== undefined && op.insert !== null)
    .map((op: any) => {
      const allAttrs: Record<string, any> = { ...(op.attributes ?? {}) };

      const insertMeta = allAttrs["suggestion-insert"] ?? null;

      const deleteMeta =
        allAttrs["suggestion-delete"] ??
        allAttrs["suggestion-delete-singleline"] ??
        allAttrs["suggestion-delete-multiline"] ??
        allAttrs["suggestion-delete-newline"] ??
        null;

      const baseAttributes: Record<string, any> =
        insertMeta?.baseAttributes ??
        deleteMeta?.baseAttributes ??
        stripRuntimeSuggestionAttrs(allAttrs);

      const suggestionAttributes: Record<string, any> =
        insertMeta?.suggestionAttributes ??
        deleteMeta?.suggestionAttributes ??
        {};

      const references: Reference[] = cloneSuggestionReferences(
        insertMeta?.references ??
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

export function mergeAdjacentSegments(
  segments: ReviewSegment[],
): ReviewSegment[] {
  const merged: ReviewSegment[] = [];

  for (const seg of segments) {
    const last = merged[merged.length - 1];

    const canMerge =
      !!last &&
      !last.embed &&
      !seg.embed &&
      last.text !== "\n" &&
      seg.text !== "\n" &&
      !last.text.includes("\n") &&
      !seg.text.includes("\n") &&
      shallowEqual(getEffectiveAttributes(last), getEffectiveAttributes(seg)) &&
      sameInsertSuggestion(last, seg) &&
      sameDeleteSuggestion(last, seg) &&
      shallowEqual(last.baseAttributes ?? {}, seg.baseAttributes ?? {});

    if (canMerge) {
      last.text += seg.text;

      last.references = dedupeSuggestionReferences([
        ...(last.references ?? []),
        ...(seg.references ?? []),
      ]);

      continue;
    }

    merged.push(cloneSegment(seg));
  }

  return merged;
}

export function segmentsToDelta(segments: ReviewSegment[]): Delta {
  const delta = new Delta();

  for (const seg of segments) {
    const attrs: Record<string, any> = {
      ...(seg.baseAttributes ?? {}),
      ...(seg.suggestionAttributes ?? {}),
    };

    delete attrs["suggestion-insert"];
    delete attrs["suggestion-delete"];
    delete attrs["suggestion-delete-newline"];
    delete attrs["suggestion-delete-singleline"];
    delete attrs["suggestion-delete-multiline"];
    delete attrs["suggestion-format"];

    const references = cloneSuggestionReferences(seg.references ?? []);

    if (seg.insertSuggestion) {
      attrs["suggestion-insert"] = {
        groupId: seg.insertSuggestion.groupId,
        actorEmail: seg.insertSuggestion.actorEmail,
        createdAt: seg.insertSuggestion.createdAt,
        references,
        baseAttributes: seg.baseAttributes ?? null,
        suggestionAttributes: seg.suggestionAttributes ?? null,
      };
    }

    if (seg.deleteSuggestion) {
      const type = seg.deleteSuggestion.type ?? "TEXT";

      const deletePayload = {
        groupId: seg.deleteSuggestion.groupId,
        actorEmail: seg.deleteSuggestion.actorEmail,
        createdAt: seg.deleteSuggestion.createdAt,
        type,
        references,
        baseAttributes: seg.baseAttributes ?? null,
        suggestionAttributes: seg.suggestionAttributes ?? null,
      };

      if (type === "SINGLE_LINE") {
        attrs["suggestion-delete-singleline"] = deletePayload;
      } else if (type === "MULTI_LINE") {
        attrs["suggestion-delete-multiline"] = deletePayload;
      } else {
        attrs["suggestion-delete"] = deletePayload;
      }
    }

    delta.insert(
      segmentInsertValue(seg),
      Object.keys(attrs).length > 0 ? attrs : undefined,
    );
  }

  return delta;
}

export function cloneSegments(items: ReviewSegment[]): ReviewSegment[] {
  return items.map(cloneSegment);
}

function getRuntimePlainText(segments: ReviewSegment[]): string {
  return segments.map(segmentPreviewText).join("");
}

export function getRuntimeTextInRange(
  segments: ReviewSegment[],
  start: number,
  length: number,
): string {
  const end = start + length;
  let cursor = 0;
  let out = "";

  for (const seg of segments) {
    const segLen = segmentLength(seg);
    const segStart = cursor;
    const segEnd = cursor + segLen;

    if (segEnd <= start) {
      cursor = segEnd;
      continue;
    }

    if (segStart >= end) break;

    if (seg.embed) {
      out += "[image]";
      cursor = segEnd;
      continue;
    }

    out += seg.text.slice(
      Math.max(start, segStart) - segStart,
      Math.min(end, segEnd) - segStart,
    );

    cursor = segEnd;
  }

  return out;
}

export function findInsertGroupRangeInRuntime(
  segments: ReviewSegment[],
  groupId: string,
): { index: number; length: number } | null {
  let cursor = 0;
  let start = -1;
  let end = -1;

  for (const seg of segments) {
    const len = segmentLength(seg);

    if (seg.insertSuggestion?.groupId === groupId) {
      if (start === -1) start = cursor;
      end = cursor + len;
    }

    cursor += len;
  }

  return start === -1 ? null : { index: start, length: end - start };
}

export function findDeleteGroupRangeInRuntime(
  segments: ReviewSegment[],
  groupId: string,
): { index: number; length: number } | null {
  let cursor = 0;
  let start = -1;
  let end = -1;

  for (const seg of segments) {
    const len = segmentLength(seg);

    if (seg.deleteSuggestion?.groupId === groupId) {
      if (start === -1) start = cursor;
      end = cursor + len;
    }

    cursor += len;
  }

  return start === -1 ? null : { index: start, length: end - start };
}

export function removeInsertSuggestionFromSegments(
  segments: ReviewSegment[],
  groupId: string,
): ReviewSegment[] {
  return mergeAdjacentSegments(
    segments.map((seg) => {
      if (seg.insertSuggestion?.groupId !== groupId) return seg;

      return {
        id: seg.id,
        text: seg.text ?? "",
        embed: seg.embed ? cloneJsonValue(seg.embed) : undefined,
        baseAttributes: { ...(seg.baseAttributes ?? {}) },
        suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
        references: cloneSuggestionReferences(seg.references ?? []),
      };
    }),
  );
}

export function deleteInsertGroupSegments(
  segments: ReviewSegment[],
  groupId: string,
  insertRange: { index: number; length: number } | null,
): ReviewSegment[] {
  const afterDelete = segments.filter((seg) => {
    return seg.insertSuggestion?.groupId !== groupId;
  });

  if (!insertRange) {
    return mergeAdjacentSegments(afterDelete);
  }

  const rangeEnd = insertRange.index + insertRange.length;
  let cursor = 0;

  const cleaned = afterDelete.filter((seg) => {
    const segLen = segmentLength(seg);
    const segStart = cursor;
    const segEnd = cursor + segLen;
    cursor = segEnd;

    const isCommittedNewline =
      !seg.embed && seg.text === "\n" && !hasSuggestionAttr(seg);

    const isInsideRange =
      segStart >= insertRange.index && segEnd <= rangeEnd;

    return !(isCommittedNewline && isInsideRange);
  });

  return mergeAdjacentSegments(cleaned);
}

function removeRuntimeCharAt(
  segments: ReviewSegment[],
  index: number,
  nextId: () => string,
): ReviewSegment[] {
  if (index < 0) return segments;

  let cursor = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    const len = segmentLength(seg);
    const start = cursor;
    const end = cursor + len;

    if (index >= end) {
      cursor = end;
      continue;
    }

    if (seg.embed) {
      segments.splice(i, 1);
      return mergeAdjacentSegments(segments);
    }

    const offset = index - start;

    splitSegmentAt(segments, i, offset, nextId);

    const rightIndex = splitSegmentAt(segments, i + 1, 1, nextId);

    segments.splice(rightIndex - 1, 1);

    return mergeAdjacentSegments(segments);
  }

  return segments;
}

function insertRuntimeTextAt(
  segments: ReviewSegment[],
  index: number,
  text: string,
  nextId: () => string,
  baseAttributes: Record<string, any> = {},
  suggestionAttributes: Record<string, any> = {},
): ReviewSegment[] {
  if (!text) return segments;

  const newSeg: ReviewSegment = {
    id: nextId(),
    text,
    baseAttributes: { ...baseAttributes },
    suggestionAttributes: { ...suggestionAttributes },
    references: [],
  };

  let cursor = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    const len = segmentLength(seg);
    const start = cursor;
    const end = cursor + len;

    if (index > end) {
      cursor = end;
      continue;
    }

    if (index === start) {
      segments.splice(i, 0, newSeg);
      return mergeAdjacentSegments(segments);
    }

    if (index === end) {
      segments.splice(i + 1, 0, newSeg);
      return mergeAdjacentSegments(segments);
    }

    if (seg.embed) {
      segments.splice(i + 1, 0, newSeg);
      return mergeAdjacentSegments(segments);
    }

    const offset = index - start;

    splitSegmentAt(segments, i, offset, nextId);

    segments.splice(i + 1, 0, newSeg);

    return mergeAdjacentSegments(segments);
  }

  segments.push(newSeg);

  return mergeAdjacentSegments(segments);
}

export function normalizeLineBreaksAfterRejectedInsert(
  segments: ReviewSegment[],
  removedRange: { index: number; length: number },
  removedText: string,
  nextId: () => string,
): ReviewSegment[] {
  const boundary = removedRange.index;
  const currentText = getRuntimePlainText(segments);
  const charBefore = boundary > 0 ? currentText[boundary - 1] : null;
  const charAfter = boundary < currentText.length ? currentText[boundary] : null;

  const removedHadNewline = removedText.includes("\n");
  const beforeHasVisibleText = boundary > 0;
  const afterHasVisibleText = boundary < currentText.length;
  const beforeIsText = charBefore !== null && charBefore !== "\n";
  const afterIsText = charAfter !== null && charAfter !== "\n";

  if (charBefore === "\n" && charAfter === "\n") {
    return removeRuntimeCharAt(segments, boundary, nextId);
  }

  if (boundary === 0 && charAfter === "\n") {
    return removeRuntimeCharAt(segments, 0, nextId);
  }

  if (boundary === currentText.length && charBefore === "\n") {
    return removeRuntimeCharAt(segments, boundary - 1, nextId);
  }

  const removedHadText = removedText.replace(/\n/g, "").length > 0;

  if (
    removedHadNewline &&
    removedHadText &&
    beforeHasVisibleText &&
    afterHasVisibleText &&
    beforeIsText &&
    afterIsText
  ) {
    return insertRuntimeTextAt(segments, boundary, "\n", nextId, {}, {});
  }

  return segments;
}

// ─── DOM / selector utilities ─────────────────────────────────────────────────

export function getSuggestionSelector(
  groupId: string,
  type: TooltipState["type"] | "delete-inline" = "delete-inline",
): string {
  if (type === "insert") {
    return `[data-suggestion-type="insert"][data-group-id="${groupId}"]`;
  }

  if (type === "format") {
    return `[data-suggestion-type="format"][data-group-id="${groupId}"]`;
  }

  return `[data-suggestion-type="delete"][data-group-id="${groupId}"]`;
}

export function restoreFormatSuggestionToBase(
  segments: ReviewSegment[],
  item: FormatSuggestionItem,
): ReviewSegment[] {
  const key = item.attributeKey;

  let cursor = 0;

  const ranges = rangesFromReferences(item.references ?? []);

  const updated = segments.map((seg) => {
    const segLen = segmentLength(seg);
    const segStart = cursor;
    const segEnd = cursor + segLen;
    cursor = segEnd;

    const overlaps = ranges.some(
      (range) => range.start < segEnd && range.start + range.length > segStart,
    );

    if (!overlaps) return seg;

    const newSuggestion = { ...(seg.suggestionAttributes ?? {}) };
    delete newSuggestion[key];

    return {
      ...seg,
      embed: seg.embed ? cloneJsonValue(seg.embed) : undefined,
      baseAttributes: { ...(seg.baseAttributes ?? {}) },
      suggestionAttributes: newSuggestion,
      references: cloneSuggestionReferences(seg.references ?? []),
    };
  });

  return mergeAdjacentSegments(updated);
}

export function resolveFormatSuggestionsAfterMutation(
  items: FormatSuggestionItem[],
  mutation: { index: number; length: number },
  mutationGroupId: string,
  mutationType: "insert" | "delete",
  action: "ACCEPT" | "REJECT",
): FormatSuggestionItem[] {
  const rangeStart = mutation.index;
  const rangeEnd = rangeStart + mutation.length;

  const shouldShrink =
    (mutationType === "insert" && action === "REJECT") ||
    (mutationType === "delete" && action === "ACCEPT");

  const next: FormatSuggestionItem[] = [];

  for (const item of items) {
    const updatedReferences = shouldShrink
      ? removeRangeFromReferences(item.references ?? [], rangeStart, mutation.length)
      : cloneSuggestionReferences(item.references ?? []);

    if (updatedReferences.length === 0) continue;

    const dependsOnInsertGroupIds =
      mutationType === "insert"
        ? item.dependsOnInsertGroupIds.filter((id) => id !== mutationGroupId)
        : [...item.dependsOnInsertGroupIds];

    const dependsOnDeleteGroupIds =
      mutationType === "delete"
        ? item.dependsOnDeleteGroupIds.filter((id) => id !== mutationGroupId)
        : [...item.dependsOnDeleteGroupIds];

    next.push({
      ...item,
      references: updatedReferences,
      dependsOnInsertGroupIds,
      dependsOnDeleteGroupIds,
    });
  }

  return next;
}

function removeRangeFromReferences(
  refs: Reference[] = [],
  removeStart: number,
  removeLength: number,
): Reference[] {
  if (removeLength <= 0) return cloneSuggestionReferences(refs);

  const removeEnd = removeStart + removeLength;
  const out: Reference[] = [];

  for (const ref of refs) {
    const refStart = ref.reviewStart;
    const refEnd = ref.reviewStart + ref.length;

    if (refEnd <= removeStart || refStart >= removeEnd) {
      out.push({ ...ref });
      continue;
    }

    const leftLen = Math.max(0, removeStart - refStart);
    const rightLen = Math.max(0, refEnd - removeEnd);

    if (leftLen > 0) {
      out.push({
        ...ref,
        length: leftLen,
      });
    }

    if (rightLen > 0) {
      out.push({
        ...ref,
        reviewStart: removeEnd,
        componentStart: ref.componentStart + Math.max(0, removeEnd - refStart),
        length: rightLen,
      });
    }
  }

  return dedupeSuggestionReferences(out);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getEffectiveAttributes(seg: ReviewSegment) {
  return {
    ...(seg.baseAttributes ?? {}),
    ...(seg.suggestionAttributes ?? {}),
  };
}

function cloneInsertSuggestion(
  suggestion: InsertSuggestion,
): InsertSuggestion {
  return {
    groupId: suggestion.groupId,
    actorEmail: suggestion.actorEmail,
    createdAt: suggestion.createdAt,
  };
}

function cloneDeleteSuggestion(
  suggestion: DeleteSuggestion,
): DeleteSuggestion {
  return {
    groupId: suggestion.groupId,
    actorEmail: suggestion.actorEmail,
    createdAt: suggestion.createdAt,
    type: suggestion.type ?? "TEXT",
  };
}

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

function splitSuggestionReferences(
  refs: Reference[] = [],
  splitOffset: number,
): {
  left: Reference[];
  right: Reference[];
} {
  const left: Reference[] = [];
  const right: Reference[] = [];

  for (const ref of refs) {
    const refStart = ref.componentStart;
    const refEnd = ref.componentStart + ref.length;

    if (refEnd <= splitOffset) {
      left.push({ ...ref });
      continue;
    }

    if (refStart >= splitOffset) {
      right.push({
        ...ref,
        componentStart: ref.componentStart - splitOffset,
      });
      continue;
    }

    const leftLen = splitOffset - refStart;
    const rightLen = refEnd - splitOffset;

    if (leftLen > 0) {
      left.push({
        ...ref,
        length: leftLen,
      });
    }

    if (rightLen > 0) {
      right.push({
        ...ref,
        componentStart: 0,
        length: rightLen,
      });
    }
  }

  return { left, right };
}

function splitSegmentAt(
  segments: ReviewSegment[],
  segmentIndex: number,
  offset: number,
  nextId: () => string,
): number {
  const seg = segments[segmentIndex];

  if (!seg || seg.embed) {
    return segmentIndex;
  }

  if (offset <= 0 || offset >= seg.text.length) {
    return segmentIndex;
  }

  const split = splitSuggestionReferences(seg.references ?? [], offset);

  const left: ReviewSegment = {
    id: seg.id,
    text: seg.text.slice(0, offset),
    baseAttributes: { ...(seg.baseAttributes ?? {}) },
    suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
    references: split.left,
    insertSuggestion: seg.insertSuggestion
      ? cloneInsertSuggestion(seg.insertSuggestion)
      : undefined,
    deleteSuggestion: seg.deleteSuggestion
      ? cloneDeleteSuggestion(seg.deleteSuggestion)
      : undefined,
  };

  const right: ReviewSegment = {
    id: nextId(),
    text: seg.text.slice(offset),
    baseAttributes: { ...(seg.baseAttributes ?? {}) },
    suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
    references: split.right,
    insertSuggestion: seg.insertSuggestion
      ? cloneInsertSuggestion(seg.insertSuggestion)
      : undefined,
    deleteSuggestion: seg.deleteSuggestion
      ? cloneDeleteSuggestion(seg.deleteSuggestion)
      : undefined,
  };

  segments.splice(segmentIndex, 1, left, right);

  return segmentIndex + 1;
}

function dedupeSuggestionReferences(
  refs: Reference[],
): Reference[] {
  const seen = new Set<string>();

  return refs.filter((r) => {
    const key = [
      r.opId,
      r.componentIndex,
      r.reviewStart,
      r.componentStart,
      r.length,
    ].join("-");

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function shallowEqual(a: any, b: any) {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(obj: any): any {
  if (Array.isArray(obj)) return obj.map(normalize);

  if (obj && typeof obj === "object") {
    return Object.keys(obj)
      .sort()
      .reduce((acc: any, k) => {
        acc[k] = normalize(obj[k]);
        return acc;
      }, {});
  }

  return obj ?? null;
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

export function restoreRejectedDeleteSegments(
  segments: ReviewSegment[],
  groupId: string,
): ReviewSegment[] {
  return mergeAdjacentSegments(
    segments.map((seg) => {
      if (seg.deleteSuggestion?.groupId !== groupId) return seg;

      return {
        ...cloneSegment(seg),
        text:
          seg.deleteSuggestion.type === "SINGLE_LINE" && seg.text === " ↵ "
            ? "\n"
            : seg.text,
        references: [],
        deleteSuggestion: undefined,
      };
    }),
  );
}

function sameInsertSuggestion(a: ReviewSegment, b: ReviewSegment) {
  if (!!a.insertSuggestion !== !!b.insertSuggestion) return false;
  if (!a.insertSuggestion && !b.insertSuggestion) return true;

  return (
    a.insertSuggestion?.groupId === b.insertSuggestion?.groupId &&
    a.insertSuggestion?.actorEmail === b.insertSuggestion?.actorEmail &&
    a.insertSuggestion?.createdAt === b.insertSuggestion?.createdAt
  );
}

function sameDeleteSuggestion(a: ReviewSegment, b: ReviewSegment) {
  if (!!a.deleteSuggestion !== !!b.deleteSuggestion) return false;
  if (!a.deleteSuggestion && !b.deleteSuggestion) return true;

  return (
    a.deleteSuggestion?.groupId === b.deleteSuggestion?.groupId &&
    a.deleteSuggestion?.actorEmail === b.deleteSuggestion?.actorEmail &&
    a.deleteSuggestion?.createdAt === b.deleteSuggestion?.createdAt &&
    a.deleteSuggestion?.type === b.deleteSuggestion?.type
  );
}

export function collectSuggestionReferencesByGroup(
  segments: ReviewSegment[],
  groupId: string,
  type: "insert" | "delete",
): Reference[] {
  const refs: Reference[] = [];

  for (const seg of segments) {
    const matches =
      type === "insert"
        ? seg.insertSuggestion?.groupId === groupId
        : seg.deleteSuggestion?.groupId === groupId;

    if (!matches) continue;

    refs.push(...cloneSuggestionReferences(seg.references ?? []));
  }

  return dedupeSuggestionReferences(refs);
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function segmentLength(seg: ReviewSegment): number {
  return seg.embed ? 1 : seg.text.length;
}

export function segmentInsertValue(seg: ReviewSegment): any {
  return seg.embed ? cloneJsonValue(seg.embed) : seg.text;
}

export function segmentPreviewText(seg: ReviewSegment): string {
  if (seg.embed) return "[image]";
  return seg.text;
}

function stripRuntimeSuggestionAttrs(
  attrs: Record<string, any>,
): Record<string, any> {
  const {
    "suggestion-format": _f,
    "suggestion-delete": _d,
    "suggestion-delete-newline": _dn,
    "suggestion-delete-singleline": _dsl,
    "suggestion-delete-multiline": _dml,
    "suggestion-insert": _i,
    ...clean
  } = attrs ?? {};

  return clean;
}

function cloneSegment(seg: ReviewSegment): ReviewSegment {
  return {
    id: seg.id,
    text: seg.text ?? "",
    embed: seg.embed ? cloneJsonValue(seg.embed) : undefined,
    baseAttributes: { ...(seg.baseAttributes ?? {}) },
    suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
    references: cloneSuggestionReferences(seg.references ?? []),
    insertSuggestion: seg.insertSuggestion
      ? cloneInsertSuggestion(seg.insertSuggestion)
      : undefined,
    deleteSuggestion: seg.deleteSuggestion
      ? cloneDeleteSuggestion(seg.deleteSuggestion)
      : undefined,
  };
}
