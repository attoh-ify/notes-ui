import Delta from "quill-delta";
import { FormatSuggestionItem, ReviewSegment, TooltipState, SuggestionSlice, FormatSuggestionSpan, DeleteSuggestion, InsertSuggestion } from "../types";

// ─── Format suggestion utilities ──────────────────────────────────────────────

export function cloneFormatSuggestions(
  items: FormatSuggestionItem[],
): FormatSuggestionItem[] {
  return items.map((item) => ({
    groupId: item.groupId,
    actorEmail: item.actorEmail,
    createdAt: item.createdAt,
    attributeKey: item.attributeKey,
    attributeValue: item.attributeValue,
    references: item.references.map((r) => ({
      reviewStart: r.reviewStart,
      componentStart: r.componentStart,
      length: r.length,
      ref: {
        opId: r.ref.opId,
        componentIndex: r.ref.componentIndex
      },
    })),
    spans: item.spans.map((s) => ({ ...s })),
    previewText: item.previewText,
    dependsOnInsertGroupIds: [...item.dependsOnInsertGroupIds],
    dependsOnDeleteGroupIds: [...item.dependsOnDeleteGroupIds],
  }));
}

// ─── Quill delta utilities ────────────────────────────────────────────────────

export function stripSuggestionAttributes(delta: Delta): Delta {
  return new Delta(
    delta.ops.map((op) => {
      if (!op.attributes) return op;
      const {
        "suggestion-format":         _f,
        "suggestion-delete":         _d,
        "suggestion-delete-newline": _dn,
        "suggestion-insert":         _i,
        ...attrs
      } = op.attributes;
      return { ...op, attributes: Object.keys(attrs).length ? attrs : undefined };
    }),
  );
}

export function buildFormatOverlayDelta(item: FormatSuggestionItem): Delta {
  const delta = new Delta();
  let pos = 0;

  const attributes = {
    [item.attributeKey]: item.attributeValue
  };

  const spans = [...item.spans].sort(
    (a, b) => a.start - b.start,
  );

  for (const span of spans) {
    if (span.start > pos) delta.retain(span.start - pos);
    delta.retain(span.length, {
      "suggestion-format": {
        groupId:    item.groupId,
        actorEmail: item.actorEmail,
        createdAt:  item.createdAt,
        attributes,
        references: item.references,
      },
    });
    pos = span.start + span.length;
  }
  return delta;
}

export function buildFormatOverlayClearDelta(item: FormatSuggestionItem): Delta {
  const delta = new Delta();
  let pos = 0;
  for (const span of item.spans) {
    if (span.start > pos) delta.retain(span.start - pos);
    delta.retain(span.length, { "suggestion-format": null });
    pos = span.start + span.length;
  }
  return delta;
}

// ─── Runtime segment utilities ────────────────────────────────────────────────

function hasSuggestionAttr(seg: ReviewSegment): boolean {
  return !!(
    seg.insertSuggestion ||
    seg.deleteSuggestion
  );
}

export function deltaToSegments(
  delta: Delta,
  nextId: () => string,
): ReviewSegment[] {
  return (delta.ops ?? [])
    .filter((op: any) => typeof op.insert === "string")
    .map((op: any) => {
      const allAttrs: Record<string, any> = { ...(op.attributes ?? {}) };
      const pipelineAttrs = { ...allAttrs };

      const insertMeta = pipelineAttrs["suggestion-insert"] ?? null;
      const deleteMeta =
        pipelineAttrs["suggestion-delete"] ??
        pipelineAttrs["suggestion-delete-newline"] ??
        null;

      const baseAttributes: Record<string, any> =
      insertMeta?.baseAttributes ??
      deleteMeta?.baseAttributes ??
      {};

      const suggestionAttributes: Record<string, any> =
        insertMeta?.suggestionAttributes ??
        deleteMeta?.suggestionAttributes ??
        {};

      return {
        id: nextId(),
        text: op.insert as string,
        // attrs: allAttrs,
        baseAttributes,
        suggestionAttributes,
        insertSuggestion: insertMeta
          ? {
              groupId: insertMeta.groupId,
              actorEmail: insertMeta.actorEmail,
              createdAt: insertMeta.createdAt,
              references: insertMeta.references,
            }
          : undefined,
        deleteSuggestion: deleteMeta
          ? {
              groupId: deleteMeta.groupId,
              actorEmail: deleteMeta.actorEmail,
              createdAt: deleteMeta.createdAt,
              references: deleteMeta.references,
            }
          : undefined
      };
    });
}

