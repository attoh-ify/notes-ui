import Delta from "quill-delta";
import { TextOperation } from "./textOperation";
import { apiFetch } from "./api";

export interface InsertSuggestion {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  opIds: string[];
  startIndex: number;
}

export interface DeleteSuggestion {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  opIds: string[];
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
  opIds: string[];
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

let _groupCtr = 0;

function nextId(): string {
  return `g_${++_groupCtr}`;
}

function attrsEq(
  a: Record<string, any> | undefined,
  b: Record<string, any> | undefined,
): boolean {
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

function recomputePositions(runs: ReviewRun[]): void {
  let pos = 0;
  for (const r of runs) {
    r.logicalStart = pos;
    pos += r.text.length;
  }
}

function findRunPos(
  runs: ReviewRun[],
  logicalPos: number,
): { idx: number; offset: number } {
  let pos = 0;

  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.deleteSuggestion) continue;

    if (pos === logicalPos) return { idx: i, offset: 0 };
    if (pos + r.text.length > logicalPos) {
      return { idx: i, offset: logicalPos - pos };
    }

    pos += r.text.length;
  }

  return { idx: runs.length, offset: 0 };
}

function splitAt(runs: ReviewRun[], idx: number, offset: number): number {
  if (idx >= runs.length || offset <= 0 || offset >= runs[idx].text.length) {
    return idx;
  }

  const r = runs[idx];
  runs.splice(
    idx,
    1,
    {
      ...r,
      text: r.text.slice(0, offset),
      baseAttributes: { ...r.baseAttributes },
      insertSuggestion: r.insertSuggestion ? { ...r.insertSuggestion } : undefined,
      deleteSuggestion: r.deleteSuggestion ? { ...r.deleteSuggestion } : undefined,
      logicalStart: r.logicalStart,
    },
    {
      ...r,
      text: r.text.slice(offset),
      baseAttributes: { ...r.baseAttributes },
      insertSuggestion: r.insertSuggestion ? { ...r.insertSuggestion } : undefined,
      deleteSuggestion: r.deleteSuggestion ? { ...r.deleteSuggestion } : undefined,
      logicalStart: r.logicalStart + offset,
    },
  );

  recomputePositions(runs);
  return idx + 1;
}

function mergeUniqueIds(a: string[] = [], b: string[] = []): string[] {
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}

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
    if (!run.insertSuggestion) continue;
    if (run.insertSuggestion.groupId !== groupId) continue;

    const carried = intersectAttrs(run.baseAttributes, attrs);
    if (Object.keys(carried).length === 0) continue;

    indices.push(i);
    if (run.logicalStart < start) start = run.logicalStart;
    const runEnd = run.logicalStart + run.text.length;
    if (runEnd > end) end = runEnd;
  }

  if (indices.length === 0) return null;
  return { indices, start, end };
}

