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

export interface OpReferenceResponse {
  opId: string;
  componentIndexes: number[];
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
  suggestionAttributes: Record<string, any>;
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

function findRunPos(runs: ReviewRun[], logicalPos: number): { idx: number; offset: number; absPos: number } {
  let pos = 0;
  let absPos = 0;
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.deleteSuggestion) {
      absPos += r.text.length;
      continue;
    }
    if (pos === logicalPos) return { idx: i, offset: 0, absPos };
    if (pos + r.text.length > logicalPos) return { idx: i, offset: logicalPos - pos, absPos: absPos + (logicalPos - pos) };
    pos += r.text.length;
    absPos += r.text.length;
  }
  return { idx: runs.length, offset: 0, absPos };
}

function splitAt(runs: ReviewRun[], idx: number, offset: number): number {
  if (idx >= runs.length || offset <= 0 || offset >= runs[idx].text.length) return idx;
  const r = runs[idx];
  console.log(`[SPLIT_AT] Splitting run at idx=${idx} offset=${offset} text="${r.text}" into "${r.text.slice(0, offset)}" and "${r.text.slice(offset)}"`);
  runs.splice(idx, 1,
    {
      ...r, text: r.text.slice(0, offset),
      baseAttributes: { ...r.baseAttributes },
      suggestionAttributes: { ...r.suggestionAttributes },
      insertSuggestion: r.insertSuggestion ? { ...r.insertSuggestion } : undefined,
      deleteSuggestion: r.deleteSuggestion ? { ...r.deleteSuggestion } : undefined,
      logicalStart: r.logicalStart,
    },
    {
      ...r, text: r.text.slice(offset),
      baseAttributes: { ...r.baseAttributes },
      suggestionAttributes: { ...r.suggestionAttributes },
      insertSuggestion: r.insertSuggestion ? { ...r.insertSuggestion } : undefined,
      deleteSuggestion: r.deleteSuggestion ? { ...r.deleteSuggestion } : undefined,
      logicalStart: r.logicalStart + offset,
    },
  );
  return idx + 1;
}

// ─── Format span helpers ───────────────────────────────────────────────────────

function findAdjacentSpanIndex(
  spans: FormatSuggestionSpan[],
  spanStart: number,
): number {
  return spans.findIndex(
    (s) => s.start + s.length === spanStart
  );
}

function extendOrAddSpan(
  spans: FormatSuggestionSpan[],
  spanStart: number,
  spanLen: number,
): FormatSuggestionSpan[] {
  const next = spans.map((s) => ({ ...s }));
  const adjacentIdx = findAdjacentSpanIndex(next, spanStart);

  if (adjacentIdx !== -1) {
    next[adjacentIdx].length += spanLen;
  } else {
    next.push({ start: spanStart, length: spanLen });
  }

  return mergeAdjacentSpans(next);
}

function shiftFormatSpansForInsert(
  formatSuggestions: FormatSuggestionItem[],
  insertStart: number,
  insertLength: number,
  skipGroupIds: Set<string> = new Set(),
): void {
  const insertEnd = insertStart + insertLength;

  console.log(`[SHIFT_FORMAT_SPANS] Shifting spans: insertStart=${insertStart} insertLength=${insertLength} insertEnd=${insertEnd} totalFormatGroups=${formatSuggestions.length} skipGroupCount=${skipGroupIds.size}`);

  for (const fmt of formatSuggestions) {
    if (skipGroupIds.has(fmt.groupId)) {
      console.log(`[SHIFT_FORMAT_SPANS] Skipping groupId=${fmt.groupId} (already extended by this insert)`);
      continue;
    }

    const nextSpans: FormatSuggestionSpan[] = [];

    for (const span of fmt.spans) {
      const spanStart = span.start;
      const spanEnd = span.start + span.length;

      if (spanEnd <= insertStart) {
        // Entirely before insertion — unchanged
        console.log(`[SHIFT_FORMAT_SPANS] groupId=${fmt.groupId} span=[${spanStart},${spanEnd}] is BEFORE insertion — unchanged`);
        nextSpans.push({ ...span });
        continue;
      }

      if (spanStart >= insertStart) {
        // Entirely after insertion — shift right
        console.log(`[SHIFT_FORMAT_SPANS] groupId=${fmt.groupId} span=[${spanStart},${spanEnd}] is AFTER insertion — shifting right by ${insertLength} to [${spanStart + insertLength},${spanEnd + insertLength}]`);
        nextSpans.push({ start: spanStart + insertLength, length: span.length });
        continue;
      }

      // Span straddles the insertion point — split into left and right
      const leftLen = insertStart - spanStart;
      const rightLen = spanEnd - insertStart;

      console.log(`[SHIFT_FORMAT_SPANS] groupId=${fmt.groupId} span=[${spanStart},${spanEnd}] STRADDLES insertion at ${insertStart} — splitting into left=[${spanStart},${spanStart + leftLen}] and right=[${insertEnd},${insertEnd + rightLen}]`);

      if (leftLen > 0) {
        nextSpans.push({ start: spanStart, length: leftLen });
      }
      if (rightLen > 0) {
        nextSpans.push({ start: insertEnd, length: rightLen });
      }
    }

    const mergedSpans = mergeAdjacentSpans(nextSpans);
    console.log(`[SHIFT_FORMAT_SPANS] groupId=${fmt.groupId} spansAfterShift count=${mergedSpans.length}`);
    fmt.spans = mergedSpans;
  }
}

function mergeAdjacentSpans(spans: FormatSuggestionSpan[]): FormatSuggestionSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: FormatSuggestionSpan[] = [];

  for (const span of sorted) {
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

  console.log(`[REMOVE_RANGE_FROM_FORMAT] groupId=${item.groupId} removing range=[${start},${end}] from ${item.spans.length} span(s)`);

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
      console.log(`[REMOVE_RANGE_FROM_FORMAT] groupId=${item.groupId} keeping LEFT portion span=[${spanStart},${spanStart + leftLen}]`);
      next.push({ start: spanStart, length: leftLen });
    }

    if (rightLen > 0) {
      console.log(`[REMOVE_RANGE_FROM_FORMAT] groupId=${item.groupId} keeping RIGHT portion span=[${end},${end + rightLen}]`);
      next.push({ start: end, length: rightLen });
    }
  }

  item.spans = mergeAdjacentSpans(next);
  console.log(`[REMOVE_RANGE_FROM_FORMAT] groupId=${item.groupId} remaining span count=${item.spans.length}`);
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
    const effectiveAttrs = getEffectiveAttrs(run);

    const carried = intersectAttrs(effectiveAttrs, attrs);
    if (Object.keys(carried).length === 0) continue;
    indices.push(i);
    start = Math.min(start, run.logicalStart);
    end = Math.max(end, run.logicalStart + run.text.length);
  }

  if (indices.length === 0) {
    console.log(`[COLLECT_INSERT_GROUP_RUNS] groupId=${groupId} — no runs found with the requested attributes`);
    return null;
  }

  console.log(`[COLLECT_INSERT_GROUP_RUNS] groupId=${groupId} foundRunCount=${indices.length} logicalRange=[${start},${end}]`);
  return { indices, start, end };
}