export function mergeAdjacentSegments(segments: ReviewSegment[]): ReviewSegment[] {
  const merged: ReviewSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    const canMerge =
      !!last &&
      last.text !== "\n" &&
      seg.text !== "\n" &&

      shallowEqual(
        getEffectiveAttributes(last),
        getEffectiveAttributes(seg)
      ) &&

      last.insertSuggestion?.groupId === seg.insertSuggestion?.groupId &&

      last.deleteSuggestion?.groupId === seg.deleteSuggestion?.groupId &&

      shallowEqual(
        last.baseAttributes ?? {},
        seg.baseAttributes ?? {}
      );
    if (canMerge) {
      last.text += seg.text;

      if (
        last.insertSuggestion &&
        seg.insertSuggestion &&
        last.insertSuggestion.groupId === seg.insertSuggestion.groupId
      ) {
        last.insertSuggestion = {
          ...last.insertSuggestion,
          references: dedupeSuggestionSlices([
            ...last.insertSuggestion.references,
            ...seg.insertSuggestion.references,
          ]),
        };
      }

      if (
        last.deleteSuggestion &&
        seg.deleteSuggestion &&
        last.deleteSuggestion.groupId === seg.deleteSuggestion.groupId
      ) {
        last.deleteSuggestion = {
          ...last.deleteSuggestion,
          references: dedupeSuggestionSlices([
            ...last.deleteSuggestion.references,
            ...seg.deleteSuggestion.references,
          ]),
        };
      }
    } else {
      merged.push({
        id: seg.id,
        text: seg.text,
        baseAttributes: { ...(seg.baseAttributes ?? {}) },
        suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
        insertSuggestion: seg.insertSuggestion
          ? {
              ...seg.insertSuggestion,
              references: [...seg.insertSuggestion.references],
            }
          : undefined,
        deleteSuggestion: seg.deleteSuggestion
          ? {
              ...seg.deleteSuggestion,
              references: [...seg.deleteSuggestion.references],
            }
          : undefined,
      });
    }
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

    if (seg.insertSuggestion) {
      attrs["suggestion-insert"] = {
        groupId: seg.insertSuggestion.groupId,
        actorEmail: seg.insertSuggestion.actorEmail,
        createdAt: seg.insertSuggestion.createdAt,
        references: seg.insertSuggestion.references,
        baseAttributes: seg.baseAttributes ?? null,
        suggestionAttributes: seg.suggestionAttributes ?? null,
      };
    }

    if (seg.deleteSuggestion) {
      attrs["suggestion-delete"] = {
        groupId: seg.deleteSuggestion.groupId,
        actorEmail: seg.deleteSuggestion.actorEmail,
        createdAt: seg.deleteSuggestion.createdAt,
        references: seg.deleteSuggestion.references,
        baseAttributes: seg.baseAttributes ?? null,
        suggestionAttributes: seg.suggestionAttributes ?? null,
      };
    }

    const finalAttrs =
      Object.keys(attrs).length > 0 ? attrs : undefined;

    delta.insert(seg.text, finalAttrs);
  }

  return delta;
}

export function cloneSegments(items: ReviewSegment[]): ReviewSegment[] {
  return items.map((s) => ({
    id: s.id,
    text: s.text,
    baseAttributes: { ...(s.baseAttributes ?? {}) },
    suggestionAttributes: { ...(s.suggestionAttributes ?? {}) },
    insertSuggestion: s.insertSuggestion
    ? {
        groupId: s.insertSuggestion.groupId,
        actorEmail: s.insertSuggestion.actorEmail,
        createdAt: s.insertSuggestion.createdAt,
        references: cloneSuggestionSlices(
          s.insertSuggestion.references,
        ),
      }
    : undefined,
    deleteSuggestion: s.deleteSuggestion
    ? {
        groupId: s.deleteSuggestion.groupId,
        actorEmail: s.deleteSuggestion.actorEmail,
        createdAt: s.deleteSuggestion.createdAt,
        references: cloneSuggestionSlices(
          s.deleteSuggestion.references,
        ),
      }
    : undefined
  }));
}

