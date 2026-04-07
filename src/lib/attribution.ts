import Delta from "quill-delta";
import { TextOperation } from "./textOperation";
import { apiFetch } from "./api";

// ─── Public types ──────────────────────────────────────────────────────────────

interface PendingFormatCancellation {
  groupId: string;
  references: OpReference[];
  cancellingOpId: string;
  retainComponentIndex: number;
  consumedBefore: number;
  length: number;
}

export interface OpReference {
  opId: string;
  componentIndex: number;
}

export interface InsertSuggestion {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  references: OpReference[];
  startIndex: number;
}

export interface DeleteSuggestion {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  references: OpReference[];
}

export interface FormatSuggestionSpan {
  start: number;
  length: number;
}

export interface FormatSuggestionItem {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  attributes: string;
  references: OpReference[];
  spans: FormatSuggestionSpan[];
  previewText: string;
  dependsOnInsertGroupIds: string[];
}

export interface ReviewRun {
  text: string;
  baseAttributes: Record<string, any>;
  logicalStart: number;
  opId: string;
  insertComponentIndex: number;
  insertSuggestion?: InsertSuggestion;
  deleteSuggestion?: DeleteSuggestion;
}

export interface ReviewProjection {
  visualDelta: Delta;
  formatSuggestions: FormatSuggestionItem[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

let _groupCtr = 0;
function nextId(): string { return `g_${++_groupCtr}`; }

function attrsEq(a?: Record<string, any>, b?: Record<string, any>): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function intersectAttrs(
  candidate: Record<string, any>,
  reference: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (reference[k] !== undefined && reference[k] === v) out[k] = v;
  }
  return out;
}

function subtractAttrs(
  attrs: Record<string, any>,
  remove: Record<string, any>,
): Record<string, any> {
  const out = { ...attrs };
  for (const k of Object.keys(remove)) delete out[k];
  return out;
}

function mergeUniqueIds(a: OpReference[] = [], b: OpReference[] = []): OpReference[] {
  return [...new Set([...a, ...b])];
}

// ─── Run helpers ───────────────────────────────────────────────────────────────

function recomputePositions(runs: ReviewRun[]): void {
  let pos = 0;
  for (const r of runs) { r.logicalStart = pos; pos += r.text.length; }
}

function findRunPos(runs: ReviewRun[], logicalPos: number): { idx: number; offset: number } {
  let pos = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.deleteSuggestion) continue;
    if (pos === logicalPos) return { idx: i, offset: 0 };
    if (pos + r.text.length > logicalPos) return { idx: i, offset: logicalPos - pos };
    pos += r.text.length;
  }
  return { idx: runs.length, offset: 0 };
}

function splitAt(runs: ReviewRun[], idx: number, offset: number): number {
  if (idx >= runs.length || offset <= 0 || offset >= runs[idx].text.length) return idx;
  const r = runs[idx];
  runs.splice(idx, 1,
    {
      ...r, text: r.text.slice(0, offset),
      baseAttributes: { ...r.baseAttributes },
      insertSuggestion: r.insertSuggestion ? { ...r.insertSuggestion } : undefined,
      deleteSuggestion: r.deleteSuggestion ? { ...r.deleteSuggestion } : undefined,
      logicalStart: r.logicalStart,
    },
    {
      ...r, text: r.text.slice(offset),
      baseAttributes: { ...r.baseAttributes },
      insertSuggestion: r.insertSuggestion ? { ...r.insertSuggestion } : undefined,
      deleteSuggestion: r.deleteSuggestion ? { ...r.deleteSuggestion } : undefined,
      logicalStart: r.logicalStart + offset,
    },
  );
  recomputePositions(runs);
  return idx + 1;
}

// ─── Format span helpers ───────────────────────────────────────────────────────

/**
 * Adjust all format suggestion spans after an insertion at `insertStart` of
 * length `insertLength`. Spans that straddle the insertion point are split into
 * two. This must be called AFTER the new runs are spliced in and positions are
 * recomputed, so that `insertStart` reflects the pre-insertion logical position.
 *
 * skipGroupId: the format suggestion group that already accounts for this
 * insertion (i.e. inherited-attr groups that extended their span to cover the
 * new text) — those should NOT be shifted.
 */
