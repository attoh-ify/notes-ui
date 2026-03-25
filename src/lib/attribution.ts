"use client";

import { Delta } from "quill";
import type Quill from "quill";
import { TextOperation } from "./textOperation";
import {
  MutableOp,
  SuggestionDelete,
  SuggestionFormat,
  SuggestionInsert,
} from "@/src/types";
import { apiFetch } from "./api";

export default async function displayFormattedNote(
  quill: Quill,
  noteId: string,
  committedOps: TextOperation[],
  pendingOps: TextOperation[],
): Promise<Delta | null> {
  let committedDocument = new Delta();
  for (const op of committedOps) {
    committedDocument = committedDocument.compose(new Delta(op.delta.ops));
  }

  quill.setContents(committedDocument, "api");

  if (pendingOps.length === 0) {
    return null;
  }

  let _groupCounter = 0;
  const ops: MutableOp[] = [];

  function nextGroupId(): string {
    return `g_${++_groupCounter}`;
  }

  function splitOpAt(index: number, offset: number): number {
    if (offset === 0 || offset >= ops[index].insert.length) return index;

    const op = ops[index];
    const left: MutableOp = {
      insert: op.insert.slice(0, offset),
      opId: op.opId ?? "",
      insertComponentIndex: op.insertComponentIndex,
      ...(op.attributes ? { attributes: { ...op.attributes } } : {}),
      ...(op._suggestionInsert
        ? { _suggestionInsert: { ...op._suggestionInsert } }
        : {}),
      ...(op._suggestionFormat
        ? { _suggestionFormat: { ...op._suggestionFormat } }
        : {}),
      ...(op._suggestionDelete
        ? { _suggestionDelete: { ...op._suggestionDelete } }
        : {}),
    };

    const right: MutableOp = {
      insert: op.insert.slice(offset),
      opId: op.opId ?? "",
      insertComponentIndex: op.insertComponentIndex,
      ...(op.attributes ? { attributes: { ...op.attributes } } : {}),
      ...(op._suggestionInsert
        ? { _suggestionInsert: { ...op._suggestionInsert } }
        : {}),
      ...(op._suggestionFormat
        ? { _suggestionFormat: { ...op._suggestionFormat } }
        : {}),
      ...(op._suggestionDelete
        ? { _suggestionDelete: { ...op._suggestionDelete } }
        : {}),
    };

    ops.splice(index, 1, left, right);
    return index + 1;
  }

  function findPos(logicalPos: number): {
    opIndex: number;
    intraOffset: number;
  } {
    let remaining = logicalPos;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op._suggestionDelete) continue;
      if (remaining === 0) return { opIndex: i, intraOffset: 0 };
      if (remaining < op.insert.length)
        return { opIndex: i, intraOffset: remaining };
      remaining -= op.insert.length;
    }

    return { opIndex: ops.length, intraOffset: 0 };
  }

  function prevSuggestionInsert(
    opIndex: number,
    actorEmail: string,
  ): SuggestionInsert | null {
    let i = opIndex - 1;
    while (i >= 0) {
      const op = ops[i];
      if (op._suggestionInsert?.actorEmail === actorEmail)
        return op._suggestionInsert;
      if (op.insert !== "\n") break;
      i--;
    }

    let j = opIndex;
    while (j < ops.length) {
      const op = ops[j];
      if (op._suggestionInsert?.actorEmail === actorEmail)
        return op._suggestionInsert;
      if (op.insert !== "\n") break;
      j++;
    }

    return null;
  }

  function prevSuggestionDelete(
    opIndex: number,
    actorEmail: string,
  ): SuggestionDelete | null {
    const prev = ops[opIndex - 1];

    if (!prev) return null;

    if (prev._suggestionDelete?.actorEmail === actorEmail)
      return prev._suggestionDelete;
    return null;
  }

  function prevSuggestionFormat(
    opIndex: number,
    actorEmail: string,
  ): SuggestionFormat | null {
    const prev = ops[opIndex - 1];

    if (!prev) return null;

    if (prev._suggestionFormat?.actorEmail === actorEmail)
      return prev._suggestionFormat;
    return null;
  }

  for (const [index, op] of committedDocument.ops.entries()) {
    if (typeof op.insert === "string") {
      ops.push(
        op.attributes
          ? { insert: op.insert, opId: "", attributes: { ...op.attributes }, insertComponentIndex: index }
          : { insert: op.insert, opId: "", insertComponentIndex: index },
      );
    }
  }

  for (const textOp of pendingOps) {
    const { opId, actorEmail, createdAt } = textOp;
    let logicalPos = 0;

    let currentInsertGroup: SuggestionInsert | null = null;
    let currentDeleteGroup: SuggestionDelete | null = null;
    let currentFormatGroup: SuggestionFormat | null = null;

    for (const [index, component] of textOp.delta.ops.entries()) {
      if (typeof component.retain === "number" && !component.attributes) {
        const isLast =
          component === textOp.delta.ops[textOp.delta.ops.length - 1];
        if (isLast) break;

        currentInsertGroup = null;
        currentDeleteGroup = null;
        currentFormatGroup = null;
        logicalPos += component.retain;
      } else if (typeof component.retain === "number" && component.attributes) {
        currentInsertGroup = null;
        currentDeleteGroup = null;

        let { opIndex, intraOffset } = findPos(logicalPos);
        if (intraOffset > 0) {
          opIndex = splitOpAt(opIndex, intraOffset);
        }

        let remaining = component.retain;
        let cursor = opIndex;

        while (remaining > 0 && cursor < ops.length) {
          const op = ops[cursor];
          if (op.insert === "\n") {
            // we don't format line breaks
            cursor++;
            continue;
          }

          if (op.insert.length > remaining) {
            splitOpAt(cursor, remaining);
          }

          const chunkLen = ops[cursor].insert.length;

          if (op._suggestionFormat) {
            const existingAttrs = JSON.parse(
              op._suggestionFormat.attributes ?? "{}",
            );
            const cancels =
              Object.keys(existingAttrs).every(
                (k) => component.attributes![k] === null,
              ) &&
              Object.keys(component.attributes).every(
                (k) => component.attributes![k] === null,
              );

            if (cancels) {
              const formatOpIds = op._suggestionFormat.opIds;
              delete ops[cursor]._suggestionFormat;

              await apiFetch(`notes/${noteId}/review/split/format`, {
                method: "POST",
                body: JSON.stringify({
                  cancelledOpIds: formatOpIds,
                  cancellingOpId: opId,
                  opLength: chunkLen,
                  totalLength: component.retain,
                  consumedBefore: component.retain - remaining - chunkLen,
                }),
              });

              remaining -= chunkLen;
              cursor++;
              continue;
            }
          }

          if (!currentFormatGroup) {
            const prev = prevSuggestionFormat(opIndex, actorEmail);
            prev?.opIds.push(opId);
            currentFormatGroup = prev ?? {
              groupId: nextGroupId(),
              actorEmail,
              createdAt,
              attributes: JSON.stringify(component.attributes),
              opIds: [opId],
            };
          }

          ops[cursor]._suggestionFormat = { ...currentFormatGroup };
          remaining -= ops[cursor].insert.length;
          cursor++;
        }

        logicalPos += component.retain;
      } else if (typeof component.insert === "string") {
        currentDeleteGroup = null;
        currentFormatGroup = null;

        const { opIndex, intraOffset } = findPos(logicalPos);
        let insertAt = opIndex;
        if (intraOffset > 0) {
          insertAt = splitOpAt(opIndex, intraOffset);
        }

        if (!currentInsertGroup) {
          const prev = prevSuggestionInsert(insertAt, actorEmail);
          prev?.opIds.push(opId);
          currentInsertGroup = prev ?? {
            groupId: nextGroupId(),
            actorEmail,
            createdAt,
            opIds: [opId],
          };
        } else {
          if (createdAt > currentInsertGroup.createdAt) {
            currentInsertGroup.createdAt = createdAt;
          }
        }

        const parts = component.insert.split("\n");

        for (let i = 0; i < parts.length; i++) {
          if (parts[i].length > 0) {
            ops.splice(insertAt, 0, {
              insert: parts[i],
              attributes: { ...(component.attributes ?? {}) },
              opId,
              insertComponentIndex: index,
              _suggestionInsert: { ...currentInsertGroup },
            });
            insertAt++;
          }
          if (i < parts.length - 1) {
            ops.splice(insertAt, 0, { insert: "\n", opId, insertComponentIndex: index });
            insertAt++;
          }
        }

        logicalPos += component.insert.length;
      } else if (typeof component.delete === "number") {
        currentInsertGroup = null;
        currentFormatGroup = null;

        const { opIndex, intraOffset } = findPos(logicalPos);
        let cursor = opIndex;

        if (intraOffset > 0) {
          cursor = splitOpAt(opIndex, intraOffset);
        }

        if (!currentDeleteGroup) {
          const prev = prevSuggestionDelete(cursor, actorEmail);
          prev?.opIds.push(opId);
          currentDeleteGroup = prev ?? {
            groupId: nextGroupId(),
            actorEmail,
            createdAt,
            opIds: [opId],
          };
        }

        let remaining = component.delete;
        let newLineCount = 0;

        while (remaining > 0 && cursor < ops.length) {
          const op = ops[cursor];

          if (op._suggestionDelete) {
            // already marked as deleted so skip
            cursor++;
            continue;
          }

          if (op.insert === "\n") {
            cursor++;
            remaining--;
            logicalPos++;
            newLineCount++;
            continue;
          }

          // actually remove because it was a pending operation
          if (op._suggestionInsert) {
            const overlapLength = Math.min(op.insert.length, remaining);

            if (overlapLength < op.insert.length)
              splitOpAt(cursor, overlapLength);

            ops.splice(cursor, 1);
            
            await apiFetch(`notes/${noteId}/review/split/insert`, {
              method: "POST",
              body: JSON.stringify({
                insertOpId: op.opId,
                deleteOpId: opId,
                insertComponentIndex: op.insertComponentIndex,
                overlapLength: overlapLength + newLineCount,
                deleteComponentIndex: index,
              }),
            });

            remaining -= overlapLength;
            logicalPos += overlapLength;
            newLineCount = 0;
            continue;
          }

          // base text so mark as deleted - dont actually remove
          const len = Math.min(op.insert.length, remaining);
          if (len < op.insert.length) splitOpAt(cursor, len);

          ops[cursor]._suggestionDelete = { ...currentDeleteGroup! };
          remaining -= len;
          logicalPos += len;
          cursor++;
        }
      }
    }
  }

  // ensure all ops with the same groupId have the same createdAt (the most recent one)
  const groupLatest = new Map<string, string>();
  for (const op of ops) {
    const si = op._suggestionInsert;
    if (si) {
      const current = groupLatest.get(si.groupId);
      if (!current || si.createdAt > current)
        groupLatest.set(si.groupId, si.createdAt);
    }
  }

  for (const op of ops) {
    if (op._suggestionInsert) {
      op._suggestionInsert.createdAt = groupLatest.get(
        op._suggestionInsert.groupId,
      )!;
    }
  }

  function sameGroup(a: MutableOp, b: MutableOp): boolean {
    const insertMatch =
      (!a._suggestionInsert && !b._suggestionInsert) ||
      (a._suggestionInsert &&
        b._suggestionInsert &&
        a._suggestionInsert.groupId === b._suggestionInsert.groupId);

    const deleteMatch =
      (!a._suggestionDelete && !b._suggestionDelete) ||
      (a._suggestionDelete &&
        b._suggestionDelete &&
        a._suggestionDelete.groupId === b._suggestionDelete.groupId);

    const formatMatch =
      (!a._suggestionFormat && !b._suggestionFormat) ||
      (a._suggestionFormat &&
        b._suggestionFormat &&
        a._suggestionFormat.groupId === b._suggestionFormat.groupId);

    const attrMatch =
      JSON.stringify(a.attributes) === JSON.stringify(b.attributes);

    return !!insertMatch && !!deleteMatch && !!formatMatch && attrMatch;
  }

  // collapse ops in the same group
  const collapsed: MutableOp[] = [];
  for (const op of ops) {
    const last = collapsed[collapsed.length - 1];
    if (
      last &&
      op.insert !== "\n" &&
      last.insert !== "\n" &&
      sameGroup(op, last)
    ) {
      last.insert += op.insert;
    } else {
      collapsed.push({ ...op });
    }
  }

  // create the actual ops
  let applyDelta = new Delta();
  for (const op of collapsed) {
    const len = op.insert.length;
    const attrs: Record<string, any> = {};

    if (op._suggestionInsert) {
      attrs["suggestion-insert"] = {
        groupId: op._suggestionInsert.groupId,
        actorEmail: op._suggestionInsert.actorEmail,
        createdAt: op._suggestionInsert.createdAt,
        opIds: op._suggestionInsert.opIds,
      };
    }
    if (op._suggestionFormat) {
      try {
        const fmtAttrs = JSON.parse(op._suggestionFormat.attributes ?? "{}");
        Object.assign(attrs, fmtAttrs);
      } catch {}

      attrs["suggestion-format"] = {
        groupId: op._suggestionFormat.groupId,
        actorEmail: op._suggestionFormat.actorEmail,
        createdAt: op._suggestionFormat.createdAt,
        attributes: op._suggestionFormat.attributes,
        opIds: op._suggestionFormat.opIds,
      };
    }
    if (op._suggestionDelete) {
      attrs["suggestion-delete"] = {
        groupId: op._suggestionDelete.groupId,
        actorEmail: op._suggestionDelete.actorEmail,
        createdAt: op._suggestionDelete.createdAt,
        opIds: op._suggestionDelete.opIds,
      };
    }

    if (Object.keys(attrs).length > 0) {
      if (op._suggestionInsert) {
        applyDelta.insert(op.insert, attrs);
      } else {
        applyDelta.retain(len, attrs);
      }
    } else {
      if (op.insert === "\n") {
        applyDelta.insert(op.insert);
      } else {
        applyDelta.retain(len);
      }
    }
  }

  return applyDelta;
}
