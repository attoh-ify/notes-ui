import Delta from "quill-delta";
import { FormatSuggestionItem, OpReference, OpReferenceResponse, ReviewSegment, TooltipState } from "../types";

// ─── Op-reference utilities ───────────────────────────────────────────────────

export function mergeOpReferences(refs: OpReference[]): OpReferenceResponse[] {
  const mergedMap = new Map<string, Set<number>>();
  for (const ref of refs) {
    if (!mergedMap.has(ref.opId)) {
      mergedMap.set(ref.opId, new Set([ref.componentIndex]));
    } else {
      mergedMap.get(ref.opId)!.add(ref.componentIndex);
    }
  }
  return Array.from(mergedMap.entries()).map(([opId, indexSet]) => ({
    opId,
    componentIndexes: Array.from(indexSet).sort((a, b) => a - b),
  }));
}

// ─── Format suggestion utilities ──────────────────────────────────────────────

export function cloneFormatSuggestions(
  items: FormatSuggestionItem[],
): FormatSuggestionItem[] {
  return items.map((item) => ({
    ...item,
    references: [...item.references],
    spans: item.spans.map((s) => ({ ...s })),
    dependsOnInsertGroupIds: [...item.dependsOnInsertGroupIds],
  }));
}

export function transformSpansAfterRuntimeInsertRemoval(
  spans: { start: number; length: number }[],
  deleteStart: number,
  deleteLength: number,
): { start: number; length: number }[] {
  const deleteEnd = deleteStart + deleteLength;
  const next: { start: number; length: number }[] = [];

  for (const span of spans) {
    const spanStart = span.start;
    const spanEnd   = span.start + span.length;
    if (spanEnd   <= deleteStart) { next.push({ ...span }); continue; }
    if (spanStart >= deleteEnd)   { next.push({ start: spanStart - deleteLength, length: span.length }); continue; }
    const leftLen  = Math.max(0, deleteStart - spanStart);
    const rightLen = Math.max(0, spanEnd - deleteEnd);
    if (leftLen  > 0) next.push({ start: spanStart,   length: leftLen  });
    if (rightLen > 0) next.push({ start: deleteStart, length: rightLen });
  }

  const merged: { start: number; length: number }[] = [];
  for (const span of next) {
    const last = merged[merged.length - 1];
    if (last && last.start + last.length === span.start) { last.length += span.length; }
    else { merged.push({ ...span }); }
  }
  return merged;
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
        "base-attributes":           _b,
        "suggestion-attributes":     _sa,
        ...attrs
      } = op.attributes;
      return { ...op, attributes: Object.keys(attrs).length ? attrs : undefined };
    }),
  );
}

