import Delta from "quill-delta";
import { TextOperation } from "@/src/lib/textOperation";
import { CharEntry, Segment } from "./types";

// ── Build attribution array ───────────────────────────────────────────────────
//
// Three kinds of pending change:
//   insert  → new text inserted            (blue highlight)
//   delete  → existing text removed        (red strikethrough)
//   format  → retain WITH attributes       (yellow highlight)
//
// Plain retain (no attributes) = untouched text, no highlight.
//
// Grouping:
//   - All pending ops from the same actor are composed together first.
//     This eliminates redundant intermediate edits.
//   - Each contiguous run of the same change type gets its own groupId.
//     A plain retain (gap) between two runs resets the run, so two separate
//     paragraphs changed by the same actor become two independent blocks.

let _groupCounter = 0;
function nextGroupId(): string {
  return `g_${++_groupCounter}`;
}

export function buildAttributionArray(
  baseDocument: Delta,
  newOps: TextOperation[],
): CharEntry[] {
  const chars: CharEntry[] = [];

  for (const op of baseDocument.ops) {
    if (typeof op.insert === "string") {
      for (const ch of op.insert) {
        chars.push({ char: ch, source: "base" });
      }
    }
  }

  const actorOrder: string[] = [];
  const deltaByActor = new Map<string, Delta>();
  const metaByActor = new Map<
    string,
    { actorEmail: string; createdAt: string }
  >();

  for (const textOp of newOps) {
    const actor = textOp.actorEmail;

    if (!deltaByActor.has(actor)) {
      deltaByActor.set(actor, new Delta());
      actorOrder.push(actor);
      metaByActor.set(actor, {
        actorEmail: actor,
        createdAt: textOp.createdAt,
      });
    }

    const current = deltaByActor.get(actor)!;
    deltaByActor.set(actor, current.compose(new Delta(textOp.delta.ops)));
  }

  for (const actor of actorOrder) {
    const composedDelta = deltaByActor.get(actor)!;
    const { actorEmail, createdAt } = metaByActor.get(actor)!;
    
    let charIndex = 0;

    let currentInsertGroupId: string | null = null;
    let currentDeleteGroupId: string | null = null;
    let currentFormatGroupId: string | null = null;

    for (const component of composedDelta.ops) {
      if (typeof component.retain === "number" && !component.attributes) {
        currentInsertGroupId = null;
        currentDeleteGroupId = null;
        currentFormatGroupId = null;
        charIndex += component.retain;
      } else if (typeof component.retain === "number" && component.attributes) {
        if (!currentFormatGroupId) currentFormatGroupId = nextGroupId();
        currentInsertGroupId = null;
        currentDeleteGroupId = null;

        const groupId = currentFormatGroupId;
        const count = component.retain;

        for (let j = 0; j < count && charIndex + j < chars.length; j++) {
          const entry = chars[charIndex + j];
          // Only mark base chars; newly inserted chars already carry their own highlight
          if (entry.source === "base" && !entry.formattedBy) {
            entry.formattedBy = actorEmail;
            entry.formattedAt = createdAt;
            entry.formatGroupId = groupId;
            entry.formatAttributes = component.attributes;
          }
        }
        charIndex += count;
      } else if (typeof component.insert === "string") {
        if (!currentInsertGroupId) currentInsertGroupId = nextGroupId();
        // A new insert run breaks any open format run
        currentFormatGroupId = null;
        currentDeleteGroupId = null;

        const groupId = currentInsertGroupId;

        const newChars: CharEntry[] = component.insert.split("").map((ch) => ({
          char: ch,
          source: "new",
          insertedBy: actorEmail,
          insertedAt: createdAt,
          insertGroupId: groupId,
        }));
        chars.splice(charIndex, 0, ...newChars);
        charIndex += component.insert.length;
      } else if (typeof component.delete === "number") {
        if (!currentDeleteGroupId) currentDeleteGroupId = nextGroupId();
        // A new delete run breaks any open format run
        currentFormatGroupId = null;
        currentInsertGroupId = null;

        const groupId = currentDeleteGroupId;

        let toDelete = component.delete;
        let i = charIndex;

        while (toDelete > 0 && i < chars.length) {
          const entry = chars[i];

          if (
            entry.source === "new" &&
            entry.insertGroupId &&
            !entry.deletedBy
          ) {
            // Inserted then deleted by this actor — net zero, remove silently
            chars.splice(i, 1);
            toDelete--;
          } else if (!entry.deletedBy) {
            entry.deletedBy = actorEmail;
            entry.deletedAt = createdAt;
            entry.deleteGroupId = groupId;
            i++;
            toDelete--;
          } else {
            i++;
          }
        }
      }
    }
  }

  return chars;
}

// ── Build segments ────────────────────────────────────────────────────────────
// Consecutive chars with the same type + groupId collapse into one segment.
export function buildSegments(chars: CharEntry[]): Segment[] {
  const segments: Segment[] = [];

  for (const entry of chars) {
    let next: Segment;

    if (entry.deletedBy) {
      next = {
        type: "delete",
        text: entry.char,
        authorId: entry.deletedBy,
        createdAt: entry.deletedAt,
        groupId: entry.deleteGroupId,
      };
    } else if (entry.formattedBy) {
      next = {
        type: "format",
        text: entry.char,
        authorId: entry.formattedBy,
        createdAt: entry.formattedAt,
        groupId: entry.formatGroupId,
        formatAttributes: entry.formatAttributes,
      };
    } else if (entry.source === "new") {
      next = {
        type: "insert",
        text: entry.char,
        authorId: entry.insertedBy,
        createdAt: entry.insertedAt,
        groupId: entry.insertGroupId,
      };
    } else {
      next = { type: "base", text: entry.char };
    }

    const last = segments[segments.length - 1];

    if (
      last &&
      last.type === next.type &&
      (next.type === "base" || last.groupId === next.groupId)
    ) {
      last.text += next.text;
    } else {
      segments.push({ ...next });
    }
  }

  return segments;
}
