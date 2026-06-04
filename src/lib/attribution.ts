import Delta from "quill-delta";
import {
  DeleteSuggestion,
  FormatSuggestionItem,
  InsertSuggestion,
  ReviewSegment,
  Reference,
  TooltipState,
  BlockFormatSuggestionItem,
  ReviewFormatSuggestion,
} from "../types";

// ─── Format suggestion utilities ──────────────────────────────────────────────

export function cloneFormatSuggestions(
  items: FormatSuggestionItem[],
): FormatSuggestionItem[] {
  return items.map((item) => ({
    groupId: item.groupId,
    actorEmail: item.actorEmail,
    createdAt: item.createdAt,
    attributeKey: item.attributeKey,
    attributeValue: cloneJsonValue(item.attributeValue),
    references: cloneSuggestionReferences(item.references ?? []),
    previewText: item.previewText,
    dependsOnInsertGroupIds: [...(item.dependsOnInsertGroupIds ?? [])],
    dependsOnDeleteGroupIds: [...(item.dependsOnDeleteGroupIds ?? [])],
  }));
}

export function cloneBlockFormatSuggestions(
  items: BlockFormatSuggestionItem[],
): BlockFormatSuggestionItem[] {
  return items.map((item) => ({
    groupId: item.groupId,
    actorEmail: item.actorEmail,
    createdAt: item.createdAt,
    attributeKey: item.attributeKey,
    attributeValue: cloneJsonValue(item.attributeValue),
    behavior: item.behavior,
    conflictGroup: item.conflictGroup,
    references: cloneSuggestionReferences(item.references ?? []),
    previewText: item.previewText,
    dependsOnInsertGroupIds: [...(item.dependsOnInsertGroupIds ?? [])],
    dependsOnDeleteGroupIds: [...(item.dependsOnDeleteGroupIds ?? [])],
  }));
}

// ─── Quill delta utilities ────────────────────────────────────────────────────

export function stripSuggestionAttributes(delta: Delta): Delta {
  return new Delta(
    (delta.ops ?? []).map((op: any) => {
      if (!op.attributes) return op;

      const {
        "suggestion-format": _f,
        "suggestion-block-format": _bf,
        "suggestion-delete": _d,
        "suggestion-delete-singleline": _dsl,
        "suggestion-delete-multiline": _dml,
        "suggestion-insert": _i,
        "suggestion-newline": _n,
        ...attrs
      } = op.attributes;

      return {
        ...op,
        attributes: Object.keys(attrs).length ? attrs : undefined,
      };
    }),
  );
}

export function buildFormatOverlayDelta(
  item: ReviewFormatSuggestion,
): Delta {
  const delta = new Delta();
  let pos = 0;

  const ranges = rangesFromReferences(item.references ?? []);

  if (isBlockFormatSuggestion(item)) {
    return delta;
  }

  const attributes = {
    [item.attributeKey]: item.attributeValue,
  };

  for (const range of ranges) {
    if (range.start > pos) {
      delta.retain(range.start - pos);
    }

    delta.retain(range.length, {
      "suggestion-format": {
        groupId: item.groupId,
        actorEmail: item.actorEmail,
        createdAt: item.createdAt,
        attributes,
        references: cloneSuggestionReferences(item.references ?? []),
      },
    });

    pos = range.start + range.length;
  }

  return delta;
}

export function buildFormatOverlayClearDelta(
  item: ReviewFormatSuggestion,
): Delta {
  const delta = new Delta();
  let pos = 0;

  const ranges = rangesFromReferences(item.references ?? []);

  if (isBlockFormatSuggestion(item)) {
    return delta;
  }

  for (const range of ranges) {
    if (range.start > pos) {
      delta.retain(range.start - pos);
    }

    delta.retain(range.length, {
      "suggestion-format": null,
    });

    pos = range.start + range.length;
  }

  return delta;
}

// ─── Runtime segment utilities ────────────────────────────────────────────────

function hasSuggestionAttr(seg: ReviewSegment): boolean {
  return !!(
    seg.insertSuggestion ||
    seg.newlineSuggestion ||
    seg.deleteSuggestion
  );
}