export function buildFormatOverlayDelta(item: FormatSuggestionItem): Delta {
  const delta = new Delta();
  let pos = 0;
  for (const span of item.spans) {
    if (span.start > pos) delta.retain(span.start - pos);
    delta.retain(span.length, {
      "suggestion-format": {
        groupId:    item.groupId,
        actorEmail: item.actorEmail,
        createdAt:  item.createdAt,
        attributes: item.attributes,
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
    seg.attrs["suggestion-insert"] ||
    seg.attrs["suggestion-delete"] ||
    seg.attrs["suggestion-delete-newline"]
  );
}

export function deltaToSegments(
  delta: Delta,
  nextId: () => string,
): ReviewSegment[] {
  return (delta.ops ?? [])
    .filter((op: any) => typeof op.insert === "string")
    .map((op: any) => {
      const rawAttrs: Record<string, any> = { ...(op.attributes ?? {}) };

      const baseAttributes: Record<string, any> = rawAttrs["base-attributes"] ?? {};
      const insertMeta = rawAttrs["suggestion-insert"] ?? null;
      const references: OpReference[] = insertMeta?.references ?? [];

      const { "base-attributes": _ba, "suggestion-attributes": _sa, ...storedAttrs } = rawAttrs;

      return {
        id:             nextId(),
        text:           op.insert as string,
        attrs:          Object.keys(storedAttrs).length > 0 ? storedAttrs : {},
        references,
        baseAttributes,
      };
    });
}

export function mergeAdjacentSegments(segments: ReviewSegment[]): ReviewSegment[] {
  const merged: ReviewSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    const canMerge =
      !!last &&
      JSON.stringify(last.attrs          ?? {}) === JSON.stringify(seg.attrs          ?? {}) &&
      JSON.stringify(last.references     ?? []) === JSON.stringify(seg.references     ?? []) &&
      JSON.stringify(last.baseAttributes ?? {}) === JSON.stringify(seg.baseAttributes ?? {});
    if (canMerge) {
      last.text += seg.text;
    } else {
      merged.push({
        ...seg,
        attrs:          { ...seg.attrs },
        references:     [...seg.references],
        baseAttributes: { ...(seg.baseAttributes ?? {}) },
      });
    }
  }
  return merged;
}

export function segmentsToDelta(segments: ReviewSegment[]): Delta {
  const delta = new Delta();

  for (const seg of segments) {
    const attrs = stripPipelineAttrs(seg.attrs ?? {});

    if (Object.keys(attrs).length > 0) {
      delta.insert(seg.text, attrs);
    } else {
      delta.insert(seg.text);
    }
  }

  return delta;
}

export function cloneSegments(items: ReviewSegment[]): ReviewSegment[] {
  return items.map((s) => ({
    ...s,
    attrs:          { ...s.attrs },
    references:     [...s.references],
    baseAttributes: { ...(s.baseAttributes ?? {}) },
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
    if (seg.attrs["suggestion-insert"]?.groupId === groupId) {
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
    const len        = seg.text.length;
    const deleteAttr = seg.attrs["suggestion-delete"] ?? seg.attrs["suggestion-delete-newline"];
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
      const insertAttr = seg.attrs["suggestion-insert"];
      if (!insertAttr || insertAttr.groupId !== groupId) return seg;

      const realAttrs = stripAllSuggestionAttrs(seg.attrs);

      const restored: Record<string, any> = {
        ...(seg.baseAttributes ?? {}),
        ...realAttrs,
      };

      return {
        ...seg,
        attrs: Object.keys(restored).length > 0 ? restored : {},
        baseAttributes: { ...(seg.baseAttributes ?? {}) },
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
    const insertAttr = seg.attrs["suggestion-insert"];
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

function removeRuntimeCharAt(segments: ReviewSegment[], index: number, nextId: () => string): ReviewSegment[] {
  if (index < 0) return segments;
  let cursor = 0;
  const next = [...segments];
  for (let i = 0; i < next.length; i++) {
    const seg      = next[i];
    const segStart = cursor;
    const segEnd   = cursor + seg.text.length;
    if (index >= segEnd) { cursor = segEnd; continue; }
    const offset = index - segStart;
    if (offset < 0 || offset >= seg.text.length) return segments;
    if (seg.text.length === 1)                      { next.splice(i, 1); }
    else if (offset === 0)                          { next[i] = { ...seg, text: seg.text.slice(1) }; }
    else if (offset === seg.text.length - 1)        { next[i] = { ...seg, text: seg.text.slice(0, -1) }; }
    else {
      next.splice(i, 1,
        { ...seg, text: seg.text.slice(0, offset) },
        { ...seg, id: nextId(), text: seg.text.slice(offset + 1) },
      );
    }
    return mergeAdjacentSegments(next);
  }
  return segments;
}

function insertRuntimeTextAt(
  segments: ReviewSegment[],
  index: number,
  text: string,
  nextId: () => string,
  attrs: Record<string, any> = {},
  baseAttributes: Record<string, any> = {},
): ReviewSegment[] {
  if (!text) return segments;
  const next   = [...segments];
  const newSeg: ReviewSegment = { id: nextId(), text, attrs: { ...attrs }, references: [], baseAttributes: { ...baseAttributes } };
  let cursor = 0;
  for (let i = 0; i < next.length; i++) {
    const seg      = next[i];
    const segStart = cursor;
    const segEnd   = cursor + seg.text.length;
    if (index > segEnd) { cursor = segEnd; continue; }
    if (index === segStart) { next.splice(i, 0, newSeg);     return mergeAdjacentSegments(next); }
    if (index === segEnd)   { next.splice(i + 1, 0, newSeg); return mergeAdjacentSegments(next); }
    if (index > segStart && index < segEnd) {
      const offset = index - segStart;
      next.splice(i, 1,
        { ...seg, attrs: { ...seg.attrs }, references: [...(seg.references ?? [])], baseAttributes: { ...(seg.baseAttributes ?? {}) }, text: seg.text.slice(0, offset) },
        newSeg,
        { ...seg, id: nextId(), attrs: { ...seg.attrs }, references: [...(seg.references ?? [])], baseAttributes: { ...(seg.baseAttributes ?? {}) }, text: seg.text.slice(offset) },
      );
      return mergeAdjacentSegments(next);
    }
  }
  next.push(newSeg);
  return mergeAdjacentSegments(next);
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

function rangeOverlaps(segStart: number, segEnd: number, spanStart: number, spanEnd: number) {
  return segStart < spanEnd && segEnd > spanStart;
}

export function restoreFormatSuggestionToBase(
  segments: ReviewSegment[],
  item: FormatSuggestionItem,
): ReviewSegment[] {
  const fmtAttrs = JSON.parse(item.attributes) as Record<string, any>;
  const fmtKeys  = Object.keys(fmtAttrs);
  let cursor = 0;

  const next = segments.map((seg) => {
    const segStart = cursor;
    const segEnd   = cursor + seg.text.length;
    cursor = segEnd;

    const overlaps = item.spans.some((span) =>
      rangeOverlaps(segStart, segEnd, span.start, span.start + span.length),
    );
    if (!overlaps) return seg;

    const nextAttrs           = { ...(seg.attrs ?? {}) };
    const nextSuggestionAttrs = { ...(nextAttrs["suggestion-attributes"] ?? {}) };

    for (const key of fmtKeys) {
      delete nextSuggestionAttrs[key];
      const baseValue = seg.baseAttributes?.[key];
      if (baseValue === undefined || baseValue === null) {
        delete nextAttrs[key];
      } else {
        nextAttrs[key] = baseValue;
      }
    }

    if (Object.keys(nextSuggestionAttrs).length > 0) {
      nextAttrs["suggestion-attributes"] = nextSuggestionAttrs;
    } else {
      delete nextAttrs["suggestion-attributes"];
    }

    return { ...seg, attrs: nextAttrs };
  });

  return mergeAdjacentSegments(next);
}

function stripPipelineAttrs(attrs: Record<string, any> = {}) {
  const {
    "base-attributes": _ba,
    "suggestion-attributes": _sa,
    ...rest
  } = attrs;

  return rest;
}

function stripAllSuggestionAttrs(attrs: Record<string, any> = {}) {
  const {
    "suggestion-insert": _si,
    "suggestion-delete": _sd,
    "suggestion-delete-newline": _sdn,
    "suggestion-format": _sf,
    "suggestion-attributes": _sa,
    "base-attributes": _ba,
    ...rest
  } = attrs;

  return rest;
}

export function segmentsToPlainDelta(segments: ReviewSegment[]): Delta {
  const delta = new Delta();

  for (const seg of segments) {
    delta.insert(seg.text);
  }

  return delta;
}

export function segmentsToAttributeOverlayDelta(
  segments: ReviewSegment[],
): Delta {
  const delta = new Delta();

  for (const seg of segments) {
    const attrs = stripPipelineAttrs(seg.attrs ?? {});

    const hasSuggestionInsert = !!attrs["suggestion-insert"];
    const hasSuggestionDelete =
      !!attrs["suggestion-delete"] || !!attrs["suggestion-delete-newline"];
    const hasSuggestionFormat = !!attrs["suggestion-format"];

    const clearSuggestionAttrs = {
      "suggestion-insert": hasSuggestionInsert ? attrs["suggestion-insert"] : null,
      "suggestion-delete": hasSuggestionDelete ? attrs["suggestion-delete"] ?? null : null,
      "suggestion-delete-newline": hasSuggestionDelete
        ? attrs["suggestion-delete-newline"] ?? null
        : null,
      "suggestion-format": hasSuggestionFormat ? attrs["suggestion-format"] : null,
    };

    const finalAttrs = {
      ...attrs,
      ...clearSuggestionAttrs,
    };

    delta.retain(
      seg.text.length,
      Object.keys(finalAttrs).length > 0 ? finalAttrs : null,
    );
  }

  return delta;
}