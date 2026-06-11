import Delta from "quill-delta";

export interface Note {
  id: string;
  ownerEmail: string;
  title: string;
  visibility: NoteVisibility;
  accessRole: NoteAccessRole;
  currentNoteVersionNumber: number;
  createdAt: string;
  updatedAt: string;
}

export interface NoteAccess {
  id: string;
  email: string;
  role: NoteAccessRole;
}

export interface NoteVersion {
  id: string;
  masterDelta: Delta;
  revision: number;
  comment: string;
  versionNumber: number;
  createdAt: string;
}

export type NoteVisibility = "PRIVATE" | "PUBLIC";

export type NoteAccessRole = "OWNER" | "SUPER" | "EDITOR" | "VIEWER" | "RESTRICTED";

export interface LoginResponse {
  userId: string;
  token: string;
}

export type CollaborationMode = "SOLO" | "COLLABORATIVE";

export interface JoinResponse {
  collaborators: { [email: string]: string };
  delta: Delta;
  revision: number;
  isReviewing: boolean;
  mode: CollaborationMode;
  activeSessionCount: number;
}

export interface ReviewInProgressResponse {
  noteId: string;
  state: boolean;
}

export interface CursorPayload {
  actorEmail: string;
  position: number;
  length: number;
}

export interface SoloSyncAckPayload {
  noteId: string;
  opId: string;
  success: boolean;
  revision?: number;
  error?: string;
}

export interface CollaborationModePayload {
  noteId: string;
  mode: CollaborationMode;
  activeSessionCount: number;
}

export enum MessageType {
  COLLABORATOR_JOIN = "COLLABORATOR_JOIN",
  OPERATION = "OPERATION",
  COLLABORATOR_CURSOR = "COLLABORATOR_CURSOR",
  REVIEW_IN_PROGRESS = "REVIEW_IN_PROGRESS",
  COLLABORATION_MODE = "COLLABORATION_MODE",
  SOLO_SYNC_ACK = "SOLO_SYNC_ACK",
}

export const TYPE_CONFIG = {
  insert: { label: "Insertion", color: "#1976D2" },
  delete: { label: "Deletion", color: "#C62828" },
  format: { label: "Formatting", color: "#F9A825" },
};
