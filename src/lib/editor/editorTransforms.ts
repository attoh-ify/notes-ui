import Delta from "quill-delta";

export function hasOps(delta: Delta): boolean {
  return Array.isArray(delta.ops) && delta.ops.length > 0;
}

export function transformRangeAgainstDelta(
  range: { index: number; length: number },
  delta: Delta,
): { index: number; length: number } {
  const start = transformPositionAgainstDelta(range.index, delta);
  const end = transformPositionAgainstDelta(range.index + range.length,delta);

  return {
    index: Math.max(0, start),
    length: Math.max(0, end - start),
  };
}

export function transformPositionAgainstDelta(
  position: number,
  delta: Delta,
): number {
  let oldCursor = 0;
  let newPosition = position;

  for (const op of delta.ops ?? []) {
    if (op.retain && typeof op.retain === "number") {
      oldCursor += op.retain;
      continue;
    }

    if (op.insert) {
      const insertLength = typeof op.insert === "string" ? op.insert.length : 1;

      if (oldCursor < position) {
        newPosition += insertLength;
      }

      continue;
    }

    if (op.delete) {
      const deleteStart = oldCursor;
      const deleteEnd = oldCursor + op.delete;

      if (position > deleteEnd) {
        newPosition -= op.delete;
      } else if (position > deleteStart) {
        newPosition -= position - deleteStart;
      }

      oldCursor += op.delete;
    }
  }

  return Math.max(0, newPosition);
}
