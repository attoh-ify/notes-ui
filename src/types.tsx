export type OperationState = "PENDING" | "COMMITTED" | "REJECTED" | "INVERSE";

export interface CharEntry {
  char: string;
  source: "base" | "new";

  insertedBy?: string;
  insertedAt?: string;
  insertGroupId?: string;

  deletedBy?: string;
  deletedAt?: string;
  deleteGroupId?: string;

  formattedBy?: string;
  formattedAt?: string;
  formatGroupId?: string;
  formatAttributes?: Record<string, any>;
}

export interface Segment {
  type: "base" | "insert" | "delete" | "format";
  text: string;
  authorId?: string;
  createdAt?: string;
  groupId?: string;
  formatAttributes?: Record<string, any>;
}

export interface TooltipState {
  x: number;
  y: number;
  groupId: string;
  type: "insert" | "delete" | "format";
  authorId: string;
  createdAt: string;
}