function shiftFormatSpansForInsert(
  formatSuggestions: FormatSuggestionItem[],
  insertStart: number,
  insertLength: number,
  skipGroupIds: Set<string> = new Set(),
): void {
  const insertEnd = insertStart + insertLength;

  for (const fmt of formatSuggestions) {
    if (skipGroupIds.has(fmt.groupId)) continue;

    const nextSpans: FormatSuggestionSpan[] = [];

    for (const span of fmt.spans) {
      const spanStart = span.start;
      const spanEnd = span.start + span.length;

      if (spanEnd <= insertStart) {
        // Entirely before insertion — unchanged
        nextSpans.push({ ...span });
        continue;
      }

      if (spanStart >= insertStart) {
        // Entirely after insertion — shift right
        nextSpans.push({ start: spanStart + insertLength, length: span.length });
        continue;
      }

      // Span straddles the insertion point — split into left and right
      // Left: [spanStart, insertStart)
      const leftLen = insertStart - spanStart;
      // Right: [insertEnd, spanEnd + insertLength) → length = spanEnd - insertStart
      const rightLen = spanEnd - insertStart;

      if (leftLen > 0) {
        nextSpans.push({ start: spanStart, length: leftLen });
      }
      if (rightLen > 0) {
        nextSpans.push({ start: insertEnd, length: rightLen });
      }
    }

    // Merge adjacent contiguous spans
    fmt.spans = mergeAdjacentSpans(nextSpans);
  }
}

function mergeAdjacentSpans(spans: FormatSuggestionSpan[]): FormatSuggestionSpan[] {
  const merged: FormatSuggestionSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && last.start + last.length === span.start) {
      last.length += span.length;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

function applyDeltaAttrs(
  baseAttrs: Record<string, any>,
  deltaAttrs: Record<string, any>,
): Record<string, any> {
  const out = { ...baseAttrs };

  for (const [key, value] of Object.entries(deltaAttrs)) {
    if (value === null) {
      delete out[key];
    } else {
      out[key] = value;
    }
  }

  return out;
}

function pickCancelledFormatKeys(
  formatAttrs: Record<string, any>,
  incomingAttrs: Record<string, any>,
  baseAttrs: Record<string, any>,
): Record<string, any> {
  const cancelled: Record<string, any> = {};

  for (const key of Object.keys(formatAttrs)) {
    if (!(key in incomingAttrs)) continue;

    const before = baseAttrs[key];
    const after = incomingAttrs[key] === null ? undefined : incomingAttrs[key];

    if (after === before) {
      cancelled[key] = incomingAttrs[key];
    }
  }

  return cancelled;
}

function removeRangeFromFormatSuggestion(
  item: FormatSuggestionItem,
  start: number,
  length: number,
) {
  const end = start + length;
  const next: FormatSuggestionSpan[] = [];

  for (const span of item.spans) {
    const spanStart = span.start;
    const spanEnd = span.start + span.length;

    if (spanEnd <= start || spanStart >= end) {
      next.push({ ...span });
      continue;
    }

    const leftLen = Math.max(0, start - spanStart);
    const rightLen = Math.max(0, spanEnd - end);

    if (leftLen > 0) {
      next.push({
        start: spanStart,
        length: leftLen,
      });
    }

    if (rightLen > 0) {
      next.push({
        start: end,
        length: rightLen,
      });
    }
  }

  item.spans = mergeAdjacentSpans(next);
}

// ─── Insert group helper ───────────────────────────────────────────────────────

function collectInsertGroupRunsWithAttrs(
  runs: ReviewRun[],
  groupId: string,
  attrs: Record<string, any>,
): { indices: number[]; start: number; end: number } | null {
  const indices: number[] = [];
  let start = Infinity;
  let end = -Infinity;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run.insertSuggestion || run.insertSuggestion.groupId !== groupId) continue;
    const carried = intersectAttrs(run.baseAttributes, attrs);
    if (Object.keys(carried).length === 0) continue;
    indices.push(i);
    start = Math.min(start, run.logicalStart);
    end = Math.max(end, run.logicalStart + run.text.length);
  }

  return indices.length === 0 ? null : { indices, start, end };
}

function stripAttrsFromRuns(runs: ReviewRun[], indices: number[], attrs: Record<string, any>) {
  for (const idx of indices) {
    runs[idx].baseAttributes = subtractAttrs(runs[idx].baseAttributes, attrs);
  }
}