function stripAttrsFromRuns(
  runs: ReviewRun[],
  indices: number[],
  attrs: Record<string, any>,
) {
  const attrKeys = Object.keys(attrs).join(",");

  for (const idx of indices) {
    console.log(
      `[STRIP_ATTRS_FROM_RUNS] runIdx=${idx} text="${runs[idx].text}" stripping keys="${attrKeys}"`
    );

    for (const key of Object.keys(attrs)) {
      if (key in runs[idx].suggestionAttributes) {
        delete runs[idx].suggestionAttributes[key];
      } else if (key in runs[idx].baseAttributes) {
        delete runs[idx].baseAttributes[key];
      }
    }
  }
}

function isOnlyNewlineRetain(
  runs: ReviewRun[],
  logicalStart: number,
  retainLength: number,
): boolean {
  let { idx: runIdx, offset } = findRunPos(runs, logicalStart);
  let remaining = retainLength;
  let sawOverlap = false;

  for (let i = runIdx; i < runs.length && remaining > 0; i++) {
    const run = runs[i];
    if (run.deleteSuggestion) continue;

    sawOverlap = true;
    const lenToCheck = Math.min(run.text.length - offset, remaining);
    for (let j = offset; j < offset + lenToCheck; j++) {
      if (run.text[j] !== "\n") return false;
    }

    remaining -= lenToCheck;
    offset = 0;
  }

  return sawOverlap;
}

function getEffectiveAttrs(run: ReviewRun | null | undefined): Record<string, any> {
  if (!run) return {};
  return {
    ...run.baseAttributes,
    ...(run.suggestionAttributes ?? {}),
  };
}

// ─── Visual delta build ────────────────────────────────────────────────────────

function applyFormatSuggestionAttrsToRuns(
  runs: ReviewRun[],
  formatSuggestions: FormatSuggestionItem[],
): ReviewRun[] {
  console.log(
    `[APPLY_FORMAT_ATTRS_TO_RUNS] Applying ${formatSuggestions.length} format suggestion(s) onto ${runs.length} run(s)`
  );

  const cloned = runs.map((r) => ({
    ...r,
    baseAttributes: { ...r.baseAttributes },
    suggestionAttributes: { ...r.suggestionAttributes },
    insertSuggestion: r.insertSuggestion
      ? {
          ...r.insertSuggestion,
          references: [...r.insertSuggestion.references],
        }
      : undefined,
    deleteSuggestion: r.deleteSuggestion
      ? {
          ...r.deleteSuggestion,
          references: [...r.deleteSuggestion.references],
        }
      : undefined,
  }));

  for (const fmt of formatSuggestions) {
    let fmtAttrs: Record<string, any> = {};
    try {
      fmtAttrs = JSON.parse(fmt.attributes);
    } catch {}

    if (Object.keys(fmtAttrs).length === 0) {
      console.log(
        `[APPLY_FORMAT_ATTRS_TO_RUNS] groupId=${fmt.groupId} — skipping, no parseable attributes`
      );
      continue;
    }

    const attrKeys = Object.keys(fmtAttrs).join(",");
    console.log(
      `[APPLY_FORMAT_ATTRS_TO_RUNS] groupId=${fmt.groupId} attrKeys="${attrKeys}" spanCount=${fmt.spans.length}`
    );

    for (const span of fmt.spans) {
      let left = 0;
      let right = cloned.length - 1;
      let startIdx = cloned.length;

      while (left <= right) {
        const mid = (left + right) >> 1;
        if (cloned[mid].logicalStart + cloned[mid].text.length <= span.start) {
          left = mid + 1;
        } else {
          startIdx = mid;
          right = mid - 1;
        }
      }

      for (let i = startIdx; i < cloned.length; i++) {
        const run = cloned[i];
        if (run.deleteSuggestion) continue;
        if (run.logicalStart >= span.start + span.length) break;
        if (run.logicalStart + run.text.length <= span.start) continue;

        console.log(
          `[APPLY_FORMAT_ATTRS_TO_RUNS] groupId=${fmt.groupId} applying attrs to run text="${run.text}" logicalStart=${run.logicalStart}`
        );

        cloned[i].suggestionAttributes = {
          ...(cloned[i].suggestionAttributes ?? {}),
          ...fmtAttrs,
        };
      }
    }
  }

  return cloned;
}