export function deltaToSegments(
  delta: Delta,
  nextId: () => string,
): ReviewSegment[] {
  return (delta.ops ?? [])
    .filter((op: any) => op.insert !== undefined && op.insert !== null)
    .map((op: any) => {
      const allAttrs: Record<string, any> = { ...(op.attributes ?? {}) };

      const insertMeta = normalizeSuggestionMeta<any>(
        allAttrs["suggestion-insert"],
      );

      const newlineMeta = normalizeSuggestionMeta<any>(
        allAttrs["suggestion-newline"],
      );

      const deleteMeta =
        normalizeSuggestionMeta<any>(allAttrs["suggestion-delete"]) ??
        normalizeSuggestionMeta<any>(allAttrs["suggestion-delete-singleline"]) ??
        normalizeSuggestionMeta<any>(allAttrs["suggestion-delete-multiline"]) ??
        null;

      let baseAttributes: Record<string, any>;
      let suggestionAttributes: Record<string, any>;

      if (insertMeta) {
        baseAttributes = { ...(insertMeta.baseAttributes ?? {}) };
        suggestionAttributes = { ...(insertMeta.suggestionAttributes ?? {}) };
      } else if (newlineMeta) {
        baseAttributes = { ...(newlineMeta.baseAttributes ?? {}) };
        suggestionAttributes = { ...(newlineMeta.suggestionAttributes ?? {}) };
      } else if (deleteMeta) {
        baseAttributes = { ...(deleteMeta.baseAttributes ?? {}) };
        suggestionAttributes = { ...(deleteMeta.suggestionAttributes ?? {}) };
      } else {
        baseAttributes = stripRuntimeSuggestionAttrs(allAttrs);
        suggestionAttributes = {};
      }

      const references: Reference[] = cloneSuggestionReferences(
        insertMeta?.references ??
          newlineMeta?.references ??
          deleteMeta?.references ??
          [],
      );

      const isTextInsert = typeof op.insert === "string";

      return {
        id: nextId(),
        text: isTextInsert ? op.insert : "",
        embed: isTextInsert ? undefined : cloneJsonValue(op.insert),

        baseAttributes,
        suggestionAttributes,
        references,

        insertSuggestion: insertMeta
          ? {
              groupId: insertMeta.groupId,
              actorEmail: insertMeta.actorEmail,
              createdAt: insertMeta.createdAt,
            }
          : undefined,

        newlineSuggestion: newlineMeta
          ? {
              groupId: newlineMeta.groupId,
              actorEmail: newlineMeta.actorEmail,
              createdAt: newlineMeta.createdAt,
              references: cloneSuggestionReferences(newlineMeta.references ?? references),
              dependsOnReviewRunIds: [
                ...(newlineMeta.dependsOnReviewRunIds ?? []),
              ],
              type: newlineMeta.type ?? "STANDALONE",
              marker: newlineMeta.marker === true,
            }
          : undefined,

        deleteSuggestion: deleteMeta
          ? {
              groupId: deleteMeta.groupId,
              actorEmail: deleteMeta.actorEmail,
              createdAt: deleteMeta.createdAt,
              type:
                deleteMeta.type ??
                (allAttrs["suggestion-delete-singleline"]
                  ? "SINGLE_LINE"
                  : allAttrs["suggestion-delete-multiline"]
                    ? "MULTI_LINE"
                    : "TEXT"),
            }
          : undefined,
      };
    });
}

export function mergeAdjacentSegments(
  segments: ReviewSegment[],
): ReviewSegment[] {
  const merged: ReviewSegment[] = [];

  for (const seg of segments) {
    const last = merged[merged.length - 1];

    const canMerge =
      !!last &&
      !last.embed &&
      !seg.embed &&
      last.text !== "\n" &&
      seg.text !== "\n" &&
      !last.text.includes("\n") &&
      !seg.text.includes("\n") &&
      shallowEqual(getEffectiveAttributes(last), getEffectiveAttributes(seg)) &&
      sameInsertSuggestion(last, seg) &&
      sameNewlineSuggestion(last, seg) &&
      sameDeleteSuggestion(last, seg) &&
      shallowEqual(last.baseAttributes ?? {}, seg.baseAttributes ?? {});

    if (canMerge) {
      last.text += seg.text;

      last.references = dedupeSuggestionReferences([
        ...(last.references ?? []),
        ...(seg.references ?? []),
      ]);

      continue;
    }

    merged.push(cloneSegment(seg));
  }

  return merged;
}

export function segmentsToBaseDelta(segments: ReviewSegment[]): Delta {
  const delta = new Delta();

  for (const seg of segments) {
    const isNewlineMarker = seg.newlineSuggestion?.marker === true;

    if (isNewlineMarker) {
      delta.insert(seg.text || " ↵ ");
      continue;
    }

    const attrs: Record<string, any> = {
      ...(seg.baseAttributes ?? {}),
      ...(seg.suggestionAttributes ?? {}),
    };

    delete attrs["suggestion-insert"];
    delete attrs["suggestion-newline"];
    delete attrs["suggestion-delete"];
    delete attrs["suggestion-delete-newline"];
    delete attrs["suggestion-delete-singleline"];
    delete attrs["suggestion-delete-multiline"];
    delete attrs["suggestion-format"];
    delete attrs["suggestion-block-format"];

    delta.insert(
      segmentInsertValue(seg),
      Object.keys(attrs).length > 0 ? attrs : undefined,
    );
  }

  return delta;
}

