import Delta from "quill-delta";

export interface OpReference {
  opId: string;
  componentIndex: number;
}

export interface SuggestionSlice {
  reviewStart: number;
  componentStart: number;
  length: number;
  ref: OpReference;
}

export interface InsertSuggestion {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  references: SuggestionSlice[];
}

export interface DeleteSuggestion {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  references: SuggestionSlice[];
}

export interface FormatSuggestionSpan {
  start: number;
  length: number;
}

export interface FormatSuggestionItem {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  attributeKey: string;
  attributeValue: any;
  references: SuggestionSlice[];
  spans: FormatSuggestionSpan[];
  previewText: string;
  dependsOnInsertGroupIds: string[];
  dependsOnDeleteGroupIds: string[];
}

export interface ReviewProjection {
  baseDelta: Delta;
  visualDelta: Delta;
  formatSuggestions: FormatSuggestionItem[];
}

export interface ReviewSegment {
  id: string;
  text: string;
  // attrs: Record<string, any>;
  baseAttributes: Record<string, any>;
  suggestionAttributes: Record<string, any>;
  // references: SuggestionSlice[];
  insertSuggestion?: InsertSuggestion;
  deleteSuggestion?: DeleteSuggestion;
}

export interface TooltipState {
  groupId: string;
  type: "insert" | "delete" | "format";
  actorEmail: string;
  createdAt: string;
  references: SuggestionSlice[];
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