function stripAttrsFromRuns(
  runs: ReviewRun[],
  indices: number[],
  attrs: Record<string, any>,
) {
  for (const idx of indices) {
    runs[idx].baseAttributes = subtractAttrs(runs[idx].baseAttributes, attrs);
  }
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

  for (const textOp of pendingOps) {
    console.log(textOp)
    const { opId, actorEmail, createdAt } = textOp;
    let localLogPos = 0;
    let currentInsertGroup: InsertSuggestion | null = null;
    let currentDeleteGroup: DeleteSuggestion | null = null;
    let currentFormatGroup: FormatSuggestionItem | null = null;

    for (const [compIdx, component] of textOp.delta.ops.entries()) {
      if (typeof component.retain === "number" && !component.attributes) {
        const isLast =
          component === textOp.delta.ops[textOp.delta.ops.length - 1];
        if (isLast) break;

        currentInsertGroup = null;
        currentDeleteGroup = null;
        currentFormatGroup = null;
        localLogPos += component.retain;
        continue;
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
            continue;
          }

          if (run.text.length > remaining) {
            splitAt(runs, cursor, remaining);
          }

          const target = runs[cursor];
          const spanStart = target.logicalStart;
          const spanLen = target.text.length;
          const attrStr = JSON.stringify(component.attributes);

          target.baseAttributes = {
            ...target.baseAttributes,
            ...(component.attributes ?? {}),
          };

          if (!currentFormatGroup) {
            const existing = formatSuggestions.find(
              (f) =>
                f.actorEmail === actorEmail &&
                f.attributes === attrStr &&
                f.spans.length > 0 &&
                f.spans[f.spans.length - 1].start +
                  f.spans[f.spans.length - 1].length ===
                  spanStart,
            );

            currentFormatGroup =
              existing ??
              (() => {
                const g: FormatSuggestionItem = {
                  groupId: nextId(),
                  actorEmail,
                  createdAt,
                  attributes: attrStr,
                  opIds: [opId],
                  spans: [],
                  previewText: "",
                  dependsOnInsertGroupIds: [],
                };
                formatSuggestions.push(g);
                return g;
              })();
          }

          if (target.insertSuggestion?.groupId) {
            if (
              !currentFormatGroup.dependsOnInsertGroupIds.includes(
                target.insertSuggestion.groupId,
              )
            ) {
              currentFormatGroup.dependsOnInsertGroupIds.push(
                target.insertSuggestion.groupId,
              );
            }
          }

          if (!currentFormatGroup.opIds.includes(opId)) {
            currentFormatGroup.opIds.push(opId);
          }

          const last = currentFormatGroup.spans[currentFormatGroup.spans.length - 1];
          if (last && last.start + last.length === spanStart) {
            last.length += spanLen;
          } else {
            currentFormatGroup.spans.push({ start: spanStart, length: spanLen });
          }

          remaining -= spanLen;
          cursor++;
        }

        localLogPos += component.retain;
        continue;
      } else if (typeof component.insert === "string") {
        currentDeleteGroup = null;
        currentFormatGroup = null;

        const insertText = component.insert;
        const rawAttrs = { ...(component.attributes ?? {}) };

        const { idx: runIndex, offset } = findRunPos(runs, localLogPos);
        let insertAt = runIndex;
        if (offset > 0 && runIndex < runs.length) {
          insertAt = splitAt(runs, runIndex, offset);
        }

        const prevRun = insertAt > 0 ? runs[insertAt - 1] : null;
        const nextRun = insertAt < runs.length ? runs[insertAt] : null;

        if (!currentInsertGroup) {
          const adj =
            prevRun?.insertSuggestion?.actorEmail === actorEmail
              ? prevRun.insertSuggestion
              : null;

          if (adj) {
            currentInsertGroup = adj;
            if (!currentInsertGroup.opIds.includes(opId)) {
              currentInsertGroup.opIds.push(opId);
            }
          } else {
            currentInsertGroup = {
              groupId: nextId(),
              actorEmail,
              createdAt,
              opIds: [opId],
              startIndex: localLogPos
            };
          }
        } else if (createdAt > currentInsertGroup.createdAt) {
          currentInsertGroup.createdAt = createdAt;
        }

        let ownAttrs = { ...rawAttrs };

        if (
          prevRun &&
          prevRun.insertSuggestion &&
          prevRun.insertSuggestion.actorEmail !== actorEmail &&
          Object.keys(prevRun.baseAttributes).length > 0
        ) {
          const inherited = intersectAttrs(ownAttrs, prevRun.baseAttributes);

          if (Object.keys(inherited).length > 0) {
            const ownerEmail = prevRun.insertSuggestion.actorEmail;
            const attrStr = JSON.stringify(inherited);

            const prevGroup = collectInsertGroupRunsWithAttrs(
              runs,
              prevRun.insertSuggestion.groupId,
              inherited,
            );

            if (prevGroup) {
              const start = prevGroup.start;
              const end = localLogPos + insertText.length;

              let existing = formatSuggestions.find(
                (f) =>
                  f.actorEmail === ownerEmail &&
                  f.attributes === attrStr &&
                  f.spans.length > 0 &&
                  f.spans[f.spans.length - 1].start === start
              );

              if (existing) {
                const last = existing.spans[existing.spans.length - 1];
                last.start = start;
                last.length = Math.max(last.length, end - start);

                if (!existing.opIds.includes(opId)) {
                  existing.opIds.push(opId);
                }

                if (!existing.opIds.some((id) => prevRun.insertSuggestion!.opIds.includes(id))) {
                  existing.opIds.push(...prevRun.insertSuggestion.opIds);
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
              } else {
                formatSuggestions.push({
                  groupId: nextId(),
                  actorEmail: ownerEmail,
                  createdAt: prevRun.insertSuggestion.createdAt,
                  attributes: attrStr,
                  opIds: [...prevRun.insertSuggestion.opIds, opId],
                  spans: [{ start, length: end - start }],
                  previewText: "",
                  dependsOnInsertGroupIds: [
                    prevRun.insertSuggestion.groupId,
                    currentInsertGroup.groupId,
                  ],
                });
              }

              stripAttrsFromRuns(runs, prevGroup.indices, inherited);
              ownAttrs = subtractAttrs(ownAttrs, inherited);
            }
          }
        } else if (
          nextRun &&
          nextRun.insertSuggestion &&
          nextRun.insertSuggestion.actorEmail !== actorEmail &&
          Object.keys(nextRun.baseAttributes).length > 0
        ) {
          const inherited = intersectAttrs(ownAttrs, nextRun.baseAttributes);

          if (Object.keys(inherited).length > 0) {
            const ownerEmail = nextRun.insertSuggestion.actorEmail;
            const attrStr = JSON.stringify(inherited);

            const nextGroup = collectInsertGroupRunsWithAttrs(
              runs,
              nextRun.insertSuggestion.groupId,
              inherited,
            );

            if (nextGroup) {
              const start = localLogPos;
              const end = nextGroup.end;

              let existing = formatSuggestions.find(
                (f) =>
                  f.actorEmail === ownerEmail &&
                  f.attributes === attrStr &&
                  f.spans.length > 0 &&
                  f.spans[f.spans.length - 1].start === start
              );

              if (existing) {
                const last = existing.spans[existing.spans.length - 1];
                last.start = Math.min(last.start, start);
                last.length = Math.max(
                  last.length,
                  end - last.start,
                );

                if (!existing.opIds.includes(opId)) {
                  existing.opIds.push(opId);
                }

                if (!existing.opIds.some((id) => nextRun.insertSuggestion!.opIds.includes(id))) {
                  existing.opIds.push(...nextRun.insertSuggestion.opIds);
                }

                if (
                  !existing.dependsOnInsertGroupIds.includes(nextRun.insertSuggestion.groupId)
                ) {
                  existing.dependsOnInsertGroupIds.push(nextRun.insertSuggestion.groupId);
                }
                if (
                  !existing.dependsOnInsertGroupIds.includes(currentInsertGroup.groupId)
                ) {
                  existing.dependsOnInsertGroupIds.push(currentInsertGroup.groupId);
                }
              } else {
                formatSuggestions.push({
                  groupId: nextId(),
                  actorEmail: ownerEmail,
                  createdAt: nextRun.insertSuggestion.createdAt,
                  attributes: attrStr,
                  opIds: [...nextRun.insertSuggestion.opIds, opId],
                  spans: [{ start, length: end - start }],
                  previewText: "",
                  dependsOnInsertGroupIds: [
                    nextRun.insertSuggestion.groupId,
                    currentInsertGroup.groupId,
                  ],
                });
              }

              stripAttrsFromRuns(runs, nextGroup.indices, inherited);
              ownAttrs = subtractAttrs(ownAttrs, inherited);
            }
          }
        }

        const adjFmt = formatSuggestions.find((f) => {
          if (f.actorEmail === actorEmail) return false;
          const fmtAttrs = JSON.parse(f.attributes) as Record<string, any>;
          const inherited = intersectAttrs(ownAttrs, fmtAttrs);
          return (
            Object.keys(inherited).length > 0 &&
            f.spans.some((s) => s.start + s.length === localLogPos)
          );
        });

        if (adjFmt) {
          const fmtAttrs = JSON.parse(adjFmt.attributes) as Record<string, any>;
          const inherited = intersectAttrs(ownAttrs, fmtAttrs);
          if (Object.keys(inherited).length > 0) {
            ownAttrs = subtractAttrs(ownAttrs, inherited);
            const span = adjFmt.spans.find(
              (s) => s.start + s.length === localLogPos,
            )!;
            span.length += insertText.length;
          }
        }

        const parts = insertText.split("\n");
        let spliceAt = insertAt;
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
        localLogPos += insertText.length;
        continue;
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
            if (!currentDeleteGroup.opIds.includes(opId)) {
              currentDeleteGroup.opIds.push(opId);
            }
          } else {
            currentDeleteGroup = {
              groupId: nextId(),
              actorEmail,
              createdAt,
              opIds: [opId],
            };
          }
        }

        let remaining = component.delete;
        let newLineCount = 0;

        while (remaining > 0 && cursor < runs.length) {
          const run = runs[cursor];

          if (run.deleteSuggestion) {
            // already marked as deleted so skip
            cursor++;
            continue;
          }

          if (run.text === "\n") {
            remaining--;
            cursor++;
            newLineCount++;
            localLogPos++;
            continue;
          }

          if (remaining < run.text.length) {
            splitAt(runs, cursor, remaining);
          }

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
    for (const span of fmt.spans) {
      for (const run of runs) {
        if (
          !run.deleteSuggestion &&
          run.logicalStart >= span.start &&
          run.logicalStart < span.start + span.length
        ) {
          texts.push(run.text === "\n" ? " ↵ " : run.text);
        }
      }
    }

    fmt.previewText = texts.join("").slice(0, 60);
  }

  return {
    visualDelta: buildVisualDelta(runs),
    formatSuggestions,
  };
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
          createdAt:
            run.insertSuggestion.createdAt > last.insertSuggestion.createdAt
              ? run.insertSuggestion.createdAt
              : last.insertSuggestion.createdAt,
          opIds: mergeUniqueIds(
            last.insertSuggestion.opIds,
            run.insertSuggestion.opIds,
          ),
        };
      }

      if (last.deleteSuggestion && run.deleteSuggestion) {
        last.deleteSuggestion = {
          ...last.deleteSuggestion,
          createdAt:
            run.deleteSuggestion.createdAt > last.deleteSuggestion.createdAt
              ? run.deleteSuggestion.createdAt
              : last.deleteSuggestion.createdAt,
          opIds: mergeUniqueIds(
            last.deleteSuggestion.opIds,
            run.deleteSuggestion.opIds,
          ),
        };
      }
    } else {
      collapsed.push({
        ...run,
        baseAttributes: { ...run.baseAttributes },
        insertSuggestion: run.insertSuggestion
          ? {
              ...run.insertSuggestion,
              opIds: [...run.insertSuggestion.opIds],
            }
          : undefined,
        deleteSuggestion: run.deleteSuggestion
          ? {
              ...run.deleteSuggestion,
              opIds: [...run.deleteSuggestion.opIds],
            }
          : undefined,
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
        opIds: run.insertSuggestion.opIds,
      };
    }

    if (run.deleteSuggestion) {
      attrs["suggestion-delete"] = {
        groupId: run.deleteSuggestion.groupId,
        actorEmail: run.deleteSuggestion.actorEmail,
        createdAt: run.deleteSuggestion.createdAt,
        opIds: run.deleteSuggestion.opIds,
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

export function buildFormatOverlayDelta(item: FormatSuggestionItem): Delta {
  const delta = new Delta();
  let pos = 0;

  for (const span of item.spans) {
    if (span.start > pos) {
      delta.retain(span.start - pos);
    }

    delta.retain(span.length, {
      "suggestion-format": {
        groupId: item.groupId,
        actorEmail: item.actorEmail,
        createdAt: item.createdAt,
        attributes: item.attributes,
        opIds: item.opIds,
      },
    });

    pos = span.start + span.length;
  }

  return delta;
}

export function buildFormatOverlayClearDelta(
  item: FormatSuggestionItem,
): Delta {
  const delta = new Delta();
  let pos = 0;

  for (const span of item.spans) {
    if (span.start > pos) {
      delta.retain(span.start - pos);
    }

    delta.retain(span.length, { "suggestion-format": null });
    pos = span.start + span.length;
  }

  return delta;
}