export function segmentsToSuggestionOverlayDelta(
  segments: ReviewSegment[],
): Delta {
  const delta = new Delta();

  let cursor = 0;

  for (const seg of segments) {
    const len = segmentLength(seg);
    if (len <= 0) continue;

    const references = cloneSuggestionReferences(seg.references ?? []);
    const attrs: Record<string, any> = {};

    if (seg.newlineSuggestion?.marker === true) {
      attrs["suggestion-newline"] = {
        groupId: seg.newlineSuggestion.groupId,
        actorEmail: seg.newlineSuggestion.actorEmail,
        createdAt: seg.newlineSuggestion.createdAt,
        references: [],
        dependsOnReviewRunIds: [
          ...(seg.newlineSuggestion.dependsOnReviewRunIds ?? []),
        ],
        type: seg.newlineSuggestion.type ?? "STANDALONE",
        marker: true,
        baseAttributes: seg.baseAttributes ?? null,
        suggestionAttributes: seg.suggestionAttributes ?? null,
      };

      delta.retain(len, attrs);
      cursor += len;
      continue;
    }

    if (seg.insertSuggestion) {
      attrs["suggestion-insert"] = {
        groupId: seg.insertSuggestion.groupId,
        actorEmail: seg.insertSuggestion.actorEmail,
        createdAt: seg.insertSuggestion.createdAt,
        references,
        baseAttributes: seg.baseAttributes ?? null,
        suggestionAttributes: seg.suggestionAttributes ?? null,
      };
    }

    if (seg.newlineSuggestion) {
      attrs["suggestion-newline"] = {
        groupId: seg.newlineSuggestion.groupId,
        actorEmail: seg.newlineSuggestion.actorEmail,
        createdAt: seg.newlineSuggestion.createdAt,
        references,
        dependsOnReviewRunIds: [
          ...(seg.newlineSuggestion.dependsOnReviewRunIds ?? []),
        ],
        type: seg.newlineSuggestion.type ?? "STANDALONE",
        marker: false,
        baseAttributes: seg.baseAttributes ?? null,
        suggestionAttributes: seg.suggestionAttributes ?? null,
      };
    }

    if (seg.deleteSuggestion) {
      const type = seg.deleteSuggestion.type ?? "TEXT";

      const deletePayload = {
        groupId: seg.deleteSuggestion.groupId,
        actorEmail: seg.deleteSuggestion.actorEmail,
        createdAt: seg.deleteSuggestion.createdAt,
        type,
        references,
        baseAttributes: seg.baseAttributes ?? null,
        suggestionAttributes: seg.suggestionAttributes ?? null,
      };

      if (type === "SINGLE_LINE") {
        attrs["suggestion-delete-singleline"] = deletePayload;
      } else if (type === "MULTI_LINE") {
        attrs["suggestion-delete-multiline"] = deletePayload;
      } else {
        attrs["suggestion-delete"] = deletePayload;
      }
    }

    if (Object.keys(attrs).length > 0) {
      delta.retain(len, attrs);
    } else {
      delta.retain(len);
    }

    cursor += len;
  }

  return delta;
}

export function cloneSegments(items: ReviewSegment[]): ReviewSegment[] {
  return items.map(cloneSegment);
}

export function findInsertGroupRangeInRuntime(
  segments: ReviewSegment[],
  groupId: string,
): { index: number; length: number } | null {
  let cursor = 0;
  let start = -1;
  let end = -1;

  for (const seg of segments) {
    const len = segmentLength(seg);

    if (seg.insertSuggestion?.groupId === groupId) {
      if (start === -1) start = cursor;
      end = cursor + len;
    }

    cursor += len;
  }

  return start === -1 ? null : { index: start, length: end - start };
}

export function findNewlineGroupRangeInRuntime(
  segments: ReviewSegment[],
  groupId: string,
): { index: number; length: number } | null {
  let cursor = 0;
  let start = -1;
  let end = -1;

  for (const seg of segments) {
    const len = segmentLength(seg);

    if (seg.newlineSuggestion?.groupId === groupId) {
      if (start === -1) start = cursor;
      end = cursor + len;
    }

    cursor += len;
  }

  return start === -1 ? null : { index: start, length: end - start };
}

export function removeNewlineSuggestionFromSegments(
  segments: ReviewSegment[],
  groupId: string,
): ReviewSegment[] {
  return mergeAdjacentSegments(
    segments
      .map((seg) => {
        if (seg.newlineSuggestion?.groupId !== groupId) return seg;

        // Virtual BE marker " ↵ " disappears on accept.
        if (seg.newlineSuggestion.marker === true) {
          return null;
        }

        // Actual newline stays, but no longer has suggestion metadata.
        return {
          id: seg.id,
          text: seg.text ?? "",
          embed: seg.embed ? cloneJsonValue(seg.embed) : undefined,
          baseAttributes: { ...(seg.baseAttributes ?? {}) },
          suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
          references: cloneSuggestionReferences(seg.references ?? []),
        };
      })
      .filter(Boolean) as ReviewSegment[],
  );
}