function buildVisualDelta(runs: ReviewRun[]): Delta {
  console.log(`[BUILD_VISUAL_DELTA] Building visual delta from ${runs.length} run(s)`);

  const delta = new Delta();
  const collapsed: ReviewRun[] = [];

  for (const run of runs) {
    const last = collapsed[collapsed.length - 1];
    const lastEffectiveAttrs = last
      ? {
          ...last.baseAttributes,
          ...(last.suggestionAttributes ?? {}),
        }
      : {};

    const runEffectiveAttrs = {
      ...run.baseAttributes,
      ...(run.suggestionAttributes ?? {}),
    };

    const canMerge =
      !!last &&
      run.text !== "\n" &&
      last.text !== "\n" &&
      attrsEq(lastEffectiveAttrs, runEffectiveAttrs) &&
      last.insertSuggestion?.groupId === run.insertSuggestion?.groupId &&
      last.deleteSuggestion?.groupId === run.deleteSuggestion?.groupId;

    if (canMerge && last) {
      console.log(`[BUILD_VISUAL_DELTA] Merging run text="${run.text}" into previous text="${last.text}" (same group and attrs)`);
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
      console.log(`[BUILD_VISUAL_DELTA] Adding new collapsed run text="${run.text}" insertGroupId="${run.insertSuggestion?.groupId ?? "none"}" deleteGroupId="${run.deleteSuggestion?.groupId ?? "none"}"`);
      collapsed.push({
        ...run,
        baseAttributes: { ...run.baseAttributes },
        suggestionAttributes: { ...(run.suggestionAttributes ?? {}) },
        insertSuggestion: run.insertSuggestion
          ? { ...run.insertSuggestion, references: [...run.insertSuggestion.references] }
          : undefined,
        deleteSuggestion: run.deleteSuggestion
          ? { ...run.deleteSuggestion, references: [...run.deleteSuggestion.references] }
          : undefined,
      });
    }
  }

  console.log(`[BUILD_VISUAL_DELTA] Collapsed ${runs.length} runs into ${collapsed.length} ops`);

  for (const run of collapsed) {
    const attrs: Record<string, any> = {
      ...run.baseAttributes,
      ...(run.suggestionAttributes ?? {}),
    };

    if (run.insertSuggestion) {
      attrs["suggestion-insert"] = {
        groupId: run.insertSuggestion.groupId,
        actorEmail: run.insertSuggestion.actorEmail,
        createdAt: run.insertSuggestion.createdAt,
        references: run.insertSuggestion.references,
      };
    }

    if (run.deleteSuggestion) {
      const deletePayload = {
        groupId: run.deleteSuggestion.groupId,
        actorEmail: run.deleteSuggestion.actorEmail,
        createdAt: run.deleteSuggestion.createdAt,
        references: run.deleteSuggestion.references,
      };

      if (run.text === "\n") {
        attrs["suggestion-delete-newline"] = deletePayload;
      } else {
        attrs["suggestion-delete"] = deletePayload;
      }
    }

    const textToRender =
      run.text === "\n" && run.deleteSuggestion
        ? "↵"
        : run.text;

    if (Object.keys(attrs).length > 0) {
      delta.insert(textToRender, attrs);
    } else {
      delta.insert(textToRender);
    }
  }

  console.log(`[BUILD_VISUAL_DELTA] Done. Final op count=${delta.ops.length}`);
  return delta;
}

function findAdjacentFormatGroupByBoundary(
  formatSuggestions: FormatSuggestionItem[],
  attrStr: string,
  boundaryPos: number,
): FormatSuggestionItem | null {
  return (
    formatSuggestions.find((f) => {
      if (f.attributes !== attrStr) return false;
      return f.spans.some((s) => s.start + s.length === boundaryPos);
    }) ?? null
  );
}

