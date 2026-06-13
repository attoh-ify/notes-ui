import { useRef } from "react";
import type { CurrentRef } from "./editorHookTypes";
import type { CompatClient } from "@stomp/stompjs";
import type Quill from "quill";
import Delta from "quill-delta";
import type {
  CollaborationMode,
  CursorModule,
  CursorPayload,
} from "@/src/types";
import { transformRangeAgainstDelta } from "@/src/lib/editor/editorTransforms";

interface UseCursorPresenceArgs {
  noteId: string;
  quillRef: CurrentRef<Quill | null>;
  stompClientRef: CurrentRef<CompatClient | null>;
  userRef: CurrentRef<{ email: string } | null | undefined>;
  collaboratorsRef: CurrentRef<Record<string, string>>;
  isReviewingRef: CurrentRef<boolean>;
  collaborationModeRef: CurrentRef<CollaborationMode>;
}

export function useCursorPresence({
  noteId,
  quillRef,
  stompClientRef,
  userRef,
  collaboratorsRef,
  isReviewingRef,
  collaborationModeRef,
}: UseCursorPresenceArgs) {
  const remoteCursorRangesRef = useRef<
    Map<string, { index: number; length: number }>
  >(new Map());

  function sendCursorChange(position: number, length = 0) {
    if (isReviewingRef.current) return;
    if (collaborationModeRef.current !== "COLLABORATIVE") return;

    const client = stompClientRef.current;

    if (!client?.connected) return;

    client.send(
      `/app/note/${noteId}/cursor`,
      {},
      JSON.stringify({ position, length }),
    );
  }

  function handleCursorChange(payload: CursorPayload) {
    if (
      isReviewingRef.current ||
      payload.actorEmail === userRef.current?.email
    ) {
      return;
    }

    const cursor = getCursorModule();
    if (!cursor) return;

    cursor.createCursor(
      payload.actorEmail,
      payload.actorEmail,
      collaboratorsRef.current[payload.actorEmail],
    );

    if (payload.position === -1) {
      remoteCursorRangesRef.current.delete(payload.actorEmail);
      cursor.removeCursor(payload.actorEmail);
      return;
    }

    const range = {
      index: payload.position,
      length: payload.length ?? 0,
    };

    remoteCursorRangesRef.current.set(payload.actorEmail, range);
    cursor.moveCursor(payload.actorEmail, range);
  }

  function transformRemoteCursorAgainstDelta(
    delta: Delta,
    operationActorEmail: string,
  ) {
    for (const [email, range] of remoteCursorRangesRef.current.entries()) {
      if (email === operationActorEmail) continue;

      const next = transformRangeAgainstDelta(range, delta);

      if (next.index < 0) {
        remoteCursorRangesRef.current.delete(email);
        continue;
      }

      remoteCursorRangesRef.current.set(email, next);
      renderRemoteCursor(email, next);
    }
  }

  function renderRemoteCursor(email: string, range: { index: number; length: number }) {
    const quill = quillRef.current;
    if (!quill) return;

    const cursor = getCursorModule();
    if (!cursor) return;

    cursor.createCursor(email, email, collaboratorsRef.current[email]);
    cursor.moveCursor(email, range);
  }

  function clearCollaboratorCursor(email: string) {
    const quill = quillRef.current;
    if (!quill) return;

    const cursor = getCursorModule();
    if (!cursor) return;

    cursor.removeCursor(email);

    remoteCursorRangesRef.current.delete(email);
  }

  function clearCollaboratorCursors() {
    const quill = quillRef.current;
    if (!quill) return;

    const cursor = getCursorModule();
    if (!cursor) return;

    Object.keys(collaboratorsRef.current).forEach((email) => {
      cursor.removeCursor(email);
    });

    remoteCursorRangesRef.current.clear();

    quill.root
      .querySelectorAll(".ql-cursors, .ql-cursor")
      .forEach((el) => el.remove());
  }

  function getCursorModule(): CursorModule | null {
    const quill = quillRef.current;
    if (!quill) return null;

    try {
      return quill.getModule("cursors") as CursorModule;
    } catch {
      return null;
    }
  }

  return {
    sendCursorChange,
    handleCursorChange,
    transformRemoteCursorAgainstDelta,
    clearCollaboratorCursor,
    clearCollaboratorCursors,
    getCursorModule,
    remoteCursorRangesRef,
  };
}
