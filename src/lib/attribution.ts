import Quill, { Delta } from "quill";
import { TextOperation } from "./textOperation";
import {
  MutableOp,
  SuggestionDelete,
  SuggestionFormat,
  SuggestionInsert,
} from "@/src/types";

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
  for (let i = opIndex - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.insert === "\n") return null;
    if (op._suggestionInsert?.actorEmail === actorEmail)
      return op._suggestionInsert;
    return null;
  }
  return null;
}

function prevSuggestionDelete(
  opIndex: number,
  actorEmail: string,
): SuggestionDelete | null {
  for (let i = opIndex - 1; i >= 0; i--) {
    const op = ops[i];
    if (op._suggestionDelete?.actorEmail === actorEmail)
      return op._suggestionDelete;
    return null;
  }
  return null;
}

export default function displayFormattedNote(
  quill: Quill,
  log: TextOperation[],
): MutableOp[] | null {
  const baseOps = log.filter((op) => op.state !== "PENDING");
  const pendingOps = log.filter((op) => op.state === "PENDING");

  let baseDocument = new Delta();
  for (const op of baseOps) {
    baseDocument = baseDocument.compose(new Delta(op.delta.ops));
  }

  if (pendingOps.length === 0) {
    quill.setContents(baseDocument, "api");
    return null;
  }

  for (const op of baseDocument.ops) {
    if (typeof op.insert === "string") {
      ops.push(
        op.attributes
          ? { insert: op.insert, attributes: { ...op.attributes } }
          : { insert: op.insert },
      );
    }
  }

  for (const textOp of pendingOps) {
    const { actorEmail, createdAt } = textOp;
    let logicalPos = 0;

    let currentInsertGroup: SuggestionInsert | null = null;
    let currentDeleteGroup: SuggestionDelete | null = null;
    let currentFormatGroup: SuggestionFormat | null = null;

    for (const component of textOp.delta.ops) {
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

        if (!currentFormatGroup) {
          const prev = ops[opIndex - 1]?._suggestionFormat;
          currentFormatGroup =
            prev?.actorEmail === actorEmail
              ? prev
              : {
                  groupId: nextGroupId(),
                  actorEmail,
                  createdAt,
                  attributes: JSON.stringify(component.attributes),
                };
        }

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
          currentInsertGroup = prev ?? {
            groupId: nextGroupId(),
            actorEmail,
            createdAt,
          };
        } else {
          if (createdAt > currentInsertGroup.createdAt) {
            currentInsertGroup.createdAt = createdAt;
          }
        }

        const newOps: MutableOp[] = [];
        const parts = component.insert.split("\n");

        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (part.length > 0) {
            const attrs: Record<string, any> = {
              ...(component.attributes ?? {}),
            };
            newOps.push({
              insert: part,
              attributes: attrs,
              _suggestionInsert: { ...currentInsertGroup! },
            });
          }

          if (i < parts.length - 1) {
            newOps.push({ insert: "\n" });
            currentInsertGroup = null;
          }
        }

        ops.splice(insertAt, 0, ...newOps);
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
          currentDeleteGroup = prev ?? {
            groupId: nextGroupId(),
            actorEmail,
            createdAt,
          };
        }

        let remaining = component.delete;
        let advanceBy = component.delete;
        while (remaining > 0 && cursor < ops.length) {
          const op = ops[cursor];

          if (op.insert === "\n") {
            cursor++;
            remaining--;
            currentDeleteGroup = null;
            continue;
          }

          // actually remove because it was a pending operation
          if (op._suggestionInsert) {
            if (op.insert.length <= remaining) {
              remaining -= op.insert.length;
            } else {
              splitOpAt(cursor, remaining);
              remaining = 0;
            }
            ops.splice(cursor, 1);
            advanceBy -= op.insert.length;
            continue;
          }

          if (op._suggestionDelete) {
            // already marked as deleted so skip
            cursor++;
            continue;
          }

          // base text so mark as deleted - dont actually remove
          if (op.insert.length > remaining) {
            splitOpAt(cursor, remaining);
          }

          ops[cursor]._suggestionDelete = { ...currentDeleteGroup! };
          remaining -= ops[cursor].insert.length;
          cursor++;
        }

        logicalPos += advanceBy;
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
  const finalOps = collapsed.map((op) => {
    const attrs: Record<string, any> = { ...(op.attributes ?? {}) };

    if (op._suggestionInsert) {
      attrs["suggestion-insert"] = {
        groupId: op._suggestionInsert.groupId,
        actorEmail: op._suggestionInsert.actorEmail,
        createdAt: op._suggestionInsert.createdAt,
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
      };
    }
    if (op._suggestionDelete) {
      attrs["suggestion-delete"] = {
        groupId: op._suggestionDelete.groupId,
        actorEmail: op._suggestionDelete.actorEmail,
        createdAt: op._suggestionDelete.createdAt,
      };
    }

    return Object.keys(attrs).length > 0
      ? { insert: op.insert, attributes: attrs }
      : { insert: op.insert };
  });

  return finalOps;
}
