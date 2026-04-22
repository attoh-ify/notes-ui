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

// ReviewSegment is the runtime equivalent of a ReviewRun. Once the projection
// is loaded, the editor state is tracked as a flat list of these segments rather
// than re-reading from Quill directly. This lets accept/reject/undo operate on
// a plain data structure and then push the result into Quill via setContents.
export interface ReviewSegment {
  id: string;
  text: string;
  attrs: Record<string, any>;
  references: OpReference[];
}

// TooltipState is the minimal shape needed to render the ReviewTooltip and to
// drive the "active" highlight on suggestion DOM nodes.
export interface TooltipState {
  groupId: string;
  type: "insert" | "delete" | "format";
  actorEmail: string;
  createdAt: string;
  references: OpReference[];
}

export type ReviewAction = "ACCEPT" | "REJECT";

// RuntimeSnapshot is a complete point-in-time capture of all review state that
// the undo system needs to restore. It is taken once before each action and
// stored in ReviewEntry. Because all four pieces of state (segments, format
// suggestions, active overlay ID, active tooltip) are bundled here, nothing
// needs to be duplicated alongside it in ReviewEntry.
export interface RuntimeSnapshot {
  segments: ReviewSegment[];
  formatSuggestions: FormatSuggestionItem[];
  activeSuggestion: TooltipState | null;
  activeFormatId: string | null;
}

// ReviewEntry stores exactly what undo() needs and nothing more:
//   type     — whether this was an ACCEPT or REJECT, so undo() knows whether
//              to pop from rejectedChanges or acceptedReferences.
//   snapshot — the complete pre-action state to restore.
//
// Previously this held 9 fields including undoDelta, redoDelta, beforeFormat
// Suggestions, afterFormatSuggestions, beforeActiveFormatId, afterActiveFormatId,
// beforeActiveSuggestion, afterActiveSuggestion — none of which were read by
// undo(). The "before*" fields were also exact duplicates of data already inside
// runtimeSnapshotBefore (now renamed snapshot).
export interface ReviewEntry {
  type: ReviewAction;
  snapshot: RuntimeSnapshot;
}