function isOnlyWhitespaceRetain(
  runs: ReviewRun[],
  logicalStart: number,
  retainLength: number,
): boolean {
  const logicalEnd = logicalStart + retainLength;
  let sawOverlap = false;

  for (const run of runs) {
    if (run.deleteSuggestion) continue;

    const runStart = run.logicalStart;
    const runEnd = run.logicalStart + run.text.length;

    const overlaps = runEnd > logicalStart && runStart < logicalEnd;
    if (!overlaps) continue;

    sawOverlap = true;

    if (!/^\s+$/.test(run.text)) {
      return false;
    }
  }

  return sawOverlap;
}

function isOnlyNewlineRetain(
  runs: ReviewRun[],
  logicalStart: number,
  retainLength: number,
): boolean {
  const logicalEnd = logicalStart + retainLength;
  let sawOverlap = false;

  for (const run of runs) {
    if (run.deleteSuggestion) continue;

    const runStart = run.logicalStart;
    const runEnd = run.logicalStart + run.text.length;

    const overlaps = runEnd > logicalStart && runStart < logicalEnd;
    if (!overlaps) continue;

    sawOverlap = true;

    if (run.text !== "\n") {
      return false;
    }
  }

  return sawOverlap;
}

// ─── Visual delta build ────────────────────────────────────────────────────────

function applyFormatSuggestionAttrsToRuns(
  runs: ReviewRun[],
  formatSuggestions: FormatSuggestionItem[],
): ReviewRun[] {
  const cloned = runs.map(r => ({
    ...r,
    baseAttributes: { ...r.baseAttributes },
    insertSuggestion: r.insertSuggestion ? { ...r.insertSuggestion, references: [...r.insertSuggestion.references] } : undefined,
    deleteSuggestion: r.deleteSuggestion ? { ...r.deleteSuggestion, references: [...r.deleteSuggestion.references] } : undefined,
  }));

  for (const fmt of formatSuggestions) {
    let fmtAttrs: Record<string, any> = {};
    try { fmtAttrs = JSON.parse(fmt.attributes); } catch {}
    if (Object.keys(fmtAttrs).length === 0) continue;

    for (const span of fmt.spans) {
      for (let i = 0; i < cloned.length; i++) {
        const run = cloned[i];
        if (run.deleteSuggestion) continue;
        if (run.logicalStart + run.text.length <= span.start) continue;
        if (run.logicalStart >= span.start + span.length) continue;
        cloned[i].baseAttributes = { ...cloned[i].baseAttributes, ...fmtAttrs };
      }
    }
  }

  return cloned;
}

function buildVisualDelta(runs: ReviewRun[]): Delta {
  const delta = new Delta();
  const collapsed: ReviewRun[] = [];

  for (const run of runs) {
    const last = collapsed[collapsed.length - 1];
    const canMerge =
      !!last &&
      run.text !== "\n" &&
      last.text !== "\n" &&
      attrsEq(last.baseAttributes, run.baseAttributes) &&
      last.insertSuggestion?.groupId === run.insertSuggestion?.groupId &&
      last.deleteSuggestion?.groupId === run.deleteSuggestion?.groupId;

    if (canMerge && last) {
      last.text += run.text;
      if (last.insertSuggestion && run.insertSuggestion) {
        last.insertSuggestion = {
          ...last.insertSuggestion,
          createdAt: run.insertSuggestion.createdAt > last.insertSuggestion.createdAt
            ? run.insertSuggestion.createdAt : last.insertSuggestion.createdAt,
          references: mergeUniqueIds(last.insertSuggestion.references, run.insertSuggestion.references),
        };
      }
      if (last.deleteSuggestion && run.deleteSuggestion) {
        last.deleteSuggestion = {
          ...last.deleteSuggestion,
          createdAt: run.deleteSuggestion.createdAt > last.deleteSuggestion.createdAt
            ? run.deleteSuggestion.createdAt : last.deleteSuggestion.createdAt,
          references: mergeUniqueIds(last.deleteSuggestion.references, run.deleteSuggestion.references),
        };
      }
    } else {
      collapsed.push({
        ...run,
        baseAttributes: { ...run.baseAttributes },
        insertSuggestion: run.insertSuggestion ? { ...run.insertSuggestion, references: [...run.insertSuggestion.references] } : undefined,
        deleteSuggestion: run.deleteSuggestion ? { ...run.deleteSuggestion, references: [...run.deleteSuggestion.references] } : undefined,
      });
    }
  }

  for (const run of collapsed) {
    const attrs: Record<string, any> = { ...run.baseAttributes };
    if (run.insertSuggestion) {
      attrs["suggestion-insert"] = {
        groupId: run.insertSuggestion.groupId,
        actorEmail: run.insertSuggestion.actorEmail,
        createdAt: run.insertSuggestion.createdAt,
        references: run.insertSuggestion.references,
      };
    }
    if (run.deleteSuggestion) {
      attrs["suggestion-delete"] = {
        groupId: run.deleteSuggestion.groupId,
        actorEmail: run.deleteSuggestion.actorEmail,
        createdAt: run.deleteSuggestion.createdAt,
        references: run.deleteSuggestion.references,
      };
    }
    if (Object.keys(attrs).length > 0) {
      delta.insert(run.text, attrs);
    } else {
      delta.insert(run.text);
    }
  }

  return delta;
}