function extendFormatGroupAtBoundary(
  group: FormatSuggestionItem,
  boundaryPos: number,
  insertLength: number,
  opId: string,
  compIdx: number,
  currentInsertGroupId: string,
): void {
  const idx = group.spans.findIndex(
    (s) => s.start + s.length === boundaryPos
  );

  if (idx !== -1) {
    group.spans[idx].length += insertLength;
    group.spans = mergeAdjacentSpans(group.spans.map((s) => ({ ...s })));
  }

  if (!group.references.some((ref) => ref.opId === opId && ref.componentIndex === compIdx)) {
    group.references.push({ opId, componentIndex: compIdx });
  }

  if (!group.dependsOnInsertGroupIds.includes(currentInsertGroupId)) {
    group.dependsOnInsertGroupIds.push(currentInsertGroupId);
  }
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
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[REVIEW_BUILD] START — noteId=${noteId}`);
  console.log(`[REVIEW_BUILD] committedOpCount=${committedOps.length} pendingOpCount=${pendingOps.length}`);

  _groupCtr = 0;

  let committedDelta = new Delta();
  for (const op of committedOps) {
    committedDelta = committedDelta.compose(new Delta(op.delta.ops));
  }

  console.log(`[REVIEW_BUILD] Composed committed delta — opCount=${committedDelta.ops.length}`);

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
            suggestionAttributes: {},
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
            suggestionAttributes: {},
            logicalStart: seedPos,
            opId: "",
            insertComponentIndex: idx,
          });
          seedPos += 1;
        }
      }
    }
  }

  console.log(`[REVIEW_BUILD] Seeded ${runs.length} committed run(s). Total logical length=${seedPos}`);

  const formatSuggestions: FormatSuggestionItem[] = [];
  const pendingFormatCancellations: PendingFormatCancellation[] = [];

  for (const textOp of pendingOps) {
    const { opId, actorEmail, createdAt } = textOp;

    console.log(`\n[REVIEW_BUILD] --- Processing pending op opId=${opId} actor=${actorEmail} componentCount=${textOp.delta.ops.length}`);

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
        const isLastOp = component === textOp.delta.ops[textOp.delta.ops.length - 1];

        console.log(`[RETAIN_PLAIN] opId=${opId} compIdx=${compIdx} retain=${component.retain} localLogPos=${localLogPos} isLastOp=${isLastOp}`);

        if (isLastOp) {
          console.log(`[RETAIN_PLAIN] opId=${opId} compIdx=${compIdx} — last op, breaking early`);
          break;
        }
        currentInsertGroup = null;
        currentDeleteGroup = null;

        const newlineOnly = isOnlyNewlineRetain(runs, localLogPos, component.retain);
        console.log(`[RETAIN_PLAIN] opId=${opId} compIdx=${compIdx} newlineOnly=${newlineOnly} currentFormatGroupId="${currentFormatGroup?.groupId ?? "none"}"`);

        if (newlineOnly && currentFormatGroup) {
          const { absPos } = findRunPos(runs, localLogPos);
          const { absPos: nextAbsPos } = findRunPos(runs, localLogPos + component.retain);
          const absLength = nextAbsPos - absPos;

          console.log(
            `[RETAIN_PLAIN] opId=${opId} compIdx=${compIdx} — newline-only retain bridging format group=${currentFormatGroup.groupId} absPos=${absPos} absLength=${absLength}`
          );

          const beforeSpanCount = currentFormatGroup.spans.length;
          currentFormatGroup.spans = extendOrAddSpan(
            currentFormatGroup.spans,
            absPos,
            absLength,
          );

          console.log(
            `[RETAIN_PLAIN] formatGroup=${currentFormatGroup.groupId} spanCount ${beforeSpanCount} -> ${currentFormatGroup.spans.length} after newline bridge`
          );

          pendingFormatBridge = {
            actorEmail,
            attributes: currentFormatGroup.attributes,
            groupId: currentFormatGroup.groupId,
          };
          console.log(`[RETAIN_PLAIN] Set pendingFormatBridge to groupId=${currentFormatGroup.groupId}`);
        } else {
          if (currentFormatGroup) {
            console.log(`[RETAIN_PLAIN] opId=${opId} compIdx=${compIdx} — non-newline retain breaks format group=${currentFormatGroup.groupId}`);
          }
          currentFormatGroup = null;
          pendingFormatBridge = null;
        }

        localLogPos += component.retain;

      // ── Format retain ──
      } else if (typeof component.retain === "number" && component.attributes) {
        currentInsertGroup = null;
        currentDeleteGroup = null;

        const attrKeys = Object.keys(component.attributes ?? {}).join(",");
        console.log(`\n[RETAIN_FORMAT] opId=${opId} compIdx=${compIdx} retain=${component.retain} localLogPos=${localLogPos} attrKeys="${attrKeys}"`);

        let { idx: runIdx, offset } = findRunPos(runs, localLogPos);

        if (offset > 0 && runIdx < runs.length) {
          console.log(`[RETAIN_FORMAT] opId=${opId} compIdx=${compIdx} — splitting run at runIdx=${runIdx} offset=${offset} before processing`);
          runIdx = splitAt(runs, runIdx, offset);
        }

        let remaining = component.retain;
        let cursor = runIdx;

        while (remaining > 0 && cursor < runs.length) {
          const run = runs[cursor];

          if (run.deleteSuggestion) {
            console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} — skipping deleted run text="${run.text}"`);
            cursor++;
            continue;
          }

          if (run.text === "\n") {
            console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} — newline run, bridging format group if active`);
            cursor++;
            remaining--;

            if (currentFormatGroup) {
              pendingFormatBridge = {
                actorEmail,
                attributes: currentFormatGroup.attributes,
                groupId: currentFormatGroup.groupId,
              };
              console.log(`[RETAIN_FORMAT] Set pendingFormatBridge to groupId=${currentFormatGroup.groupId} after newline`);
            }

            continue;
          }

          if (run.text.length > remaining) {
            console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} run.text.length=${run.text.length} > remaining=${remaining} — splitting`);
            splitAt(runs, cursor, remaining);
          }

          const target = runs[cursor];
          const spanStart = target.logicalStart;
          const spanLen = target.text.length;

          console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} processing run text="${target.text}" logicalStart=${spanStart} length=${spanLen} remaining=${remaining}`);

          const rawIncomingAttrs = {
            ...((component.attributes ?? {}) as Record<string, any>),
          };

          // Check for format cancellation against existing format suggestions
          const coveringFormats = formatSuggestions.filter((f) =>
            f.spans.some(
              (s) => s.start <= spanStart && s.start + s.length >= spanStart + spanLen,
            ),
          );

          console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} coveringFormatCount=${coveringFormats.length}`);

          for (const fmt of coveringFormats) {
            let fmtAttrs: Record<string, any> = {};
            try {
              fmtAttrs = JSON.parse(fmt.attributes) as Record<string, any>;
            } catch {
              fmtAttrs = {};
            }

            const baseAttrs = { ...(target.baseAttributes ?? {}) };
            const cancelledKeys = pickCancelledFormatKeys(
              fmtAttrs,
              rawIncomingAttrs,
              baseAttrs,
            );

            const cancelledKeyNames = Object.keys(cancelledKeys).join(",");
            console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} checking cancellation against formatGroup=${fmt.groupId} cancelledKeys="${cancelledKeyNames}"`);

            if (Object.keys(cancelledKeys).length === 0) {
              console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} — no keys cancelled for formatGroup=${fmt.groupId}`);
              continue;
            }

            console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} — CANCELLATION detected for formatGroup=${fmt.groupId} keys="${cancelledKeyNames}"`);

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
              console.log(`[RETAIN_FORMAT] opId=${opId} — extending existing cancellation record for formatGroup=${fmt.groupId} newLength=${existingCancellation.length}`);
            } else {
              pendingFormatCancellations.push({
                groupId: fmt.groupId,
                references: fmt.references,
                cancellingOpId: opId,
                retainComponentIndex: compIdx,
                consumedBefore: consumedBeforeWithinCancellingRetain,
                length: spanLen,
              });
              console.log(`[RETAIN_FORMAT] opId=${opId} — new cancellation record queued for formatGroup=${fmt.groupId} length=${spanLen} consumedBefore=${consumedBeforeWithinCancellingRetain}`);
            }

            removeRangeFromFormatSuggestion(fmt, spanStart, spanLen);

            if (fmt.spans.length === 0) {
              const idx = formatSuggestions.indexOf(fmt);
              if (idx >= 0) formatSuggestions.splice(idx, 1);
              console.log(`[RETAIN_FORMAT] opId=${opId} — formatGroup=${fmt.groupId} fully cancelled and removed from list`);
            }

            for (const key of Object.keys(cancelledKeys)) {
              if (!target.suggestionAttributes) continue;
              delete target.suggestionAttributes[key];
              delete rawIncomingAttrs[key];
            }
          }

          target.suggestionAttributes = applyDeltaAttrs(
            target.suggestionAttributes ?? {},
            rawIncomingAttrs,
          );

          const suggestionAttrs = stripNullAttrs(rawIncomingAttrs);
          const attrStr = JSON.stringify(suggestionAttrs);
          const suggestionAttrKeys = Object.keys(suggestionAttrs).join(",");

          console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} suggestionAttrKeys="${suggestionAttrKeys}" attrStr="${attrStr}"`);

          if (Object.keys(suggestionAttrs).length > 0) {
            if (!currentFormatGroup) {
              let existing = formatSuggestions.find((f) => {
                if (f.actorEmail !== actorEmail) return false;
                if (f.attributes !== attrStr) return false;
                return findAdjacentSpanIndex(f.spans, spanStart) !== -1;
              });

              if (existing) {
                console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} — found ADJACENT existing format group=${existing.groupId}, continuing it`);
              }

              if (
                !existing &&
                pendingFormatBridge &&
                pendingFormatBridge.actorEmail === actorEmail &&
                pendingFormatBridge.attributes === attrStr
              ) {
                existing = formatSuggestions.find(
                  (f) => f.groupId === pendingFormatBridge!.groupId,
                );
                if (existing) {
                  console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} — BRIDGE reconnected to format group=${existing.groupId} across newline`);
                }
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
                  console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} — CREATED new format group=${g.groupId} attrKeys="${suggestionAttrKeys}"`);
                  return g;
                })();
            }

            // Track insert dependency
            if (target.insertSuggestion?.groupId &&
              !currentFormatGroup.dependsOnInsertGroupIds.includes(target.insertSuggestion.groupId)
            ) {
              currentFormatGroup.dependsOnInsertGroupIds.push(target.insertSuggestion.groupId);
              console.log(`[RETAIN_FORMAT] opId=${opId} — formatGroup=${currentFormatGroup.groupId} now depends on insertGroup=${target.insertSuggestion.groupId}`);
            }

            const alreadyExists = currentFormatGroup.references.some(
              ref => ref.opId === opId && ref.componentIndex === compIdx
            );

            if (!alreadyExists) {
              currentFormatGroup.references.push({ opId, componentIndex: compIdx });
            }

            const adjacentIdx = findAdjacentSpanIndex(currentFormatGroup.spans, spanStart);

            if (adjacentIdx !== -1) {
              currentFormatGroup.spans[adjacentIdx].length += spanLen;
              currentFormatGroup.spans = mergeAdjacentSpans(
                currentFormatGroup.spans.map((s) => ({ ...s }))
              );
              console.log(
                `[RETAIN_FORMAT] opId=${opId} cursor=${cursor} — extended adjacent span index=${adjacentIdx} of formatGroup=${currentFormatGroup.groupId}`
              );
            } else {
              currentFormatGroup.spans.push({ start: spanStart, length: spanLen });
              currentFormatGroup.spans = mergeAdjacentSpans(
                currentFormatGroup.spans.map((s) => ({ ...s }))
              );
              console.log(
                `[RETAIN_FORMAT] opId=${opId} cursor=${cursor} — added new span to formatGroup=${currentFormatGroup.groupId} start=${spanStart} length=${spanLen}`
              );
            }

            pendingFormatBridge = {
              actorEmail,
              attributes: attrStr,
              groupId: currentFormatGroup.groupId,
            };
          } else {
            console.log(`[RETAIN_FORMAT] opId=${opId} cursor=${cursor} — no suggestion attrs after stripping nulls, no format group created/extended`);
          }

          remaining -= spanLen;
          cursor++;
        }

        localLogPos += component.retain;

      // ── Insert ──
      } else if (typeof component.insert === "string") {
        currentDeleteGroup = null;
        currentFormatGroup = null;

        const insertText = component.insert;
        const rawAttrs = { ...(component.attributes ?? {}) };
        const rawAttrKeys = Object.keys(rawAttrs).join(",");

        console.log(`\n[INSERT] opId=${opId} compIdx=${compIdx} text="${insertText}" localLogPos=${localLogPos} attrKeys="${rawAttrKeys}"`);

        const { idx: runIndex, offset, absPos: insertAbsPos } = findRunPos(runs, localLogPos);
        let insertAtIdx = runIndex;
        if (offset > 0 && runIndex < runs.length) {
          console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — splitting run at runIndex=${runIndex} offset=${offset} before inserting`);
          insertAtIdx = splitAt(runs, runIndex, offset);
        }

        const prevRun = insertAtIdx > 0 ? runs[insertAtIdx - 1] : null;
        const nextRun = insertAtIdx < runs.length ? runs[insertAtIdx] : null;

        console.log(`[INSERT] opId=${opId} compIdx=${compIdx} insertAtIdx=${insertAtIdx} insertAbsPos=${insertAbsPos}`);
        console.log(`[INSERT] opId=${opId} compIdx=${compIdx} prevRun text="${prevRun?.text ?? "NONE"}" prevInsertGroupId="${prevRun?.insertSuggestion?.groupId ?? "none"}" prevActor="${prevRun?.insertSuggestion?.actorEmail ?? "none"}"`);
        console.log(`[INSERT] opId=${opId} compIdx=${compIdx} nextRun text="${nextRun?.text ?? "NONE"}" nextInsertGroupId="${nextRun?.insertSuggestion?.groupId ?? "none"}" nextActor="${nextRun?.insertSuggestion?.actorEmail ?? "none"}"`);

        // ── Determine insert group ──
        if (!currentInsertGroup) {
          const prevAdj =
            prevRun?.insertSuggestion?.actorEmail === actorEmail
              ? prevRun.insertSuggestion
              : null;

          const nextAdj =
            nextRun?.insertSuggestion?.actorEmail === actorEmail
              ? nextRun.insertSuggestion
              : null;

          const adj = prevAdj ?? nextAdj;

          if (adj) {
            currentInsertGroup = adj;

            const alreadyExists = currentInsertGroup.references.some(
              (ref) => ref.opId === opId && ref.componentIndex === compIdx,
            );

            if (!alreadyExists) {
              currentInsertGroup.references.push({ opId, componentIndex: compIdx });
            }

            console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — JOINED adjacent insert group=${currentInsertGroup.groupId} (same actor)`);
          } else {
            currentInsertGroup = {
              groupId: nextId(),
              actorEmail,
              createdAt,
              references: [{ opId, componentIndex: compIdx }],
              startIndex: localLogPos,
            };
            console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — CREATED new insert group=${currentInsertGroup.groupId} for actor=${actorEmail}`);
          }
        } else if (createdAt > currentInsertGroup.createdAt) {
          currentInsertGroup.createdAt = createdAt;
          console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — updated insert group=${currentInsertGroup.groupId} createdAt to ${createdAt}`);
        }

        let ownAttrs = { ...rawAttrs };

        // Track which format suggestion groups were extended so we don't double-shift them
        const extendedGroupIds = new Set<string>();

        // ── First: extend any already-existing adjacent format suggestion from another actor ──
        for (const [key, value] of Object.entries({ ...ownAttrs })) {
          const singleAttr = JSON.stringify({ [key]: value });

          const existingAdjGroup = findAdjacentFormatGroupByBoundary(
            formatSuggestions,
            singleAttr,
            localLogPos
          );

          if (!existingAdjGroup) continue;

          extendFormatGroupAtBoundary(
            existingAdjGroup,
            localLogPos,
            insertText.length,
            opId,
            compIdx,
            currentInsertGroup.groupId,
          );

          extendedGroupIds.add(existingAdjGroup.groupId);
          delete ownAttrs[key];

          console.log(
            `[INSERT] opId=${opId} compIdx=${compIdx} — EXTENDED existing adjacent format group=${existingAdjGroup.groupId} for key="${key}" at boundary=${localLogPos}; remaining ownAttrKeys="${Object.keys(ownAttrs).join(",")}"`
          );
        }
        // ── Check prev neighbor for inherited attrs (different actor) ──
        const prevEffectiveAttrs = getEffectiveAttrs(prevRun)

        const nextEffectiveAttrs = getEffectiveAttrs(nextRun);

        if (
          Object.keys(ownAttrs).length > 0 &&
          prevRun?.insertSuggestion &&
          prevRun.insertSuggestion.actorEmail !== actorEmail &&
          Object.keys(prevEffectiveAttrs).length > 0
        ) {
          const inherited = intersectAttrs(ownAttrs, prevEffectiveAttrs);
          console.log(
            `[INSERT] opId=${opId} compIdx=${compIdx} after inheritance remaining ownAttrKeys="${Object.keys(ownAttrs).join(",")}"`
          );
          const inheritedKeys = Object.keys(inherited).join(",");
          console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — checking PREV neighbor for inherited attrs from actor=${prevRun.insertSuggestion.actorEmail} inheritedKeys="${inheritedKeys}"`);

          if (Object.keys(inherited).length > 0) {
            const attrStr = JSON.stringify(inherited);
            const prevGroup = collectInsertGroupRunsWithAttrs(
              runs,
              prevRun.insertSuggestion.groupId,
              inherited,
            );

            if (prevGroup) {
              const spanStart = prevGroup.start;
              const spanEnd = localLogPos + insertText.length;

              // First try to extend an already-existing adjacent format suggestion
              let existingFormatOwnerGroup = formatSuggestions.find((f) => {
                if (f.attributes !== attrStr) return false;
                return f.spans.some((s) => s.start + s.length === localLogPos);
              });

              if (existingFormatOwnerGroup) {
                const targetIdx = existingFormatOwnerGroup.spans.findIndex(
                  (s) => s.start + s.length === localLogPos
                );

                if (targetIdx !== -1) {
                  existingFormatOwnerGroup.spans[targetIdx].length += insertText.length;
                  existingFormatOwnerGroup.spans = mergeAdjacentSpans(
                    existingFormatOwnerGroup.spans.map((s) => ({ ...s }))
                  );
                }

                if (
                  !existingFormatOwnerGroup.references.some(
                    (ref) => ref.opId === opId && ref.componentIndex === compIdx
                  )
                ) {
                  existingFormatOwnerGroup.references.push({ opId, componentIndex: compIdx });
                }

                if (
                  !existingFormatOwnerGroup.dependsOnInsertGroupIds.includes(
                    currentInsertGroup.groupId
                  )
                ) {
                  existingFormatOwnerGroup.dependsOnInsertGroupIds.push(
                    currentInsertGroup.groupId
                  );
                }

                extendedGroupIds.add(existingFormatOwnerGroup.groupId);

                console.log(
                  `[INSERT] opId=${opId} compIdx=${compIdx} — EXTENDED adjacent existing format group=${existingFormatOwnerGroup.groupId} from prev neighbor`
                );
              } else {
                // Fall back only if no existing format group was found
                const ownerEmail = prevRun.insertSuggestion.actorEmail;

                let existing = formatSuggestions.find(
                  (f) =>
                    f.actorEmail === ownerEmail &&
                    f.attributes === attrStr &&
                    f.spans.some((s) => s.start === spanStart)
                );

                if (existing) {
                  const targetIdx = existing.spans.findIndex((s) => s.start === spanStart);
                  if (targetIdx !== -1) {
                    existing.spans[targetIdx].length = Math.max(
                      existing.spans[targetIdx].length,
                      spanEnd - spanStart,
                    );
                    existing.spans = mergeAdjacentSpans(
                      existing.spans.map((s) => ({ ...s }))
                    );
                  }

                  if (
                    !existing.references.some(
                      (ref) => ref.opId === opId && ref.componentIndex === compIdx
                    )
                  ) {
                    existing.references.push({ opId, componentIndex: compIdx });
                  }

                  if (
                    !existing.dependsOnInsertGroupIds.includes(prevRun.insertSuggestion.groupId)
                  ) {
                    existing.dependsOnInsertGroupIds.push(prevRun.insertSuggestion.groupId);
                  }

                  if (
                    !existing.dependsOnInsertGroupIds.includes(currentInsertGroup.groupId)
                  ) {
                    existing.dependsOnInsertGroupIds.push(currentInsertGroup.groupId);
                  }

                  extendedGroupIds.add(existing.groupId);

                  console.log(
                    `[INSERT] opId=${opId} compIdx=${compIdx} — EXTENDED fallback inherited-attr format group=${existing.groupId} from prev neighbor`
                  );
                } else {
                  const g: FormatSuggestionItem = {
                    groupId: nextId(),
                    actorEmail: ownerEmail,
                    createdAt: prevRun.insertSuggestion.createdAt,
                    attributes: attrStr,
                    references: [
                      ...prevRun.insertSuggestion.references,
                      { opId, componentIndex: compIdx },
                    ],
                    spans: [{ start: spanStart, length: spanEnd - spanStart }],
                    previewText: "",
                    dependsOnInsertGroupIds: [
                      prevRun.insertSuggestion.groupId,
                      currentInsertGroup.groupId,
                    ],
                  };

                  formatSuggestions.push(g);
                  extendedGroupIds.add(g.groupId);

                  console.log(
                    `[INSERT] opId=${opId} compIdx=${compIdx} — CREATED fallback inherited-attr format group=${g.groupId} from prev neighbor`
                  );
                }
              }

              stripAttrsFromRuns(runs, prevGroup.indices, inherited);
              ownAttrs = subtractAttrs(ownAttrs, inherited);

              console.log(
                `[INSERT] opId=${opId} compIdx=${compIdx} — stripped inherited attrs from prev runs, remaining ownAttrKeys="${Object.keys(ownAttrs).join(",")}"`
              );
            }
          }
        }

        // ── Check next neighbor for inherited attrs (different actor) ──
        if (
          Object.keys(ownAttrs).length > 0 &&
          nextRun?.insertSuggestion &&
          nextRun.insertSuggestion.actorEmail !== actorEmail &&
          Object.keys(nextEffectiveAttrs).length > 0
        ) {
          const inherited = intersectAttrs(ownAttrs, nextEffectiveAttrs);
          console.log(
            `[INSERT] opId=${opId} compIdx=${compIdx} after inheritance remaining ownAttrKeys="${Object.keys(ownAttrs).join(",")}"`
          );
          const inheritedKeys = Object.keys(inherited).join(",");
          console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — checking NEXT neighbor for inherited attrs from actor=${nextRun.insertSuggestion.actorEmail} inheritedKeys="${inheritedKeys}"`);

          if (Object.keys(inherited).length > 0) {
            const ownerEmail = nextRun.insertSuggestion.actorEmail;
            const attrStr = JSON.stringify(inherited);
            const nextGroup = collectInsertGroupRunsWithAttrs(runs, nextRun.insertSuggestion.groupId, inherited);

            if (nextGroup) {
              const spanStart = localLogPos;
              const spanEnd = nextGroup.end;

              console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — creating/extending inherited-attr format suggestion from nextGroup owner=${ownerEmail} spanStart=${spanStart} spanEnd=${spanEnd}`);

              let existing = formatSuggestions.find(f =>
                f.actorEmail === ownerEmail && f.attributes === attrStr &&
                f.spans.some(s => s.start === spanStart)
              );

              if (existing) {
                const targetSpan = existing.spans.find(s => s.start === spanStart);
                if (targetSpan) {
                  targetSpan.length = Math.max(targetSpan.length, spanEnd - spanStart);
                }
                if (!existing.references.some((ref) => ref.opId === opId && ref.componentIndex === compIdx)) existing.references.push({ opId, componentIndex: compIdx });
                extendedGroupIds.add(existing.groupId);
                console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — EXTENDED existing inherited-attr format group=${existing.groupId} from next neighbor`);
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
                console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — CREATED inherited-attr format group=${g.groupId} from next neighbor attrKeys="${inheritedKeys}"`);
              }

              stripAttrsFromRuns(runs, nextGroup.indices, inherited);
              ownAttrs = subtractAttrs(ownAttrs, inherited);
              const remainingAttrKeys = Object.keys(ownAttrs).join(",");
              console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — stripped inherited attrs from next runs, remaining ownAttrKeys="${remainingAttrKeys}"`);
            }
          }
        }

        // ── Splice new runs ──
        const parts = insertText.split("\n");
        let spliceAt = insertAtIdx;
        let runPos = insertAbsPos;

        console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — splicing ${parts.length} part(s) at insertAtIdx=${insertAtIdx} insertAbsPos=${insertAbsPos} insertGroup=${currentInsertGroup.groupId}`);

        for (let i = 0; i < parts.length; i++) {
          if (parts[i].length > 0) {
            runs.splice(spliceAt++, 0, {
              text: parts[i],
              baseAttributes: { ...ownAttrs },
              suggestionAttributes: {},
              logicalStart: runPos,
              opId,
              insertComponentIndex: compIdx,
              insertSuggestion: { ...currentInsertGroup },
            });
            console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — inserted run text="${parts[i]}" at logicalStart=${runPos} group=${currentInsertGroup.groupId}`);
            runPos += parts[i].length;
          }
          if (i < parts.length - 1) {
            runs.splice(spliceAt++, 0, {
              text: "\n",
              baseAttributes: {},
              suggestionAttributes: {},
              logicalStart: runPos,
              opId,
              insertComponentIndex: compIdx,
              insertSuggestion: { ...currentInsertGroup },
            });
            console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — inserted NEWLINE run at logicalStart=${runPos} group=${currentInsertGroup.groupId}`);
            runPos += 1;
          }
        }

        const shiftLen = insertText.length;
        let shiftedCount = 0;
        for (let i = spliceAt; i < runs.length; i++) {
          runs[i].logicalStart += shiftLen;
          shiftedCount++;
        }
        console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — shifted ${shiftedCount} subsequent run(s) right by ${shiftLen}`);

        // ── Shift format spans ──
        console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — shifting format spans: insertAbsPos=${insertAbsPos} shiftLen=${shiftLen} extendedGroupCount=${extendedGroupIds.size}`);
        shiftFormatSpansForInsert(formatSuggestions, insertAbsPos, insertText.length, extendedGroupIds);

        localLogPos += insertText.length;
        console.log(`[INSERT] opId=${opId} compIdx=${compIdx} — done. new localLogPos=${localLogPos}`);

            // ── Delete ──
      } else if (typeof component.delete === "number") {
        currentInsertGroup = null;
        currentFormatGroup = null;

        console.log(`\n[DELETE] opId=${opId} compIdx=${compIdx} deleteLength=${component.delete} localLogPos=${localLogPos}`);

        let { idx: ri, offset } = findRunPos(runs, localLogPos);
        let cursor = ri;
        if (offset > 0 && ri < runs.length) {
          console.log(`[DELETE] opId=${opId} compIdx=${compIdx} — splitting run at ri=${ri} offset=${offset} before deleting`);
          cursor = splitAt(runs, ri, offset);
        }

        if (!currentDeleteGroup) {
          const prevRun = cursor > 0 ? runs[cursor - 1] : null;
          const nextRun = cursor < runs.length ? runs[cursor] : null;

          const prevAdj =
            prevRun?.deleteSuggestion?.actorEmail === actorEmail
              ? prevRun.deleteSuggestion
              : null;

          const nextAdj =
            nextRun?.deleteSuggestion?.actorEmail === actorEmail
              ? nextRun.deleteSuggestion
              : null;

          const adj = prevAdj ?? nextAdj;

          if (adj) {
            currentDeleteGroup = adj;

            const alreadyExists = currentDeleteGroup.references.some(
              (ref) => ref.opId === opId && ref.componentIndex === compIdx,
            );

            if (!alreadyExists) {
              currentDeleteGroup.references.push({ opId, componentIndex: compIdx });
            }

            console.log(`[DELETE] opId=${opId} compIdx=${compIdx} — JOINED adjacent delete group=${currentDeleteGroup.groupId}`);
          } else {
            currentDeleteGroup = {
              groupId: nextId(),
              actorEmail,
              createdAt,
              references: [{ opId, componentIndex: compIdx }],
            };
            console.log(`[DELETE] opId=${opId} compIdx=${compIdx} — CREATED new delete group=${currentDeleteGroup.groupId} for actor=${actorEmail}`);
          }
        }

        let remaining = component.delete;

        while (remaining > 0 && cursor < runs.length) {
          const run = runs[cursor];

          if (run.deleteSuggestion) {
            console.log(`[DELETE] opId=${opId} cursor=${cursor} — skipping already-deleted run text="${run.text}"`);
            cursor++;
            continue;
          }

          if (run.text === "\n") {
            runs[cursor].deleteSuggestion = { ...currentDeleteGroup };
            console.log(
              `[DELETE] opId=${opId} cursor=${cursor} — marked NEWLINE run as DELETE suggestion group=${currentDeleteGroup.groupId}`
            );
            remaining--;
            localLogPos++;
            cursor++;
            continue;
          }

          if (remaining < run.text.length) {
            console.log(`[DELETE] opId=${opId} cursor=${cursor} — remaining=${remaining} < run.text.length=${run.text.length}, splitting`);
            splitAt(runs, cursor, remaining);
          }

          const target = runs[cursor];
          const len = target.text.length;

          if (target.insertSuggestion) {
            console.log(
              `[DELETE] opId=${opId} cursor=${cursor} — run text="${target.text}" is an INSERT SUGGESTION (insertGroup=${target.insertSuggestion.groupId}), cancelling it via API and removing from runs`
            );

            const shiftLen = target.text.length;
            runs.splice(cursor, 1);
            for (let i = cursor; i < runs.length; i++) {
              runs[i].logicalStart -= shiftLen;
            }

            await apiFetch(`notes/${noteId}/review/split/insert`, {
              method: "POST",
              body: JSON.stringify({
                insertOpId: target.opId,
                deleteOpId: opId,
                insertComponentIndex: target.insertComponentIndex,
                overlapLength: len,
                deleteComponentIndex: compIdx,
              }),
            });

            console.log(
              `[DELETE] opId=${opId} cursor=${cursor} — API call sent for insert cancellation: insertOpId=${target.opId} overlapLength=${len}`
            );

            remaining -= len;
            localLogPos += len;
            continue;
          }

          runs[cursor].deleteSuggestion = { ...currentDeleteGroup };
          console.log(`[DELETE] opId=${opId} cursor=${cursor} — marked run text="${target.text}" as DELETE suggestion group=${currentDeleteGroup.groupId}`);
          remaining -= len;
          localLogPos += len;
          cursor++;
        }

        console.log(`[DELETE] opId=${opId} compIdx=${compIdx} — done. localLogPos=${localLogPos}`);
      }
    }

    console.log(`[REVIEW_BUILD] Finished processing opId=${opId} — total runs=${runs.length} formatSuggestions=${formatSuggestions.length}`);
  }

  // ── Build preview texts ──
  console.log(`\n[REVIEW_BUILD] Building preview texts for ${formatSuggestions.length} format suggestion(s)`);

  for (const fmt of formatSuggestions) {
    if (fmt.previewText) {
      console.log(`[PREVIEW_TEXT] groupId=${fmt.groupId} — already has previewText, skipping`);
      continue;
    }

    const texts: string[] = [];
    const orderedSpans = [...fmt.spans].sort((a, b) => a.start - b.start);
    let prevSpanEnd: number | null = null;

    for (const span of orderedSpans) {
      const spanStart = span.start;
      const spanEnd = span.start + span.length;

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

        texts.push(sawNewlineGap ? " ↵ " : " ... ");
        console.log(`[PREVIEW_TEXT] groupId=${fmt.groupId} — gap between spans, sawNewlineGap=${sawNewlineGap}`);
      }

      for (const run of runs) {
        if (run.deleteSuggestion) continue;
        const runStart = run.logicalStart;
        const runEnd = run.logicalStart + run.text.length;
        const overlapsSpan = runEnd > spanStart && runStart < spanEnd;
        if (!overlapsSpan) continue;
        texts.push(run.text === "\n" ? " ↵ " : run.text);
      }

      prevSpanEnd = spanEnd;
    }

    fmt.previewText = texts.join("").slice(0, 60);
    console.log(`[PREVIEW_TEXT] groupId=${fmt.groupId} previewText="${fmt.previewText}"`);
  }

  // ── Flush pending format cancellation API calls ──
  console.log(`\n[REVIEW_BUILD] Flushing ${pendingFormatCancellations.length} pending format cancellation(s) to backend`);

  for (const c of pendingFormatCancellations) {
    console.log(`[CANCEL_FORMAT_API] groupId=${c.groupId} cancellingOpId=${c.cancellingOpId} retainComponentIndex=${c.retainComponentIndex} length=${c.length} consumedBefore=${c.consumedBefore}`);
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
  const visualDelta = buildVisualDelta(visualRuns);

  console.log(`\n[REVIEW_BUILD] END`);
  console.log(`[REVIEW_BUILD] visualDelta opCount=${visualDelta.ops.length}`);
  console.log(`[REVIEW_BUILD] formatSuggestionCount=${formatSuggestions.length}`);
  for (const fmt of formatSuggestions) {
    const spanSummary = fmt.spans.map(s => `[${s.start},${s.start + s.length}]`).join(" ");
    console.log(`[REVIEW_BUILD] formatGroup=${fmt.groupId} actor=${fmt.actorEmail} attrKeys="${Object.keys(JSON.parse(fmt.attributes)).join(",")}" spanCount=${fmt.spans.length} spans="${spanSummary}" previewText="${fmt.previewText}"`);
  }
  console.log(`${"=".repeat(60)}\n`);
  console.log(JSON.stringify(visualDelta))
  console.log(JSON.stringify(formatSuggestions))

  return { visualDelta, formatSuggestions };
}

// ─── Overlay builders ─────────────────────────────────────────────────────────

export function buildFormatOverlayDelta(item: FormatSuggestionItem): Delta {
  console.log(`[FORMAT_OVERLAY] Building OVERLAY delta for groupId=${item.groupId} spanCount=${item.spans.length}`);
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
  console.log(`[FORMAT_OVERLAY] Building CLEAR delta for groupId=${item.groupId} spanCount=${item.spans.length}`);
  const delta = new Delta();
  let pos = 0;
  for (const span of item.spans) {
    if (span.start > pos) delta.retain(span.start - pos);
    delta.retain(span.length, { "suggestion-format": null });
    pos = span.start + span.length;
  }
  return delta;
}