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

export type NewlineSuggestionType = "DEPENDENT" | "STANDALONE";

export interface NewlineSuggestion {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  references: Reference[];
  dependsOnReviewRunIds: string[];
  type: NewlineSuggestionType;
  marker?: boolean;
}

export type DeleteSuggestionType = "TEXT" | "SINGLE_LINE" | "MULTI_LINE";

export interface DeleteSuggestion {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  type?: DeleteSuggestionType;
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

export type BlockFormatBehavior =
  | "CONTINUING"
  | "NON_CONTINUING"
  | "COEXISTING";

export type BlockFormatConflictGroup =
  | "EXCLUSIVE_BLOCK_STYLE"
  | "ALIGNMENT"
  | "INDENT"
  | "DIRECTION";

export interface BlockFormatSuggestionItem {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  attributeKey: string;
  attributeValue: any;
  behavior: BlockFormatBehavior;
  conflictGroup: BlockFormatConflictGroup;
  references: Reference[];
  previewText: string;
  dependsOnInsertGroupIds: string[];
  dependsOnDeleteGroupIds: string[];
  dependsOnNewlineGroupIds: string[];
}

export type ReviewFormatSuggestion =
  | FormatSuggestionItem
  | BlockFormatSuggestionItem;

export interface ReviewProjection {
  baseDelta: Delta;
  visualDelta: Delta;
  formatSuggestions: FormatSuggestionItem[];
  blockFormatSuggestions: BlockFormatSuggestionItem[];
}

export interface ReviewSegment {
  id: string;
  text: string;
  embed?: any;
  baseAttributes: Record<string, any>;
  suggestionAttributes: Record<string, any>;
  references: Reference[];
  insertSuggestion?: InsertSuggestion;
  newlineSuggestion?: NewlineSuggestion;
  deleteSuggestion?: DeleteSuggestion;
}

export interface TooltipState {
  groupId: string;
  type: "insert" | "newline" | "delete" | "format";
  actorEmail: string;
  createdAt: string;
  references: Reference[];
}