function getRuntimePlainText(segments: ReviewSegment[]): string {
  return segments.map((s) => s.text).join("");
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
    const segStart = cursor;
    const segEnd   = cursor + seg.text.length;
    if (segEnd   <= start) { cursor = segEnd; continue; }
    if (segStart >= end)   break;
    out += seg.text.slice(Math.max(start, segStart) - segStart, Math.min(end, segEnd) - segStart);
    cursor = segEnd;
  }
  return out;
}

export function findInsertGroupRangeInRuntime(
  segments: ReviewSegment[],
  groupId: string,
): { index: number; length: number } | null {
  let cursor = 0, start = -1, end = -1;
  for (const seg of segments) {
    const len = seg.text.length;
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
  let cursor = 0, start = -1, end = -1;
  for (const seg of segments) {
    const len = seg.text.length;
    const deleteAttr = seg.deleteSuggestion;
    if (deleteAttr?.groupId === groupId) {
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
      const insertAttr = seg.insertSuggestion;
      if (!insertAttr || insertAttr.groupId !== groupId) return seg;

      return {
        id: seg.id,
        text: seg.text,
        baseAttributes: seg.baseAttributes,
        suggestionAttributes: seg.suggestionAttributes
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
    const insertAttr = seg.insertSuggestion;
    return !(insertAttr && insertAttr.groupId === groupId);
  });
  
  if (!insertRange) {
    return mergeAdjacentSegments(afterDelete);
  }

  const rangeEnd = insertRange.index + insertRange.length;
  let cursor = 0;
  const cleaned = afterDelete.filter((seg) => {
    const segStart = cursor;
    const segEnd   = cursor + seg.text.length;
    cursor = segEnd;

    const isCommittedNewline =
      seg.text === "\n" &&
      !hasSuggestionAttr(seg);

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

    const start = cursor;
    const end = cursor + seg.text.length;

    if (index >= end) {
      cursor = end;
      continue;
    }

    const offset = index - start;

    splitSegmentAt(segments, i, offset, nextId);

    const rightIndex = splitSegmentAt(
      segments,
      i + 1,
      1,
      nextId,
    );

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

    baseAttributes: {
      ...baseAttributes,
    },

    suggestionAttributes: {
      ...suggestionAttributes,
    },
  };

  let cursor = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    const start = cursor;
    const end = cursor + seg.text.length;

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
  const boundary    = removedRange.index;
  const currentText = getRuntimePlainText(segments);
  const charBefore  = boundary > 0                  ? currentText[boundary - 1] : null;
  const charAfter   = boundary < currentText.length ? currentText[boundary]     : null;

  const removedHadNewline    = removedText.includes("\n");
  const beforeHasVisibleText = boundary > 0;
  const afterHasVisibleText  = boundary < currentText.length;
  const beforeIsText = charBefore !== null && charBefore !== "\n";
  const afterIsText  = charAfter  !== null && charAfter  !== "\n";

  // Case 1: two newlines now meet at the boundary — collapse to one.
  if (charBefore === "\n" && charAfter === "\n")
    return removeRuntimeCharAt(segments, boundary, nextId);

  // Case 2: deletion left a leading newline at the document start.
  if (boundary === 0 && charAfter === "\n")
    return removeRuntimeCharAt(segments, 0, nextId);

  // Case 3: deletion left a trailing newline at the document end.
  if (boundary === currentText.length && charBefore === "\n")
    return removeRuntimeCharAt(segments, boundary - 1, nextId);

  // Case 4: the removed text crossed a paragraph boundary, and two text regions
  // are now adjacent without a separator — restore the paragraph break.
  // Guard: only fire when the removed text had BOTH non-newline content AND a
  // newline, i.e. it was a cross-paragraph insert not a pure-newline insert.
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
  if (type === "insert") return `[data-suggestion-type="insert"][data-group-id="${groupId}"]`;
  if (type === "format") return `[data-suggestion-type="format"][data-group-id="${groupId}"]`;
  return `[data-suggestion-type="delete"][data-group-id="${groupId}"]`;
}

export function restoreFormatSuggestionToBase(
  segments: ReviewSegment[],
  item: FormatSuggestionItem,
): ReviewSegment[] {
  const key = item.attributeKey;

  let cursor = 0;

  const updated = segments.map((seg) => {
    const segStart = cursor;
    const segEnd = cursor + seg.text.length;
    cursor = segEnd;

    const overlaps = item.spans.some(
      (span) =>
        span.start < segEnd &&
        span.start + span.length > segStart
    );

    if (!overlaps) return seg;

    const newSuggestion = { ...(seg.suggestionAttributes ?? {}) };

    delete newSuggestion[key];

    return {
      ...seg,
      baseAttributes: { ...(seg.baseAttributes ?? {}) },
      suggestionAttributes: newSuggestion,
    };
  });

  return mergeAdjacentSegments(updated);
}

// export function segmentsToPlainDelta(segments: ReviewSegment[]): Delta {
//   const delta = new Delta();

//   for (const seg of segments) {
//     delta.insert(seg.text);
//   }

//   return delta;
// }

// export function segmentsToAttributeOverlayDelta(
//   segments: ReviewSegment[],
// ): Delta {
//   const delta = new Delta();

//   for (const seg of segments) {
//     const hasSuggestionInsert = !!seg.insertSuggestion;
//     const hasSuggestionDelete =
//       !!seg.deleteSuggestion;
//     const hasSuggestionFormat = !!attrs["suggestion-format"];

//     const clearSuggestionAttrs = {
//       "suggestion-insert": hasSuggestionInsert ? attrs["suggestion-insert"] : null,
//       "suggestion-delete": hasSuggestionDelete ? attrs["suggestion-delete"] ?? null : null,
//       "suggestion-delete-newline": hasSuggestionDelete
//         ? attrs["suggestion-delete-newline"] ?? null
//         : null,
//       "suggestion-format": hasSuggestionFormat ? attrs["suggestion-format"] : null,
//     };

//     const finalAttrs = {
//       ...attrs,
//       ...clearSuggestionAttrs,
//     };

//     delta.retain(
//       seg.text.length,
//       Object.keys(finalAttrs).length > 0 ? finalAttrs : null,
//     );
//   }

//   return delta;
// }

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

export function resolveFormatSuggestionsAfterMutation(
  items: FormatSuggestionItem[],
  mutation: { index: number; length: number },
  mutationGroupId: string,
  mutationType: "insert" | "delete",
  action: "ACCEPT" | "REJECT",
) {
  const rangeStart = mutation.index;
  const rangeEnd = rangeStart + mutation.length;

  const next: FormatSuggestionItem[] = [];

  for (const item of items) {
    const updatedSpans: FormatSuggestionSpan[] = [];

    const shouldShrink =
      (mutationType === "insert" && action === "REJECT") ||
      (mutationType === "delete" && action === "ACCEPT");

    for (const span of item.spans) {
      const spanStart = span.start;
      const spanEnd = span.start + span.length;

      const overlapStart = Math.max(spanStart, rangeStart);
      const overlapEnd = Math.min(spanEnd, rangeEnd);

      const hasOverlap = overlapStart < overlapEnd;

      // no overlap → keep
      if (!hasOverlap) {
        updatedSpans.push(span);
        continue;
      }

      // INSERT REJECT → shrink overlap
      // DELETE ACCEPT → shrink overlap
      if (shouldShrink) {
        if (spanStart < overlapStart) {
          updatedSpans.push({
            start: spanStart,
            length: overlapStart - spanStart,
          });
        }

        if (overlapEnd < spanEnd) {
          updatedSpans.push({
            start: overlapEnd,
            length: spanEnd - overlapEnd,
          });
        }

        continue;
      }

      // INSERT ACCEPT → DO NOTHING (span unchanged)
      // DELETE REJECT → DO NOTHING (span unchanged)
      updatedSpans.push(span);
    }

    if (updatedSpans.length === 0) continue;

    const filterInsert =
      mutationType === "insert"
        ? item.dependsOnInsertGroupIds.filter((id) => id !== mutationGroupId)
        : item.dependsOnInsertGroupIds;

    const filterDelete =
      mutationType === "delete"
        ? item.dependsOnDeleteGroupIds.filter((id) => id !== mutationGroupId)
        : item.dependsOnDeleteGroupIds;

    next.push({
      ...item,
      spans: updatedSpans,
      dependsOnInsertGroupIds: filterInsert,
      dependsOnDeleteGroupIds: filterDelete,
    });
  }

  return next;
}

function getEffectiveAttributes(seg: ReviewSegment) {
  return {
    ...(seg.baseAttributes ?? {}),
    ...(seg.suggestionAttributes ?? {}),
  };
}

function cloneSuggestionSlices(
  refs: SuggestionSlice[],
): SuggestionSlice[] {
  return refs.map((r) => ({
    reviewStart: r.reviewStart,
    componentStart: r.componentStart,
    length: r.length,
    ref: {
      ...r.ref,
    },
  }));
}

function splitSuggestionSlices(
  refs: SuggestionSlice[],
  offset: number,
): {
  left: SuggestionSlice[];
  right: SuggestionSlice[];
} {
  const left: SuggestionSlice[] = [];
  const right: SuggestionSlice[] = [];

  for (const ref of refs) {
    const refStart = ref.componentStart;
    const refEnd = ref.componentStart + ref.length;

    // fully left
    if (refEnd <= offset) {
      left.push({ ...ref, ref: { ...ref.ref } });
      continue;
    }

    // fully right
    if (refStart >= offset) {
      right.push({
        ...ref,
        componentStart: ref.componentStart - offset,
        ref: { ...ref.ref },
      });
      continue;
    }

    // split
    const leftLen = offset - refStart;
    const rightLen = refEnd - offset;

    if (leftLen > 0) {
      left.push({
        ...ref,
        length: leftLen,
        ref: { ...ref.ref },
      });
    }

    if (rightLen > 0) {
      right.push({
        ...ref,
        componentStart: 0,
        length: rightLen,
        ref: { ...ref.ref },
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

  if (
    offset <= 0 ||
    offset >= seg.text.length
  ) {
    return segmentIndex;
  }

  let leftInsert: InsertSuggestion | undefined;
  let rightInsert: InsertSuggestion | undefined;

  if (seg.insertSuggestion) {
    const split = splitSuggestionSlices(
      seg.insertSuggestion.references,
      offset,
    );

    leftInsert = {
      ...seg.insertSuggestion,
      references: split.left,
    };

    rightInsert = {
      ...seg.insertSuggestion,
      references: split.right,
    };
  }

  let leftDelete: DeleteSuggestion | undefined;
  let rightDelete: DeleteSuggestion | undefined;

  if (seg.deleteSuggestion) {
    const split = splitSuggestionSlices(
      seg.deleteSuggestion.references,
      offset,
    );

    leftDelete = {
      ...seg.deleteSuggestion,
      references: split.left,
    };

    rightDelete = {
      ...seg.deleteSuggestion,
      references: split.right,
    };
  }

  const left: ReviewSegment = {
    id: seg.id,
    text: seg.text.slice(0, offset),

    baseAttributes: {
      ...(seg.baseAttributes ?? {}),
    },

    suggestionAttributes: {
      ...(seg.suggestionAttributes ?? {}),
    },

    insertSuggestion: leftInsert,
    deleteSuggestion: leftDelete,
  };

  const right: ReviewSegment = {
    id: nextId(),
    text: seg.text.slice(offset),

    baseAttributes: {
      ...(seg.baseAttributes ?? {}),
    },

    suggestionAttributes: {
      ...(seg.suggestionAttributes ?? {}),
    },

    insertSuggestion: rightInsert,
    deleteSuggestion: rightDelete,
  };

  segments.splice(segmentIndex, 1, left, right);

  return segmentIndex + 1;
}

function dedupeSuggestionSlices(
  refs: SuggestionSlice[],
): SuggestionSlice[] {
  const seen = new Set<string>();

  return refs.filter((r) => {
    const key =
      `${r.ref.opId}-${r.ref.componentIndex}-${r.componentStart}-${r.length}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}