export function deleteNewlineGroupSegmentsPreservingBlockFormats(
  segments: ReviewSegment[],
  groupId: string,
): {
  segments: ReviewSegment[];
  deletedNewlineRanges: Array<{
    index: number;
    length: number;
    blockBaseAttributes: Record<string, any>;
    blockSuggestionAttributes: Record<string, any>;
  }>;
} {
  const deletedNewlineRanges: Array<{
    index: number;
    length: number;
    blockBaseAttributes: Record<string, any>;
    blockSuggestionAttributes: Record<string, any>;
  }> = [];

  let cursor = 0;

  const shouldRemove = segments.map((seg) => {
    const remove = seg.newlineSuggestion?.groupId === groupId;
    return remove;
  });

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const len = segmentLength(seg);

    if (
      shouldRemove[i] &&
      isRealNewlineSegment(seg) &&
      !isVirtualNewlineMarker(seg)
    ) {
      deletedNewlineRanges.push({
        index: cursor,
        length: len,
        blockBaseAttributes: pickBlockAttributes(seg.baseAttributes),
        blockSuggestionAttributes: pickBlockAttributes(seg.suggestionAttributes),
      });
    }

    cursor += len;
  }

  const next = segments
    .map((seg, index) => {
      if (!shouldRemove[index]) {
        return cloneSegment(seg);
      }

      /*
       * Remove both:
       * - virtual standalone marker
       * - actual rejected pending newline
       */
      return null;
    })
    .filter(Boolean) as ReviewSegment[];

  /*
   * Transfer block attrs from each removed real newline to the next surviving
   * real newline. This mirrors Quill's behavior: if one line-ending newline
   * disappears, the next newline becomes the line's block-format holder.
   */
  for (const deleted of deletedNewlineRanges) {
    const targetIndex = findNextRealNewlineSegmentIndex(next, deleted.index);

    if (targetIndex === -1) {
      /*
       * Safety fallback. Quill documents should normally have a terminal newline,
       * but if runtime segments temporarily do not, add one so block attrs still
       * have a newline holder.
       */
      next.push({
        id: `seg_fallback_newline_${Date.now()}_${Math.random()
          .toString(16)
          .slice(2)}`,
        text: "\n",
        baseAttributes: { ...deleted.blockBaseAttributes },
        suggestionAttributes: { ...deleted.blockSuggestionAttributes },
        references: [],
      });

      continue;
    }

    const target = next[targetIndex];

    next[targetIndex] = {
      ...target,
      baseAttributes: mergeBlockAttrsIntoTarget(
        target.baseAttributes,
        deleted.blockBaseAttributes,
      ),
      suggestionAttributes: mergeBlockAttrsIntoTarget(
        target.suggestionAttributes,
        deleted.blockSuggestionAttributes,
      ),
    };
  }

  return {
    segments: mergeAdjacentSegments(next),
    deletedNewlineRanges,
  };
}

export function resolveNewlineSuggestionsAfterDependencyChange(
  segments: ReviewSegment[],
  dependencyId: string,
): {
  segments: ReviewSegment[];
  autoRejectedReferences: Reference[];
} {
  const autoRejectedReferences: Reference[] = [];

  const next = segments
    .map((seg) => {
      if (!seg.newlineSuggestion) return seg;

      const oldDeps = seg.newlineSuggestion.dependsOnReviewRunIds ?? [];

      if (!oldDeps.includes(dependencyId)) return seg;

      const newDeps = oldDeps.filter((id) => id !== dependencyId);

      if (
        newDeps.length === 0 &&
        (seg.newlineSuggestion.type ?? "STANDALONE") === "DEPENDENT"
      ) {
        autoRejectedReferences.push(
          ...cloneSuggestionReferences(seg.references ?? []),
        );

        return null;
      }

      return {
        ...cloneSegment(seg),
        newlineSuggestion: {
          ...seg.newlineSuggestion,
          references: cloneSuggestionReferences(
            seg.newlineSuggestion.references ?? [],
          ),
          dependsOnReviewRunIds: newDeps,
          type:
            newDeps.length > 0
              ? "DEPENDENT"
              : seg.newlineSuggestion.type ?? "STANDALONE",
        },
      };
    })
    .filter(Boolean) as ReviewSegment[];

  return {
    segments: mergeAdjacentSegments(next),
    autoRejectedReferences: dedupeSuggestionReferences(autoRejectedReferences),
  };
}

