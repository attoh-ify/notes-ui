import Delta from "quill-delta";

export interface Reference {
  reviewStart: number;
  componentStart: number;
  length: number;
  opId: string;
  componentIndex: number;
}

export interface InsertChange {
  groupId: string;
  actorEmail: string;
  createdAt: string;
}

export type DeleteChangeType = "TEXT" | "SINGLE_LINE" | "MULTI_LINE";

export interface DeleteChange {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  type?: DeleteChangeType;
}

export interface FormatChangeItem {
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

export interface BlockFormatChangeItem {
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
}

export type FormatChange = FormatChangeItem | BlockFormatChangeItem;

export interface AuditProjection {
  baseDelta: Delta;
  visualDelta: Delta;
  formatChanges: FormatChangeItem[];
  blockFormatChanges: BlockFormatChangeItem[];
}

export interface Segment {
  id: string;
  text: string;
  embed?: any;
  baseAttributes: Record<string, any>;
  changeAttributes: Record<string, any>;
  references: Reference[];
  insertChange?: InsertChange;
  deleteChange?: DeleteChange;
}

export interface TooltipState {
  groupId: string;
  type: "insert" | "delete" | "format";
  actorEmail: string;
  createdAt: string;
  references: Reference[];
}
