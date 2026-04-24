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
  baseAttributes?: Record<string, any>;
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
  baseDelta: Delta;
  visualDelta: Delta;
  formatSuggestions: FormatSuggestionItem[];
}

export interface ReviewSegment {
  id: string;
  text: string;
  attrs: Record<string, any>;
  references: OpReference[];
  baseAttributes: Record<string, any>;
}

export interface TooltipState {
  groupId: string;
  type: "insert" | "delete" | "format";
  actorEmail: string;
  createdAt: string;
  references: OpReference[];
}

export type ReviewAction = "ACCEPT" | "REJECT";

export interface RuntimeSnapshot {
  segments: ReviewSegment[];
  formatSuggestions: FormatSuggestionItem[];
  activeSuggestion: TooltipState | null;
  activeFormatId: string | null;
}

export interface ReviewEntry {
  type: ReviewAction;
  snapshot: RuntimeSnapshot;
}
