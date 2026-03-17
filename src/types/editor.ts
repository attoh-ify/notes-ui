export type MutableOp = {
  insert: string;
  attributes?: Record<string, any>;
  _suggestionInsert?: SuggestionInsert;
  _suggestionDelete?: SuggestionDelete;
  _suggestionFormat?: SuggestionFormat;
};

export type SuggestionInsert = {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  opIds: string[];
};

export type SuggestionDelete = {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  opIds: string[];
};

export type SuggestionFormat = {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  attributes: string;
  opIds: string[];
};

export interface TooltipState {
  groupId: string;
  type: "insert" | "delete" | "format";
  actorEmail: string;
  createdAt: string;
  opIds: string[];
}

export interface CursorModule {
  createCursor: (id: string, label: string, color: string) => void;
  moveCursor: (id: string, range: { index: number; length: number }) => void;
  removeCursor: (id: string) => void;
  toggleCursor: (id: string, value: boolean) => void;
}