// ─── Main projection builder ───────────────────────────────────────────────────

function stripNullAttrs(attrs: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};

  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null) {
      out[key] = value;
    }
  }

  return out;
}

export async function buildReviewProjection(
  noteId: string,
  committedOps: TextOperation[],
  pendingOps: TextOperation[],
): Promise<ReviewProjection> {
  _groupCtr = 0;

  let committedDelta = new Delta();
  for (const op of committedOps) {
    committedDelta = committedDelta.compose(new Delta(op.delta.ops));
  }

  const runs: ReviewRun[] = [];
  let seedPos = 0;

  for (const [idx, op] of committedDelta.ops.entries()) {
    if (typeof op.insert === "string") {
      const parts = op.insert.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i].length > 0) {
          runs.push({
            text: parts[i],
            baseAttributes: { ...(op.attributes ?? {}) },
            logicalStart: seedPos,
            opId: "",
            insertComponentIndex: idx,
          });
          seedPos += parts[i].length;
        }
        if (i < parts.length - 1) {
          runs.push({
            text: "\n",
            baseAttributes: {},
            logicalStart: seedPos,
            opId: "",
            insertComponentIndex: idx,
          });
          seedPos += 1;
        }
      }
    }
  }

  const formatSuggestions: FormatSuggestionItem[] = [];
  const pendingFormatCancellations: PendingFormatCancellation[] = [];

  for (const textOp of pendingOps) {
    const { opId, actorEmail, createdAt } = textOp;
    let localLogPos = 0;
    let currentInsertGroup: InsertSuggestion | null = null;
    let currentDeleteGroup: DeleteSuggestion | null = null;
    let currentFormatGroup: FormatSuggestionItem | null = null;

    let pendingFormatBridge:
      | { actorEmail: string; attributes: string; groupId: string }
      | null = null;

    for (const [compIdx, component] of textOp.delta.ops.entries()) {

      // ── Plain retain ──
      if (typeof component.retain === "number" && !component.attributes) {
        if (component === textOp.delta.ops[textOp.delta.ops.length - 1]) break;
        currentInsertGroup = null;
        currentDeleteGroup = null;

        const newlineOnly = isOnlyNewlineRetain(runs, localLogPos, component.retain);
        const whitespaceOnly = isOnlyWhitespaceRetain(runs, localLogPos, component.retain);

        if ((newlineOnly || whitespaceOnly) && currentFormatGroup) {
          const last = currentFormatGroup.spans[currentFormatGroup.spans.length - 1];

          if (last && last.start + last.length === localLogPos) {
            last.length += component.retain;
          } else {
            currentFormatGroup.spans.push({
              start: localLogPos,
              length: component.retain,
            });
          }

          pendingFormatBridge = {
            actorEmail,
            attributes: currentFormatGroup.attributes,
            groupId: currentFormatGroup.groupId,
          };
        } else {
          currentFormatGroup = null;
          pendingFormatBridge = null;
        }

        localLogPos += component.retain;

      // ── Format retain ──
      } else if (typeof component.retain === "number" && component.attributes) {
        currentInsertGroup = null;
        currentDeleteGroup = null;

        let { idx: runIdx, offset } = findRunPos(runs, localLogPos);

        if (offset > 0 && runIdx < runs.length) {
            runIdx = splitAt(runs, runIdx, offset);
        }

        let remaining = component.retain;
        let cursor = runIdx;

        while (remaining > 0 && cursor < runs.length) {
            const run = runs[cursor];

            if (run.deleteSuggestion) { 
                cursor++; 
                continue; 
            }

            if (run.text === "\n") {
              cursor++;
              remaining--;

              if (currentFormatGroup) {
                pendingFormatBridge = {
                  actorEmail,
                  attributes: currentFormatGroup.attributes,
                  groupId: currentFormatGroup.groupId,
                };
              }

              continue;
            }
            
            if (run.text.length > remaining) {
                splitAt(runs, cursor, remaining);
            }

            const target = runs[cursor];
            const spanStart = target.logicalStart;
            const spanLen = target.text.length;


            const rawIncomingAttrs = {
                ...((component.attributes ?? {}) as Record<string, any>),
            };

            const coveringFormats = formatSuggestions.filter((f) =>
                f.spans.some(
                    (s) => s.start <= spanStart && s.start + s.length >= spanStart + spanLen,
                ),
            );

            for (const fmt of coveringFormats) {
                let fmtAttrs: Record<string, any> = {};
                try {
                    fmtAttrs = JSON.parse(fmt.attributes) as Record<string, any>;
                } catch {
                    fmtAttrs = {};
                }

                const baseBeforeSuggestion = subtractAttrs(target.baseAttributes, fmtAttrs);
                const cancelledKeys = pickCancelledFormatKeys(
                    fmtAttrs,
                    rawIncomingAttrs,
                    baseBeforeSuggestion,
                );

                if (Object.keys(cancelledKeys).length === 0) continue;

                const consumedBeforeWithinCancellingRetain =
                  component.retain - remaining - spanLen;

                const existingCancellation = pendingFormatCancellations.find(
                  (c) =>
                    c.groupId === fmt.groupId &&
                    c.cancellingOpId === opId &&
                    c.retainComponentIndex === compIdx &&
                    c.consumedBefore + c.length === consumedBeforeWithinCancellingRetain,
                );

                if (existingCancellation) {
                  existingCancellation.length += spanLen;
                } else {
                  pendingFormatCancellations.push({
                    groupId: fmt.groupId,
                    references: fmt.references,
                    cancellingOpId: opId,
                    retainComponentIndex: compIdx,
                    consumedBefore: consumedBeforeWithinCancellingRetain,
                    length: spanLen,
                  });
                }

                removeRangeFromFormatSuggestion(fmt, spanStart, spanLen);

                if (fmt.spans.length === 0) {
                    const idx = formatSuggestions.indexOf(fmt);
                    if (idx >= 0) formatSuggestions.splice(idx, 1);
                }

                // Restore logic
                for (const key of Object.keys(cancelledKeys)) {
                    const prevValue = baseBeforeSuggestion[key];
                    if (prevValue === undefined) {
                        delete target.baseAttributes[key];
                    } else {
                        target.baseAttributes[key] = prevValue;
                    }
                    delete rawIncomingAttrs[key];
                }
            }

            target.baseAttributes = applyDeltaAttrs(target.baseAttributes, rawIncomingAttrs);

            const suggestionAttrs = stripNullAttrs(rawIncomingAttrs);
            const attrStr = JSON.stringify(suggestionAttrs);

            if (Object.keys(suggestionAttrs).length > 0) {
                if (!currentFormatGroup) {
                  let existing = formatSuggestions.find(
                    (f) =>
                      f.actorEmail === actorEmail &&
                      f.attributes === attrStr &&
                      f.spans.length > 0 &&
                      f.spans[f.spans.length - 1].start +
                        f.spans[f.spans.length - 1].length ===
                        spanStart,
                  );

                  if (
                    !existing &&
                    pendingFormatBridge &&
                    pendingFormatBridge.actorEmail === actorEmail &&
                    pendingFormatBridge.attributes === attrStr
                  ) {
                    existing = formatSuggestions.find(
                      (f) => f.groupId === pendingFormatBridge!.groupId,
                    );
                  }

                  currentFormatGroup =
                    existing ??
                    (() => {
                      const g: FormatSuggestionItem = {
                        groupId: nextId(),
                        actorEmail,
                        createdAt,
                        attributes: attrStr,
                        references: [{ opId, componentIndex: compIdx }],
                        spans: [],
                        previewText: "",
                        dependsOnInsertGroupIds: [],
                      };
                      formatSuggestions.push(g);
                      return g;
                    })();
                }

                // Logic for dependencies
                if (target.insertSuggestion?.groupId &&
                    !currentFormatGroup.dependsOnInsertGroupIds.includes(target.insertSuggestion.groupId)
                ) {
                    currentFormatGroup.dependsOnInsertGroupIds.push(target.insertSuggestion.groupId);
                }

                // Reference Check Log
                const alreadyExists = currentFormatGroup.references.some(
                    ref => ref.opId === opId && ref.componentIndex === compIdx
                );

                if (!alreadyExists) {
                    currentFormatGroup.references.push({ opId, componentIndex: compIdx });
                }

                const last = currentFormatGroup.spans[currentFormatGroup.spans.length - 1];
                if (last && last.start + last.length === spanStart) {
                    last.length += spanLen;
                } else {
                    currentFormatGroup.spans.push({ start: spanStart, length: spanLen });
                }

                pendingFormatBridge = {
                  actorEmail,
                  attributes: attrStr,
                  groupId: currentFormatGroup.groupId,
                };
            }

            remaining -= spanLen;
            cursor++;
        }

        localLogPos += component.retain;
    } else if (typeof component.insert === "string") {
        currentDeleteGroup = null;
        currentFormatGroup = null;

        const insertText = component.insert;
        const rawAttrs = { ...(component.attributes ?? {}) };

        const { idx: runIndex, offset } = findRunPos(runs, localLogPos);
        let insertAtIdx = runIndex;
        if (offset > 0 && runIndex < runs.length) {
          insertAtIdx = splitAt(runs, runIndex, offset);
        }

        const prevRun = insertAtIdx > 0 ? runs[insertAtIdx - 1] : null;
        const nextRun = insertAtIdx < runs.length ? runs[insertAtIdx] : null;

        // ── Determine insert group ──
        if (!currentInsertGroup) {
          const adj = prevRun?.insertSuggestion?.actorEmail === actorEmail
            ? prevRun.insertSuggestion : null;
          if (adj) {
            currentInsertGroup = adj;
            if (!currentInsertGroup.references.includes({ opId, componentIndex: compIdx })) currentInsertGroup.references.push({ opId, componentIndex: compIdx });
          } else {
            currentInsertGroup = { groupId: nextId(), actorEmail, createdAt, references: [{ opId, componentIndex: compIdx }], startIndex: localLogPos };
          }
        } else if (createdAt > currentInsertGroup.createdAt) {
          currentInsertGroup.createdAt = createdAt;
        }

        let ownAttrs = { ...rawAttrs };

        // Track which format suggestion groups were extended so we don't double-shift them
        const extendedGroupIds = new Set<string>();

        // ── Check prev neighbor for inherited attrs (different actor) ──
        if (
          prevRun?.insertSuggestion &&
          prevRun.insertSuggestion.actorEmail !== actorEmail &&
          Object.keys(prevRun.baseAttributes).length > 0
        ) {
          const inherited = intersectAttrs(ownAttrs, prevRun.baseAttributes);
          if (Object.keys(inherited).length > 0) {
            const ownerEmail = prevRun.insertSuggestion.actorEmail;
            const attrStr = JSON.stringify(inherited);
            const prevGroup = collectInsertGroupRunsWithAttrs(runs, prevRun.insertSuggestion.groupId, inherited);

            if (prevGroup) {
              const spanStart = prevGroup.start;
              // New span will extend from prevGroup.start to localLogPos + insertText.length
              const spanEnd = localLogPos + insertText.length;

              let existing = formatSuggestions.find(f =>
                f.actorEmail === ownerEmail && f.attributes === attrStr &&
                f.spans.length > 0 && f.spans[f.spans.length - 1].start === spanStart
              );

              if (existing) {
                const last = existing.spans[existing.spans.length - 1];
                last.length = Math.max(last.length, spanEnd - spanStart);

                if (!existing.references.includes({ opId, componentIndex: compIdx })) existing.references.push({ opId, componentIndex: compIdx });
                if (!existing.dependsOnInsertGroupIds.includes(prevRun.insertSuggestion.groupId))
                  existing.dependsOnInsertGroupIds.push(prevRun.insertSuggestion.groupId);
                if (!existing.dependsOnInsertGroupIds.includes(currentInsertGroup.groupId))
                  existing.dependsOnInsertGroupIds.push(currentInsertGroup.groupId);
                extendedGroupIds.add(existing.groupId);
              } else {
                const g: FormatSuggestionItem = {
                  groupId: nextId(),
                  actorEmail: ownerEmail,
                  createdAt: prevRun.insertSuggestion.createdAt,
                  attributes: attrStr,
                  references: [...prevRun.insertSuggestion.references, { opId, componentIndex: compIdx }],
                  spans: [{ start: spanStart, length: spanEnd - spanStart }],
                  previewText: "",
                  dependsOnInsertGroupIds: [prevRun.insertSuggestion.groupId, currentInsertGroup.groupId],
                };
                formatSuggestions.push(g);
                extendedGroupIds.add(g.groupId);
              }

              stripAttrsFromRuns(runs, prevGroup.indices, inherited);
              ownAttrs = subtractAttrs(ownAttrs, inherited);
            }
          }
        }

        // ── Check next neighbor for inherited attrs (different actor, only if prev didn't consume) ──
        if (
          nextRun?.insertSuggestion &&
          nextRun.insertSuggestion.actorEmail !== actorEmail &&
          Object.keys(nextRun.baseAttributes).length > 0
        ) {
          const inherited = intersectAttrs(ownAttrs, nextRun.baseAttributes);
          if (Object.keys(inherited).length > 0) {
            const ownerEmail = nextRun.insertSuggestion.actorEmail;
            const attrStr = JSON.stringify(inherited);
            const nextGroup = collectInsertGroupRunsWithAttrs(runs, nextRun.insertSuggestion.groupId, inherited);

            if (nextGroup) {
              const spanStart = localLogPos;
              const spanEnd = nextGroup.end;

              let existing = formatSuggestions.find(f =>
                f.actorEmail === ownerEmail && f.attributes === attrStr &&
                f.spans.some(s => s.start === spanStart)
              );

              if (existing) {
                const targetSpan = existing.spans.find(s => s.start === spanStart);
                if (targetSpan) {
                  targetSpan.length = Math.max(targetSpan.length, spanEnd - spanStart);
                }
                if (!existing.references.includes({ opId, componentIndex: compIdx })) existing.references.push({ opId, componentIndex: compIdx });
                extendedGroupIds.add(existing.groupId);
              } else {
                const g: FormatSuggestionItem = {
                  groupId: nextId(),
                  actorEmail: ownerEmail,
                  createdAt: nextRun.insertSuggestion.createdAt,
                  attributes: attrStr,
                  references: [...nextRun.insertSuggestion.references, { opId, componentIndex: compIdx }],
                  spans: [{ start: spanStart, length: spanEnd - spanStart }],
                  previewText: "",
                  dependsOnInsertGroupIds: [nextRun.insertSuggestion.groupId, currentInsertGroup.groupId],
                };
                formatSuggestions.push(g);
                extendedGroupIds.add(g.groupId);
              }

              stripAttrsFromRuns(runs, nextGroup.indices, inherited);
              ownAttrs = subtractAttrs(ownAttrs, inherited);
            }
          }
        }

        // ── Check adjacent format suggestion group from different actor ──
        const adjFmt = formatSuggestions.find(f => {
          if (f.actorEmail === actorEmail) return false;
          if (extendedGroupIds.has(f.groupId)) return false;
          const fmtAttrs = JSON.parse(f.attributes) as Record<string, any>;
          const inherited = intersectAttrs(ownAttrs, fmtAttrs);
          return Object.keys(inherited).length > 0 && f.spans.some(s => s.start + s.length === localLogPos);
        });

        if (adjFmt) {
          const fmtAttrs = JSON.parse(adjFmt.attributes) as Record<string, any>;
          const inherited = intersectAttrs(ownAttrs, fmtAttrs);
          if (Object.keys(inherited).length > 0) {
            ownAttrs = subtractAttrs(ownAttrs, inherited);
            const span = adjFmt.spans.find(s => s.start + s.length === localLogPos)!;
            span.length += insertText.length;
            extendedGroupIds.add(adjFmt.groupId);
          }
        }

        // ── Splice new runs ──
        const parts = insertText.split("\n");
        let spliceAt = insertAtIdx;
        let runPos = localLogPos;

        for (let i = 0; i < parts.length; i++) {
          if (parts[i].length > 0) {
            runs.splice(spliceAt++, 0, {
              text: parts[i],
              baseAttributes: { ...ownAttrs },
              logicalStart: runPos,
              opId,
              insertComponentIndex: compIdx,
              insertSuggestion: { ...currentInsertGroup },
            });
            runPos += parts[i].length;
          }
          if (i < parts.length - 1) {
            runs.splice(spliceAt++, 0, {
              text: "\n",
              baseAttributes: {},
              logicalStart: runPos,
              opId,
              insertComponentIndex: compIdx,
              insertSuggestion: { ...currentInsertGroup },
            });
            runPos += 1;
          }
        }

        recomputePositions(runs);

        // ── ALWAYS shift format spans for this insertion, skipping groups already extended ──
        shiftFormatSpansForInsert(formatSuggestions, localLogPos, insertText.length, extendedGroupIds);

        localLogPos += insertText.length;

      // ── Delete ──
      } else if (typeof component.delete === "number") {
        currentInsertGroup = null;
        currentFormatGroup = null;

        let { idx: ri, offset } = findRunPos(runs, localLogPos);
        let cursor = ri;
        if (offset > 0 && ri < runs.length) {
          cursor = splitAt(runs, ri, offset);
        }

        if (!currentDeleteGroup) {
          const prevRun = cursor > 0 ? runs[cursor - 1] : null;
          if (prevRun?.deleteSuggestion?.actorEmail === actorEmail) {
            currentDeleteGroup = prevRun.deleteSuggestion;
            if (!currentDeleteGroup.references.includes({opId, componentIndex: compIdx})) currentDeleteGroup.references.push({opId, componentIndex: compIdx});
          } else {
            currentDeleteGroup = { groupId: nextId(), actorEmail, createdAt, references: [{opId, componentIndex: compIdx}] };
          }
        }

        let remaining = component.delete;
        let newLineCount = 0;

        while (remaining > 0 && cursor < runs.length) {
          const run = runs[cursor];
          if (run.deleteSuggestion) { cursor++; continue; }

          if (run.text === "\n") {
            remaining--;
            cursor++;
            newLineCount++;
            localLogPos++;
            continue;
          }

          if (remaining < run.text.length) splitAt(runs, cursor, remaining);

          const target = runs[cursor];
          const len = target.text.length;

          if (target.insertSuggestion) {
            runs.splice(cursor, 1);
            recomputePositions(runs);

            await apiFetch(`notes/${noteId}/review/split/insert`, {
              method: "POST",
              body: JSON.stringify({
                insertOpId: target.opId,
                deleteOpId: opId,
                insertComponentIndex: target.insertComponentIndex,
                overlapLength: len + newLineCount,
                deleteComponentIndex: compIdx,
              }),
            });

            remaining -= len;
            localLogPos += len;
            newLineCount = 0;
            continue;
          }

          runs[cursor].deleteSuggestion = { ...currentDeleteGroup };
          remaining -= len;
          localLogPos += len;
          cursor++;
        }
      }
    }
  }

  for (const fmt of formatSuggestions) {
    if (fmt.previewText) continue;

    const texts: string[] = [];
    const orderedSpans = [...fmt.spans].sort((a, b) => a.start - b.start);

    let prevSpanEnd: number | null = null;

    for (const span of orderedSpans) {
      const spanStart = span.start;
      const spanEnd = span.start + span.length;

      // If there is a gap between this span and the previous one,
      // check whether that gap contains newline runs.
      if (prevSpanEnd !== null && spanStart > prevSpanEnd) {
        let sawNewlineGap = false;

        for (const run of runs) {
          if (run.deleteSuggestion) continue;

          const runStart = run.logicalStart;
          const runEnd = run.logicalStart + run.text.length;

          const overlapsGap = runEnd > prevSpanEnd && runStart < spanStart;
          if (!overlapsGap) continue;

          if (run.text === "\n") {
            sawNewlineGap = true;
            break;
          }
        }

        if (sawNewlineGap) {
          texts.push(" ↵ ");
        }
      }

      for (const run of runs) {
        if (run.deleteSuggestion) continue;

        const runStart = run.logicalStart;
        const runEnd = run.logicalStart + run.text.length;
        const overlapsSpan = runEnd > spanStart && runStart < spanEnd;

        if (!overlapsSpan) continue;

        if (run.text !== "\n") {
          texts.push(run.text);
        }
      }

      prevSpanEnd = spanEnd;
    }

    fmt.previewText = texts.join("").slice(0, 60);
  }

  for (const c of pendingFormatCancellations) {
    await apiFetch(`notes/${noteId}/review/split/format`, {
      method: "POST",
      body: JSON.stringify({
        targetReferences: c.references,
        cancellingOpId: c.cancellingOpId,
        retainComponentIndex: c.retainComponentIndex,
        opLength: c.length,
        consumedBefore: c.consumedBefore,
      }),
    });
  }

  const visualRuns = applyFormatSuggestionAttrsToRuns(runs, formatSuggestions);
  return { visualDelta: buildVisualDelta(visualRuns), formatSuggestions };
}

// ─── Overlay builders ─────────────────────────────────────────────────────────

export function buildFormatOverlayDelta(item: FormatSuggestionItem): Delta {
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