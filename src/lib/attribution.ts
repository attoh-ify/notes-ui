import Delta from "quill-delta";
import { FormatSuggestionItem, OpReference, OpReferenceResponse, ReviewSegment, TooltipState } from "../types";

// ─── Op-reference utilities ───────────────────────────────────────────────────
// Helpers for collapsing and merging the op-reference lists that accumulate as
// the reviewer accepts suggestions. The backend expects one entry per opId with
// a sorted list of component indexes rather than a flat array of (opId, index)
// pairs.

/**
 * Collapses a flat list of OpReferences into one OpReferenceResponse per opId,
 * deduplicating component indexes and sorting them.
 * Used by saveReviewChanges() before POSTing acceptedReferences to the API.
 */
export function mergeOpReferences(refs: OpReference[]): OpReferenceResponse[] {
  const mergedMap = new Map<string, Set<number>>();

  for (const ref of refs) {
    if (!mergedMap.has(ref.opId)) {
      mergedMap.set(ref.opId, new Set([ref.componentIndex]));
    } else {
      mergedMap.get(ref.opId)!.add(ref.componentIndex);
    }
  }

  const result = Array.from(mergedMap.entries()).map(([opId, indexSet]) => ({
    opId,
    componentIndexes: Array.from(indexSet).sort((a, b) => a - b),
  }));

  console.log(
    `[MERGE_OP_REFS] Merged ${refs.length} raw refs into ${result.length} unique opId(s)`,
  );
  return result;
}

// ─── Format suggestion utilities ─────────────────────────────────────────────
// Pure helpers that work on FormatSuggestionItem arrays or individual items
// without touching Quill or React state.

/**
 * Deep-clones a FormatSuggestionItem array so that snapshots stored in undo
 * history cannot be mutated by subsequent operations.
 */
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

/**
 * Adjusts format-suggestion spans to account for a range of text being removed
 * from the runtime segment list (e.g. after rejecting an insert suggestion).
 *
 * - Spans that end before the deleted range are kept unchanged.
 * - Spans that start after the deleted range are shifted left by deleteLength.
 * - Spans that overlap the deleted range are trimmed; left and right remnants
 *   that survive are kept, and adjacent results are merged.
 *
 * Returns a new span array (does not mutate the input).
 */
