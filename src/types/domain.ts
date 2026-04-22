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

export type NoteAccessRole = "OWNER" | "SUPER" | "EDITOR" | "VIEWER";

export interface LoginResponse {
  userId: string;
  token: string;
}

export interface JoinResponse {
  collaborators: { [email: string]: string };
  delta: Delta;
  revision: number;
}

export interface ReviewInProgressResponse {
  noteId: string;
  state: boolean;
}

export interface CursorPayload {
  actorEmail: string;
  position: number;
}

export enum MessageType {
  COLLABORATOR_JOIN = "COLLABORATOR_JOIN",
  OPERATION = "OPERATION",
  COLLABORATOR_CURSOR = "COLLABORATOR_CURSOR",
  REVIEW_IN_PROGRESS = "REVIEW_IN_PROGRESS",
}

export const TYPE_CONFIG = {
  insert: { label: "Insertion", color: "#1976D2" },
  delete: { label: "Deletion", color: "#C62828" },
  format: { label: "Formatting", color: "#F9A825" },
};
