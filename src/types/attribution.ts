import Delta from "quill-delta";

export interface Reference {
  reviewStart: number;
  componentStart: number;
  length: number;
  opId: string;
  componentIndex: number;
}

export interface InsertSuggestion {
  groupId: string;
  actorEmail: string;
  createdAt: string;
}

export interface DeleteSuggestion {
  groupId: string;
  actorEmail: string;
  createdAt: string;
}

export interface FormatSuggestionItem {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  attributeKey: string;
  attributeValue: any;
  references: Reference[];
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
  baseAttributes: Record<string, any>;
  suggestionAttributes: Record<string, any>;
  references: Reference[];
  insertSuggestion?: InsertSuggestion;
  deleteSuggestion?: DeleteSuggestion;
}

export interface TooltipState {
  groupId: string;
  type: "insert" | "delete" | "format";
  actorEmail: string;
  createdAt: string;
  references: Reference[];
}

export type ReviewAction = "ACCEPT" | "REJECT";

export interface SegmentUndoPatch {
  index: number;
  deleteCount: number;
  before: ReviewSegment[];
}

export interface FormatSuggestionUndoPatch {
  index: number;
  deleteCount: number;
  before: FormatSuggestionItem[];
}

export interface ReviewUndoPatch {
  segmentsPatch: SegmentUndoPatch | null;
  formatSuggestionsPatch: FormatSuggestionUndoPatch | null;
  activeSuggestionBefore: TooltipState | null;
  activeFormatIdBefore: string | null;
}

export interface ReviewEntry {
  type: ReviewAction;
  patch: ReviewUndoPatch;
}