export function transformSpansAfterRuntimeInsertRemoval(
  spans: { start: number; length: number }[],
  deleteStart: number,
  deleteLength: number,
): { start: number; length: number }[] {
  const deleteEnd = deleteStart + deleteLength;
  const next: { start: number; length: number }[] = [];

  for (const span of spans) {
    const spanStart = span.start;
    const spanEnd = span.start + span.length;

    if (spanEnd <= deleteStart) {
      // Entirely before the deleted range — unchanged
      next.push({ ...span });
      continue;
    }

    if (spanStart >= deleteEnd) {
      // Entirely after the deleted range — shift left
      next.push({ start: spanStart - deleteLength, length: span.length });
      continue;
    }

    // Overlaps the deleted range — keep only the non-deleted parts
    const leftLen  = Math.max(0, deleteStart - spanStart);
    const rightLen = Math.max(0, spanEnd - deleteEnd);
    if (leftLen  > 0) next.push({ start: spanStart,   length: leftLen });
    if (rightLen > 0) next.push({ start: deleteStart, length: rightLen });
  }

  // Merge any adjacent spans produced by the trimming above
  const merged: { start: number; length: number }[] = [];
  for (const span of next) {
    const last = merged[merged.length - 1];
    if (last && last.start + last.length === span.start) {
      last.length += span.length;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

// ─── Quill delta utilities ────────────────────────────────────────────────────
// Functions that build or transform Quill Delta objects. These are pure — they
// take data in and return a new Delta without side-effects.

/**
 * Removes all suggestion-related attributes from a delta's ops, leaving only
 * the real content attributes (bold, italic, etc.).
 *
 * Used when composing the "rejectedChanges" delta to submit to the backend —
 * the server doesn't understand suggestion attributes and only needs the plain
 * content diff.
 */
export function stripSuggestionAttributes(delta: Delta): Delta {
  return new Delta(
    delta.ops.map((op) => {
      if (!op.attributes) return op;
      const {
        "suggestion-format": _f,
        "suggestion-delete": _d,
        "suggestion-delete-newline": _dn,
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

/**
 * Builds a Quill delta that applies the "suggestion-format" attribute over the
 * spans of a format suggestion. Apply with quill.updateContents() to overlay
 * the highlight on the editor without changing the underlying content.
 */
export function buildFormatOverlayDelta(item: FormatSuggestionItem): Delta {
  console.log(
    `[FORMAT_OVERLAY] Building OVERLAY delta for groupId=${item.groupId} spanCount=${item.spans.length}`,
  );
  const delta = new Delta();
  let pos = 0;
  for (const span of item.spans) {
    if (span.start > pos) delta.retain(span.start - pos);
    delta.retain(span.length, {
      "suggestion-format": {
        groupId: item.groupId,
        actorEmail: item.actorEmail,
        createdAt: item.createdAt,
        attributes: item.attributes,
        references: item.references,
      },
    });
    pos = span.start + span.length;
  }
  return delta;
}

/**
 * Builds a Quill delta that removes the "suggestion-format" attribute from the
 * spans of a format suggestion. Apply with quill.updateContents() to clear the
 * highlight before an accept/reject operation or when the user deselects.
 */
export function buildFormatOverlayClearDelta(item: FormatSuggestionItem): Delta {
  console.log(
    `[FORMAT_OVERLAY] Building CLEAR delta for groupId=${item.groupId} spanCount=${item.spans.length}`,
  );
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
// The runtime segment list is a plain-data mirror of the Quill editor content
// during review. All functions here are pure: they receive segments as a
// parameter and return a new array (or a derived value) without mutating the
// caller's ref. The caller is responsible for writing the result back to
// reviewSegmentsRef.current.

/**
 * Converts a Quill Delta into a ReviewSegment array.
 * Each insert op becomes one segment; the suggestion-insert references are
 * hoisted to the top-level `references` field for easier lookup.
 * Used to initialise reviewSegmentsRef from a freshly built projection.
 *
 * @param nextId  A stable ID generator — pass in the component's
 *                nextRuntimeSegmentId() function.
 */
export function deltaToSegments(
  delta: Delta,
  nextId: () => string,
): ReviewSegment[] {
  const ops = delta.ops ?? [];
  const segments = ops
    .filter((op: any) => typeof op.insert === "string")
    .map((op: any) => ({
      id: nextId(),
      text: op.insert as string,
      attrs: { ...(op.attributes ?? {}) },
      references: [
        ...(op.attributes?.["suggestion-insert"]?.references ?? []),
      ],
    }));

  console.log(
    `[DELTA_TO_SEGMENTS] Converted delta with ${ops.length} ops into ${segments.length} segment(s)`,
  );
  return segments;
}

/**
 * Merges adjacent segments that have identical attrs and references into a
 * single segment. Keeps the segment list compact after operations that may
 * leave many single-character fragments.
 */
export function mergeAdjacentSegments(
  segments: ReviewSegment[],
): ReviewSegment[] {
  const merged: ReviewSegment[] = [];

  for (const seg of segments) {
    const last = merged[merged.length - 1];
    const canMerge =
      !!last &&
      JSON.stringify(last.attrs ?? {}) === JSON.stringify(seg.attrs ?? {}) &&
      JSON.stringify(last.references ?? []) ===
        JSON.stringify(seg.references ?? []);

    if (canMerge) {
      last.text += seg.text;
    } else {
      merged.push({
        ...seg,
        attrs: { ...seg.attrs },
        references: [...seg.references],
      });
    }
  }

  return merged;
}

/**
 * Converts a ReviewSegment array back into a Quill Delta ready for
 * quill.setContents(). The inverse of deltaToSegments.
 */
export function segmentsToDelta(segments: ReviewSegment[]): Delta {
  const delta = new Delta();
  for (const seg of segments) {
    if (Object.keys(seg.attrs).length > 0) {
      delta.insert(seg.text, seg.attrs);
    } else {
      delta.insert(seg.text);
    }
  }
  return delta;
}

/**
 * Deep-clones a ReviewSegment array so snapshots stored in undo history are
 * independent of subsequent mutations.
 */
export function cloneSegments(items: ReviewSegment[]): ReviewSegment[] {
  return items.map((s) => ({
    ...s,
    attrs: { ...s.attrs },
    references: [...s.references],
  }));
}

/**
 * Returns the concatenated plain text of all segments. Used by the line-break
 * normalisation logic to inspect the characters immediately around a deletion
 * boundary.
 */
function getRuntimePlainText(segments: ReviewSegment[]): string {
  return segments.map((s) => s.text).join("");
}

/**
 * Extracts the plain text in the logical range [start, start + length] by
 * walking the segment list. Does not allocate a full string for the entire
 * document — only the requested slice.
 */
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

    const sliceStart = Math.max(start, segStart) - segStart;
    const sliceEnd   = Math.min(end,   segEnd)   - segStart;
    out += seg.text.slice(sliceStart, sliceEnd);

    cursor = segEnd;
  }

  return out;
}

/**
 * Returns the logical index range [index, index + length) occupied by all
 * segments belonging to a specific insert suggestion group, or null if none
 * are found.
 */
export function findInsertGroupRangeInRuntime(
  segments: ReviewSegment[],
  groupId: string,
): { index: number; length: number } | null {
  let cursor = 0;
  let start = -1;
  let end = -1;

  for (const seg of segments) {
    const len = seg.text.length;
    if (seg.attrs["suggestion-insert"]?.groupId === groupId) {
      if (start === -1) start = cursor;
      end = cursor + len;
    }
    cursor += len;
  }

  const result =
    start === -1 || end === -1 ? null : { index: start, length: end - start };
  console.log(
    `[FIND_INSERT_RANGE] groupId=${groupId} — found=${result !== null} index=${result?.index ?? "null"} length=${result?.length ?? "null"}`,
  );
  return result;
}

/**
 * Returns the logical index range occupied by all segments belonging to a
 * specific delete suggestion group (checking both suggestion-delete and
 * suggestion-delete-newline attrs), or null if none are found.
 */
export function findDeleteGroupRangeInRuntime(
  segments: ReviewSegment[],
  groupId: string,
): { index: number; length: number } | null {
  let cursor = 0;
  let start = -1;
  let end = -1;

  for (const seg of segments) {
    const len = seg.text.length;
    const deleteAttr =
      seg.attrs["suggestion-delete"] ?? seg.attrs["suggestion-delete-newline"];
    if (deleteAttr?.groupId === groupId) {
      if (start === -1) start = cursor;
      end = cursor + len;
    }
    cursor += len;
  }

  const result =
    start === -1 || end === -1 ? null : { index: start, length: end - start };
  console.log(
    `[FIND_DELETE_RANGE] groupId=${groupId} — found=${result !== null} index=${result?.index ?? "null"} length=${result?.length ?? "null"}`,
  );
  return result;
}

/**
 * Returns a new segment list with the suggestion-insert attribute stripped from
 * all segments belonging to groupId. The underlying text is kept — this is the
 * "accept insert" path where the text becomes plain committed content.
 * Adjacent segments are merged after the attribute removal.
 */
export function removeInsertSuggestionFromSegments(
  segments: ReviewSegment[],
  groupId: string,
): ReviewSegment[] {
  const before = segments.length;
  const result = mergeAdjacentSegments(  // do I really need to merge adjacent segments after removing the insert suggestion. is there really a benefit to that extra processing
    segments.map((seg) => {
      const insertAttr = seg.attrs["suggestion-insert"];
      if (!insertAttr || insertAttr.groupId !== groupId) return seg;
      const { "suggestion-insert": _removed, ...rest } = seg.attrs;
      return { ...seg, attrs: Object.keys(rest).length > 0 ? rest : {} };
    }),
  );
  console.log(
    `[REMOVE_INSERT_FROM_SEGMENTS] groupId=${groupId} — segmentCount before=${before} after=${result.length}`,
  );
  return result;
}

/**
 * Returns a new segment list with all segments belonging to groupId removed
 * entirely. The text is discarded — this is the "reject insert" path.
 * Adjacent segments are merged after the deletion.
 */
export function deleteInsertGroupSegments(
  segments: ReviewSegment[],
  groupId: string,
): ReviewSegment[] {
  const before = segments.length;
  const result = mergeAdjacentSegments(  // do we really have to do this extra processing of merging??? whats t he advantage in it
    segments.filter((seg) => {
      const insertAttr = seg.attrs["suggestion-insert"];
      return !(insertAttr && insertAttr.groupId === groupId);
    }),
  );
  console.log(
    `[DELETE_INSERT_SEGMENTS] groupId=${groupId} — segmentCount before=${before} after=${result.length}`,
  );
  return result;
}

/**
 * Returns a new segment list with the single character at logical `index`
 * removed. Handles all edge cases: single-char segment (splice it out),
 * first char (slice from 1), last char (slice to -1), and mid-segment (split
 * into left + right then re-merge).
 *
 * Used exclusively by normalizeLineBreaksAfterRejectedInsert to surgically
 * remove a stray newline character without touching the surrounding content.
 *
 * @param nextId  Stable ID generator for any new segments created by a split.
 */
function removeRuntimeCharAt(
  segments: ReviewSegment[],
  index: number,
  nextId: () => string,
): ReviewSegment[] {
  if (index < 0) {
    console.log(`[REMOVE_CHAR_AT] index=${index} is negative — skipping`);
    return segments;
  }

  let cursor = 0;
  const next = [...segments];

  for (let i = 0; i < next.length; i++) {
    const seg     = next[i];
    const segStart = cursor;
    const segEnd   = cursor + seg.text.length;

    if (index >= segEnd) { cursor = segEnd; continue; }

    const offset = index - segStart;
    if (offset < 0 || offset >= seg.text.length) {
      console.log(
        `[REMOVE_CHAR_AT] index=${index} offset=${offset} out of bounds for seg text="${seg.text}" — skipping`,
      );
      return segments;
    }

    const removedChar = seg.text[offset];
    console.log(
      `[REMOVE_CHAR_AT] Removing char="${removedChar === "\n" ? "\\n" : removedChar}" at index=${index} from segment text="${seg.text}"`,
    );

    if (seg.text.length === 1) {
      next.splice(i, 1);
    } else if (offset === 0) {
      next[i] = { ...seg, text: seg.text.slice(1) };
    } else if (offset === seg.text.length - 1) {
      next[i] = { ...seg, text: seg.text.slice(0, -1) };
    } else {
      const left  = { ...seg, text: seg.text.slice(0, offset) };
      const right = { ...seg, id: nextId(), text: seg.text.slice(offset + 1) };
      next.splice(i, 1, left, right);
    }

    const merged = mergeAdjacentSegments(next);
    console.log(`[REMOVE_CHAR_AT] Done — segmentCount now=${merged.length}`);
    return merged;
  }

  console.log(`[REMOVE_CHAR_AT] index=${index} exceeded all segments — nothing removed`);
  return segments;
}

/**
 * Returns a new segment list with `text` inserted at logical `index`.
 * Handles insertion at a segment boundary (start or end) and mid-segment
 * (split the segment, insert in between, then re-merge).
 *
 * Used by normalizeLineBreaksAfterRejectedInsert to restore a paragraph
 * separator newline between two surviving text regions.
 *
 * @param nextId  Stable ID generator for the new segment and any split halves.
 */
function insertRuntimeTextAt(
  segments: ReviewSegment[],
  index: number,
  text: string,
  nextId: () => string,
  attrs: Record<string, any> = {},
): ReviewSegment[] {
  if (!text) {
    console.log(`[INSERT_RUNTIME_TEXT_AT] Empty text — skipping`);
    return segments;
  }

  const displayText = text === "\n" ? "\\n" : text;
  console.log(`[INSERT_RUNTIME_TEXT_AT] Inserting "${displayText}" at index=${index}`);

  const next   = [...segments];
  let cursor   = 0;
  const newSeg = { id: nextId(), text, attrs, references: [] as OpReference[] };

  for (let i = 0; i < next.length; i++) {
    const seg      = next[i];
    const segStart = cursor;
    const segEnd   = cursor + seg.text.length;

    if (index > segEnd) { cursor = segEnd; continue; }

    if (index === segStart) {
      next.splice(i, 0, newSeg);
      const merged = mergeAdjacentSegments(next);
      console.log(`[INSERT_RUNTIME_TEXT_AT] Inserted at segStart — segmentCount=${merged.length}`);
      return merged;
    }

    if (index === segEnd) {
      next.splice(i + 1, 0, newSeg);
      const merged = mergeAdjacentSegments(next);
      console.log(`[INSERT_RUNTIME_TEXT_AT] Inserted at segEnd — segmentCount=${merged.length}`);
      return merged;
    }

    if (index > segStart && index < segEnd) {
      const offset = index - segStart;
      const left   = { ...seg, text: seg.text.slice(0, offset) };
      const right  = { ...seg, id: nextId(), text: seg.text.slice(offset) };
      next.splice(i, 1, left, newSeg, right);
      const merged = mergeAdjacentSegments(next);
      console.log(
        `[INSERT_RUNTIME_TEXT_AT] Inserted inside segment at offset=${offset} — segmentCount=${merged.length}`,
      );
      return merged;
    }
  }

  next.push(newSeg);
  const merged = mergeAdjacentSegments(next);
  console.log(`[INSERT_RUNTIME_TEXT_AT] Appended at end — segmentCount=${merged.length}`);
  return merged;
}

/**
 * After an insert suggestion is rejected and its text removed, this function
 * inspects the characters immediately surrounding the deletion boundary and
 * fixes up any malformed newline state.
 *
 * The four cases handled:
 *   1. Two newlines are now adjacent at the boundary → collapse to one.
 *   2. Document starts with a newline after the deletion → remove it.
 *   3. Document ends with a newline after the deletion → remove it.
 *   4. Two non-empty text regions are now adjacent with no separator, and the
 *      removed text spanned a line break → insert one newline between them.
 *
 * Returns the updated segment list. Pure — does not mutate the input.
 *
 * @param nextId  Stable ID generator forwarded to removeRuntimeCharAt /
 *                insertRuntimeTextAt as needed.
 */
export function normalizeLineBreaksAfterRejectedInsert(
  segments: ReviewSegment[],
  removedRange: { index: number; length: number },
  removedText: string,
  nextId: () => string,
): ReviewSegment[] {
  const boundary    = removedRange.index;
  const currentText = getRuntimePlainText(segments);

  const charBefore = boundary > 0                  ? currentText[boundary - 1] : null;
  const charAfter  = boundary < currentText.length ? currentText[boundary]     : null;

  const removedHadNewline    = removedText.includes("\n");
  const beforeHasVisibleText = boundary > 0;
  const afterHasVisibleText  = boundary < currentText.length;
  const beforeIsText = charBefore !== null && charBefore !== "\n";
  const afterIsText  = charAfter  !== null && charAfter  !== "\n";

  const charBeforeDisplay = charBefore === null ? "null" : charBefore === "\n" ? "\\n" : charBefore;
  const charAfterDisplay  = charAfter  === null ? "null" : charAfter  === "\n" ? "\\n" : charAfter;

  console.log(
    `[NORMALIZE_LINEBREAKS] boundary=${boundary} charBefore="${charBeforeDisplay}" charAfter="${charAfterDisplay}" removedHadNewline=${removedHadNewline} beforeHasVisibleText=${beforeHasVisibleText} afterHasVisibleText=${afterHasVisibleText}`,
  );

  // Case 1: two newlines meet at the boundary → collapse to one
  if (charBefore === "\n" && charAfter === "\n") {
    console.log(`[NORMALIZE_LINEBREAKS] CASE 1 — double newline at boundary — removing one at index=${boundary}`);
    return removeRuntimeCharAt(segments, boundary, nextId);
  }

  // Case 2: deletion left a leading newline at position 0
  if (boundary === 0 && charAfter === "\n") {
    console.log(`[NORMALIZE_LINEBREAKS] CASE 2 — leading newline at position 0 — removing it`);
    return removeRuntimeCharAt(segments, 0, nextId);
  }

  // Case 3: deletion left a trailing newline at the very end
  if (boundary === currentText.length && charBefore === "\n") {
    console.log(`[NORMALIZE_LINEBREAKS] CASE 3 — trailing newline at end — removing at index=${boundary - 1}`);
    return removeRuntimeCharAt(segments, boundary - 1, nextId);
  }

  // Case 4: removed text crossed a line boundary and two text regions now touch
  if (
    removedHadNewline &&
    beforeHasVisibleText &&
    afterHasVisibleText &&
    beforeIsText &&
    afterIsText
  ) {
    console.log(
      `[NORMALIZE_LINEBREAKS] CASE 4 — removed cross-line content, two surviving text regions — inserting separator newline at boundary=${boundary}`,
    );
    return insertRuntimeTextAt(segments, boundary, "\n", nextId);
  }

  console.log(`[NORMALIZE_LINEBREAKS] No normalization case matched — no change made`);
  return segments;
}

// ─── DOM / selector utilities ─────────────────────────────────────────────────
// Helpers that produce CSS selectors for querying suggestion DOM nodes. These
// are pure string functions with no dependencies on Quill or React.

/**
 * Returns a CSS attribute selector that matches all DOM nodes belonging to the
 * given suggestion group and type.
 *
 * Insert and format suggestions each use a unique data-suggestion-type value.
 * Delete suggestions use "delete" for both regular deleted text and the "↵"
 * placeholder rendered for deleted newlines — the blot registration unifies
 * them under the same type string so one selector covers both.
 */
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
  // Both suggestion-delete and suggestion-delete-newline blots render with
  // data-suggestion-type="delete", so one selector covers both.
  return `[data-suggestion-type="delete"][data-group-id="${groupId}"]`;
}