export function findDeleteGroupRangeInRuntime(
  segments: ReviewSegment[],
  groupId: string,
): { index: number; length: number } | null {
  let cursor = 0;
  let start = -1;
  let end = -1;

  for (const seg of segments) {
    const len = segmentLength(seg);

    if (seg.deleteSuggestion?.groupId === groupId) {
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
      if (seg.insertSuggestion?.groupId !== groupId) return seg;

      return {
        id: seg.id,
        text: seg.text ?? "",
        embed: seg.embed ? cloneJsonValue(seg.embed) : undefined,
        baseAttributes: { ...(seg.baseAttributes ?? {}) },
        suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
        references: cloneSuggestionReferences(seg.references ?? []),
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
    return seg.insertSuggestion?.groupId !== groupId;
  });

  if (!insertRange) {
    return mergeAdjacentSegments(afterDelete);
  }

  const rangeEnd = insertRange.index + insertRange.length;
  let cursor = 0;

  const cleaned = afterDelete.filter((seg) => {
    const segLen = segmentLength(seg);
    const segStart = cursor;
    const segEnd = cursor + segLen;
    cursor = segEnd;

    const isCommittedNewline =
      !seg.embed && seg.text === "\n" && !hasSuggestionAttr(seg);

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

    const len = segmentLength(seg);
    const start = cursor;
    const end = cursor + len;

    if (index >= end) {
      cursor = end;
      continue;
    }

    if (seg.embed) {
      segments.splice(i, 1);
      return mergeAdjacentSegments(segments);
    }

    const offset = index - start;

    splitSegmentAt(segments, i, offset, nextId);

    const rightIndex = splitSegmentAt(segments, i + 1, 1, nextId);

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
    baseAttributes: { ...baseAttributes },
    suggestionAttributes: { ...suggestionAttributes },
    references: [],
  };

  let cursor = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    const len = segmentLength(seg);
    const start = cursor;
    const end = cursor + len;

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

    if (seg.embed) {
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

function normalizeSuggestionMeta<T = any>(value: any): T | null {
  if (!value) return null;

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  return value as T;
}

// ─── DOM / selector utilities ─────────────────────────────────────────────────

export function getSuggestionSelector(
  groupId: string,
  type: TooltipState["type"] | "delete-inline" = "delete-inline",
): string {
  if (type === "insert") {
    return `[data-suggestion-type="insert"][data-group-id="${groupId}"]`;
  }

  if (type === "newline") {
    return `[data-suggestion-type="newline"][data-group-id="${groupId}"]`;
  }

  if (type === "format") {
    return `[data-suggestion-type="format"][data-group-id="${groupId}"]`;
  }

  return `[data-suggestion-type="delete"][data-group-id="${groupId}"]`;
}

export function restoreFormatSuggestionToBase(
  segments: ReviewSegment[],
  item: ReviewFormatSuggestion,
): ReviewSegment[] {
  const key = item.attributeKey;

  let cursor = 0;

  const ranges = rangesFromReferences(item.references ?? []);

  const updated = segments.map((seg) => {
    const segLen = segmentLength(seg);
    const segStart = cursor;
    const segEnd = cursor + segLen;
    cursor = segEnd;

    const overlaps = ranges.some(
      (range) => range.start < segEnd && range.start + range.length > segStart,
    );

    if (!overlaps) return seg;

    const newSuggestion = { ...(seg.suggestionAttributes ?? {}) };
    delete newSuggestion[key];

    return {
      ...seg,
      embed: seg.embed ? cloneJsonValue(seg.embed) : undefined,
      baseAttributes: { ...(seg.baseAttributes ?? {}) },
      suggestionAttributes: newSuggestion,
      references: cloneSuggestionReferences(seg.references ?? []),
    };
  });

  return mergeAdjacentSegments(updated);
}

export function resolveFormatSuggestionsAfterMutation<
  T extends ReviewFormatSuggestion,
>(
  items: T[],
  mutation: { index: number; length: number },
  mutationGroupId: string,
  mutationType: "insert" | "delete",
  action: "ACCEPT" | "REJECT",
): T[] {
  const rangeStart = mutation.index;

  const shouldShrink =
    (mutationType === "insert" && action === "REJECT") ||
    (mutationType === "delete" && action === "ACCEPT");

  const next: T[] = [];

  for (const item of items) {
    const updatedReferences = shouldShrink
      ? removeRangeFromReferences(
          item.references ?? [],
          rangeStart,
          mutation.length,
        )
      : cloneSuggestionReferences(item.references ?? []);

    if (updatedReferences.length === 0) continue;

    const dependsOnInsertGroupIds =
      mutationType === "insert"
        ? item.dependsOnInsertGroupIds.filter((id) => id !== mutationGroupId)
        : [...item.dependsOnInsertGroupIds];

    const dependsOnDeleteGroupIds =
      mutationType === "delete"
        ? item.dependsOnDeleteGroupIds.filter((id) => id !== mutationGroupId)
        : [...item.dependsOnDeleteGroupIds];

    next.push({
      ...item,
      references: updatedReferences,
      dependsOnInsertGroupIds,
      dependsOnDeleteGroupIds,
    });
  }

  return next;
}

export function resolveFormatSuggestionsAfterRuntimeDeletion<
  T extends ReviewFormatSuggestion,
>(
  items: T[],
  deletedRanges: Array<{ index: number; length: number }>,
): T[] {
  if (deletedRanges.length === 0) return items;

  return items
    .map((item) => {
      let references = cloneSuggestionReferences(item.references ?? []);

      for (const deleted of deletedRanges) {
        references = removeRangeFromReferences(
          references,
          deleted.index,
          deleted.length,
        );
      }

      return {
        ...item,
        references,
      };
    })
    .filter((item) => (item.references ?? []).length > 0);
}

export function resolveBlockFormatSuggestionsAfterNewlineDeletion<
  T extends BlockFormatSuggestionItem,
>(
  items: T[],
  deletedNewlineRanges: Array<{
    index: number;
    length: number;
    blockBaseAttributes: Record<string, any>;
    blockSuggestionAttributes: Record<string, any>;
  }>,
): T[] {
  if (deletedNewlineRanges.length === 0) {
    return items;
  }

  return items
    .map((item) => {
      let references = cloneSuggestionReferences(item.references ?? []);

      for (const deleted of deletedNewlineRanges) {
        references = transferOrShiftBlockReferencesAfterDeletedNewline(
          references,
          deleted.index,
          deleted.length,
        );
      }

      return {
        ...item,
        references,
      };
    })
    .filter((item) => (item.references ?? []).length > 0);
}

function removeRangeFromReferences(
  refs: Reference[] = [],
  removeStart: number,
  removeLength: number,
): Reference[] {
  if (removeLength <= 0) return cloneSuggestionReferences(refs);

  const removeEnd = removeStart + removeLength;
  const out: Reference[] = [];

  for (const ref of refs) {
    const refStart = ref.reviewStart;
    const refEnd = ref.reviewStart + ref.length;

    if (refEnd <= removeStart || refStart >= removeEnd) {
      out.push({ ...ref });
      continue;
    }

    const leftLen = Math.max(0, removeStart - refStart);
    const rightLen = Math.max(0, refEnd - removeEnd);

    if (leftLen > 0) {
      out.push({
        ...ref,
        length: leftLen,
      });
    }

    if (rightLen > 0) {
      out.push({
        ...ref,
        reviewStart: removeEnd,
        componentStart: ref.componentStart + Math.max(0, removeEnd - refStart),
        length: rightLen,
      });
    }
  }

  return dedupeSuggestionReferences(out);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function getEffectiveAttributes(seg: ReviewSegment) {
  return {
    ...(seg.baseAttributes ?? {}),
    ...(seg.suggestionAttributes ?? {}),
  };
}

function cloneInsertSuggestion(
  suggestion: InsertSuggestion,
): InsertSuggestion {
  return {
    groupId: suggestion.groupId,
    actorEmail: suggestion.actorEmail,
    createdAt: suggestion.createdAt,
  };
}

function cloneDeleteSuggestion(
  suggestion: DeleteSuggestion,
): DeleteSuggestion {
  return {
    groupId: suggestion.groupId,
    actorEmail: suggestion.actorEmail,
    createdAt: suggestion.createdAt,
    type: suggestion.type ?? "TEXT",
  };
}

function cloneSuggestionReferences(
  refs: Reference[] = [],
): Reference[] {
  return refs.map((r) => ({
    reviewStart: r.reviewStart,
    componentStart: r.componentStart,
    length: r.length,
    opId: r.opId,
    componentIndex: r.componentIndex,
  }));
}

function splitSuggestionReferences(
  refs: Reference[] = [],
  splitOffset: number,
): {
  left: Reference[];
  right: Reference[];
} {
  const left: Reference[] = [];
  const right: Reference[] = [];

  for (const ref of refs) {
    const refStart = ref.componentStart;
    const refEnd = ref.componentStart + ref.length;

    if (refEnd <= splitOffset) {
      left.push({ ...ref });
      continue;
    }

    if (refStart >= splitOffset) {
      right.push({
        ...ref,
        componentStart: ref.componentStart - splitOffset,
      });
      continue;
    }

    const leftLen = splitOffset - refStart;
    const rightLen = refEnd - splitOffset;

    if (leftLen > 0) {
      left.push({
        ...ref,
        length: leftLen,
      });
    }

    if (rightLen > 0) {
      right.push({
        ...ref,
        componentStart: 0,
        length: rightLen,
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

  if (!seg || seg.embed) {
    return segmentIndex;
  }

  if (offset <= 0 || offset >= seg.text.length) {
    return segmentIndex;
  }

  const split = splitSuggestionReferences(seg.references ?? [], offset);

  const left: ReviewSegment = {
    id: seg.id,
    text: seg.text.slice(0, offset),
    baseAttributes: { ...(seg.baseAttributes ?? {}) },
    suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
    references: split.left,
    insertSuggestion: seg.insertSuggestion
      ? cloneInsertSuggestion(seg.insertSuggestion)
      : undefined,
    deleteSuggestion: seg.deleteSuggestion
      ? cloneDeleteSuggestion(seg.deleteSuggestion)
      : undefined,
  };

  const right: ReviewSegment = {
    id: nextId(),
    text: seg.text.slice(offset),
    baseAttributes: { ...(seg.baseAttributes ?? {}) },
    suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
    references: split.right,
    insertSuggestion: seg.insertSuggestion
      ? cloneInsertSuggestion(seg.insertSuggestion)
      : undefined,
    deleteSuggestion: seg.deleteSuggestion
      ? cloneDeleteSuggestion(seg.deleteSuggestion)
      : undefined,
  };

  segments.splice(segmentIndex, 1, left, right);

  return segmentIndex + 1;
}

function dedupeSuggestionReferences(
  refs: Reference[],
): Reference[] {
  const seen = new Set<string>();

  return refs.filter((r) => {
    const key = [
      r.opId,
      r.componentIndex,
      r.reviewStart,
      r.componentStart,
      r.length,
    ].join("-");

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

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

export type ReviewRange = {
  start: number;
  length: number;
};

export function rangesFromReferences(references: Reference[] = []): ReviewRange[] {
  const raw = references
    .filter((ref) => ref.length > 0)
    .map((ref) => ({
      start: ref.reviewStart,
      length: ref.length,
    }))
    .sort((a, b) => a.start - b.start);

  const merged: ReviewRange[] = [];

  for (const range of raw) {
    const last = merged[merged.length - 1];
    const start = range.start;
    const end = range.start + range.length;

    if (!last) {
      merged.push({ start, length: range.length });
      continue;
    }

    const lastEnd = last.start + last.length;

    if (start <= lastEnd) {
      last.length = Math.max(lastEnd, end) - last.start;
    } else {
      merged.push({ start, length: range.length });
    }
  }

  return merged;
}

export function restoreRejectedDeleteSegments(
  segments: ReviewSegment[],
  groupId: string,
): ReviewSegment[] {
  return mergeAdjacentSegments(
    segments.map((seg) => {
      if (seg.deleteSuggestion?.groupId !== groupId) return seg;

      return {
        ...cloneSegment(seg),
        text:
          seg.deleteSuggestion.type === "SINGLE_LINE" && seg.text === " ↵ "
            ? "\n"
            : seg.text,
        references: [],
        deleteSuggestion: undefined,
      };
    }),
  );
}

function sameInsertSuggestion(a: ReviewSegment, b: ReviewSegment) {
  if (!!a.insertSuggestion !== !!b.insertSuggestion) return false;
  if (!a.insertSuggestion && !b.insertSuggestion) return true;

  return (
    a.insertSuggestion?.groupId === b.insertSuggestion?.groupId &&
    a.insertSuggestion?.actorEmail === b.insertSuggestion?.actorEmail &&
    a.insertSuggestion?.createdAt === b.insertSuggestion?.createdAt
  );
}

function sameNewlineSuggestion(a: ReviewSegment, b: ReviewSegment) {
  if (!!a.newlineSuggestion !== !!b.newlineSuggestion) return false;
  if (!a.newlineSuggestion && !b.newlineSuggestion) return true;

  return (
    a.newlineSuggestion?.groupId === b.newlineSuggestion?.groupId &&
    a.newlineSuggestion?.actorEmail === b.newlineSuggestion?.actorEmail &&
    a.newlineSuggestion?.createdAt === b.newlineSuggestion?.createdAt &&
    a.newlineSuggestion?.type === b.newlineSuggestion?.type &&
    (a.newlineSuggestion?.marker ?? false) ===
      (b.newlineSuggestion?.marker ?? false)
  );
}

function sameDeleteSuggestion(a: ReviewSegment, b: ReviewSegment) {
  if (!!a.deleteSuggestion !== !!b.deleteSuggestion) return false;
  if (!a.deleteSuggestion && !b.deleteSuggestion) return true;

  return (
    a.deleteSuggestion?.groupId === b.deleteSuggestion?.groupId &&
    a.deleteSuggestion?.actorEmail === b.deleteSuggestion?.actorEmail &&
    a.deleteSuggestion?.createdAt === b.deleteSuggestion?.createdAt &&
    a.deleteSuggestion?.type === b.deleteSuggestion?.type
  );
}

export function collectSuggestionReferencesByGroup(
  segments: ReviewSegment[],
  groupId: string,
  type: "insert" | "newline" | "delete",
): Reference[] {
  const refs: Reference[] = [];

  for (const seg of segments) {
    const matches =
      type === "insert"
        ? seg.insertSuggestion?.groupId === groupId
        : type === "newline"
          ? seg.newlineSuggestion?.groupId === groupId
          : seg.deleteSuggestion?.groupId === groupId;

    if (!matches) continue;

    /**
     * Newline marker is virtual UI content from visualDelta.
     * It exists only so the user can click the standalone newline.
     * The actual "\n" segment owns the real source references.
     */
    if (
      type === "newline" &&
      seg.newlineSuggestion?.marker === true
    ) {
      continue;
    }

    refs.push(...cloneSuggestionReferences(seg.references ?? []));
  }

  return dedupeSuggestionReferences(refs);
}

function cloneJsonValue<T>(value: T): T {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function segmentLength(seg: ReviewSegment): number {
  return seg.embed ? 1 : seg.text.length;
}

export function segmentInsertValue(seg: ReviewSegment): any {
  return seg.embed ? cloneJsonValue(seg.embed) : seg.text;
}

export function segmentPreviewText(seg: ReviewSegment): string {
  if (seg.embed) return "[image]";
  return seg.text;
}

function stripRuntimeSuggestionAttrs(
  attrs: Record<string, any>,
): Record<string, any> {
  const {
    "suggestion-format": _f,
    "suggestion-block-format": _bf,
    "suggestion-delete": _d,
    "suggestion-delete-singleline": _dsl,
    "suggestion-delete-multiline": _dml,
    "suggestion-insert": _i,
    "suggestion-newline": _n,
    ...clean
  } = attrs ?? {};

  return clean;
}

function cloneSegment(seg: ReviewSegment): ReviewSegment {
  return {
    id: seg.id,
    text: seg.text ?? "",
    embed: seg.embed ? cloneJsonValue(seg.embed) : undefined,
    baseAttributes: { ...(seg.baseAttributes ?? {}) },
    suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
    references: cloneSuggestionReferences(seg.references ?? []),

    insertSuggestion: seg.insertSuggestion
      ? { ...seg.insertSuggestion }
      : undefined,

    newlineSuggestion: seg.newlineSuggestion
      ? {
          groupId: seg.newlineSuggestion.groupId,
          actorEmail: seg.newlineSuggestion.actorEmail,
          createdAt: seg.newlineSuggestion.createdAt,
          references: cloneSuggestionReferences(seg.newlineSuggestion.references ?? []),
          dependsOnReviewRunIds: [
            ...(seg.newlineSuggestion.dependsOnReviewRunIds ?? []),
          ],
          type: seg.newlineSuggestion.type ?? "STANDALONE",
          marker: seg.newlineSuggestion.marker === true,
        }
      : undefined,

    deleteSuggestion: seg.deleteSuggestion
      ? { ...seg.deleteSuggestion }
      : undefined,
  };
}

export function isBlockFormatSuggestion(
  item: ReviewFormatSuggestion,
): item is BlockFormatSuggestionItem {
  return (
    "behavior" in item ||
    "conflictGroup" in item
  );
}

const BLOCK_ATTRIBUTE_KEYS = new Set([
  "header",
  "list",
  "indent",
  "align",
  "blockquote",
  "code-block",
  "direction",
]);

function isBlockAttributeKey(key: string): boolean {
  return BLOCK_ATTRIBUTE_KEYS.has(key);
}

function pickBlockAttributes(
  attrs: Record<string, any> | undefined,
): Record<string, any> {
  const out: Record<string, any> = {};

  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (isBlockAttributeKey(key)) {
      out[key] = cloneJsonValue(value);
    }
  }

  return out;
}

function hasAttrs(attrs: Record<string, any>): boolean {
  return Object.keys(attrs).length > 0;
}

function mergeBlockAttrsIntoTarget(
  target: Record<string, any> | undefined,
  source: Record<string, any>,
): Record<string, any> {
  return {
    ...(target ?? {}),
    ...source,
  };
}

function isRealNewlineSegment(seg: ReviewSegment): boolean {
  return !seg.embed && seg.text === "\n";
}

export function isVirtualNewlineMarker(seg: ReviewSegment): boolean {
  return seg.newlineSuggestion?.marker === true;
}

function findNextRealNewlineSegmentIndex(
  segments: ReviewSegment[],
  runtimeIndex: number,
): number {
  let cursor = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const len = segmentLength(seg);
    const start = cursor;
    const end = cursor + len;

    if (end <= runtimeIndex) {
      cursor = end;
      continue;
    }

    if (isRealNewlineSegment(seg) && !isVirtualNewlineMarker(seg)) {
      return i;
    }

    cursor = end;
  }

  return -1;
}

function transferOrShiftBlockReferencesAfterDeletedNewline(
  refs: Reference[],
  deleteStart: number,
  deleteLength: number,
): Reference[] {
  const deleteEnd = deleteStart + deleteLength;
  const out: Reference[] = [];

  for (const ref of refs) {
    const refStart = ref.reviewStart;
    const refEnd = ref.reviewStart + ref.length;

    /*
     * Block refs are usually length 1 and target a newline.
     * If the ref targeted the deleted newline, transfer it to the same runtime
     * position. After deleting that newline, the next character/newline shifts
     * into this same index.
     */
    const overlapsDeletedNewline =
      refStart < deleteEnd && refEnd > deleteStart;

    if (overlapsDeletedNewline) {
      out.push({
        ...ref,
        reviewStart: deleteStart,
      });
      continue;
    }

    /*
     * Anything after the deleted newline shifts left.
     */
    if (refStart >= deleteEnd) {
      out.push({
        ...ref,
        reviewStart: refStart - deleteLength,
      });
      continue;
    }

    out.push({ ...ref });
  }

  return dedupeSuggestionReferences(out);
}

export function referenceLength(seg: ReviewSegment): number {
  return isVirtualNewlineMarker(seg) ? 0 : segmentLength(seg);
}

export function getRuntimeTextInReferenceRange(
  segments: ReviewSegment[],
  start: number,
  length: number,
): string {
  const end = start + length;
  let refCursor = 0;
  let out = "";

  for (const seg of segments) {
    if (isVirtualNewlineMarker(seg)) {
      continue;
    }

    const segLen = segmentLength(seg);
    const segStart = refCursor;
    const segEnd = refCursor + segLen;

    if (segEnd <= start) {
      refCursor = segEnd;
      continue;
    }

    if (segStart >= end) break;

    if (seg.embed) {
      out += "[image]";
      refCursor = segEnd;
      continue;
    }

    const from = Math.max(start, segStart) - segStart;
    const to = Math.min(end, segEnd) - segStart;

    out += (seg.text ?? "").slice(from, to);

    refCursor = segEnd;
  }

  return out;
}

export function referenceIndexToVisualIndex(
  segments: ReviewSegment[],
  referenceIndex: number,
): number {
  let referenceCursor = 0;
  let visualCursor = 0;

  for (const seg of segments) {
    const visualLength = segmentLength(seg);

    /*
     * Virtual standalone newline markers exist in Quill visual space,
     * but they do not exist in backend reference space.
     */
    if (isVirtualNewlineMarker(seg)) {
      visualCursor += visualLength;
      continue;
    }

    const refLength = referenceLength(seg);

    if (referenceIndex < referenceCursor + refLength) {
      return visualCursor + (referenceIndex - referenceCursor);
    }

    referenceCursor += refLength;
    visualCursor += visualLength;
  }

  return visualCursor;
}