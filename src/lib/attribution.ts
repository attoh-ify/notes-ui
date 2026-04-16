import Delta from "quill-delta";

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

export interface ReviewProjection {
  visualDelta: Delta;
  formatSuggestions: FormatSuggestionItem[];
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