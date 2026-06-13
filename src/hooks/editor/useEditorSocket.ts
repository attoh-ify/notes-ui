import {
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { CurrentRef } from "./editorHookTypes";
import { Stomp, type CompatClient } from "@stomp/stompjs";
import Delta from "quill-delta";
import { API_BASE_URL, apiFetch } from "@/src/lib/api";
import type { DocState } from "@/src/lib/docState";
import type { TextOperation } from "@/src/lib/textOperation";
import type {
  CollaborationMode,
  CollaborationModePayload,
  CursorPayload,
  JoinResponse,
  MessageType,
  Note,
  ReviewInProgressResponse,
  SoloSyncAckPayload,
} from "@/src/types";
import { MessageType as RelayMessageType } from "@/src/types";

const HEARTBEAT_INTERVAL_MS = 120_000;

interface UseEditorSocketArgs {
  noteId: string;
  user: { email: string } | null | undefined;
  router: { push: (href: string) => void };
  stompClientRef: CurrentRef<CompatClient | null>;
  docStateRef: CurrentRef<DocState | null>;
  collaborationModeRef: CurrentRef<CollaborationMode>;
  isOwnerRef: CurrentRef<boolean>;
  setNote: Dispatch<SetStateAction<Note | null>>;
  setCollaborators: Dispatch<SetStateAction<Record<string, string>>>;
  remoteCursorRangesRef: CurrentRef<Map<string, { index: number; length: number }>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setCollaborationMode: Dispatch<SetStateAction<CollaborationMode>>;
  setIsReviewing: Dispatch<SetStateAction<boolean>>;
  clearRemoteOperationState: () => void;
  onOperation: (payload: TextOperation) => void;
  onCursorChange: (payload: CursorPayload) => void;
  onSoloSyncAck: (payload: SoloSyncAckPayload) => void;
  onCollaborationModeChange: (payload: CollaborationModePayload) => void;
  onReviewStateChange: (payload: ReviewInProgressResponse) => void;
  clearCollaboratorCursor: (email: string) => void;
}

export function useEditorSocket({
  noteId,
  user,
  router,
  stompClientRef,
  docStateRef,
  collaborationModeRef,
  isOwnerRef,
  setNote,
  setCollaborators,
  remoteCursorRangesRef,
  setIsLoading,
  setErrorMessage,
  setCollaborationMode,
  setIsReviewing,
  clearRemoteOperationState,
  onOperation,
  onCursorChange,
  onSoloSyncAck,
  onCollaborationModeChange,
  onReviewStateChange,
  clearCollaboratorCursor,
}: UseEditorSocketArgs) {
  const callbacksRef = useRef({
    clearRemoteOperationState,
    onOperation,
    onCursorChange,
    onSoloSyncAck,
    onCollaborationModeChange,
    onReviewStateChange,
  });

  useEffect(() => {
    callbacksRef.current = {
      clearRemoteOperationState,
      onOperation,
      onCursorChange,
      onSoloSyncAck,
      onCollaborationModeChange,
      onReviewStateChange,
    };
  });

  useEffect(() => {
    if (!noteId || !user) return;

    let client: CompatClient | null = null;
    let cancelled = false;
    let collaborationReady = false;
    let preReadyRelayBuffer: Array<{ type: MessageType; payload: any }> = [];

    function processRelayMessage(type: MessageType, payload: any) {
      if (type === RelayMessageType.OPERATION) {
        callbacksRef.current.onOperation(payload);
        return;
      }

      if (type === RelayMessageType.COLLABORATOR_JOIN) {
        setCollaborators(payload.collaborators);

        const currentEmail = user!.email;
        const isAllowed = Object.hasOwn(payload.collaborators, currentEmail);

        if (!isAllowed) {
          clearCollaboratorCursor(currentEmail);
          router.push("/notes");
        }

        const activeCollaboratorEmails = new Set(Object.keys(payload.collaborators));
        
        for (const email of Array.from(remoteCursorRangesRef.current.keys())) {
          const isStillActive = activeCollaboratorEmails.has(email);

          if (!isStillActive) {
            clearCollaboratorCursor(email);
          }
        }
        return;
      }

      if (type === RelayMessageType.COLLABORATOR_CURSOR) {
        callbacksRef.current.onCursorChange(payload);
        return;
      }

      if (type === RelayMessageType.REVIEW_IN_PROGRESS) {
        callbacksRef.current.onReviewStateChange(payload);
        return;
      }

      if (type === RelayMessageType.COLLABORATION_MODE) {
        callbacksRef.current.onCollaborationModeChange(payload);
        return;
      }

      if (type === RelayMessageType.SOLO_SYNC_ACK) {
        callbacksRef.current.onSoloSyncAck(payload);
      }
    }

    function handleRelayMessage(type: MessageType, payload: any) {
      if (!collaborationReady) {
        preReadyRelayBuffer.push({ type, payload });
        return;
      }

      processRelayMessage(type, payload);
    }

    function drainPreReadyRelayBuffer() {
      const buffered = preReadyRelayBuffer;
      preReadyRelayBuffer = [];

      for (const message of buffered) {
        processRelayMessage(message.type, message.payload);
      }
    }

    async function start() {
      const { default: SockJS } = await import("sockjs-client");

      if (cancelled) return;

      client = Stomp.over(
        () => new SockJS(`${API_BASE_URL}/relay?noteId=${noteId}`),
      );

      client.debug = () => {};
      stompClientRef.current = client;

      client.connect(
        {},
        async () => {
          try {
            client!.subscribe(`/topic/note/${noteId}`, (message) => {
              const { type, payload } = JSON.parse(message.body);
              handleRelayMessage(type, payload);
            });

            const noteData = await apiFetch<Note>(`notes/${noteId}`, {
              method: "GET",
            });

            if (cancelled) return;

            setNote(noteData);

            if (noteData.accessRole === "VIEWER") {
              router.push(`/notes/${noteId}`);
              return;
            }

            const joinData = await apiFetch<JoinResponse>(
              `notes/${noteId}/join`,
              { method: "GET" },
            );

            const mode = joinData.mode ?? "SOLO";
            setCollaborationMode(mode);
            collaborationModeRef.current = mode;

            if (cancelled) return;

            docStateRef.current!.lastSyncedRevision = joinData.revision;
            callbacksRef.current.clearRemoteOperationState();

            const cleanDelta = new Delta(joinData.delta.ops || []);
            docStateRef.current!.setDocument(cleanDelta);

            setCollaborators(joinData.collaborators);
            isOwnerRef.current = noteData.accessRole === "OWNER";
            setIsReviewing(joinData.isReviewing === true);
            setIsLoading(false);

            collaborationReady = true;
            drainPreReadyRelayBuffer();
          } catch (err: any) {
            setErrorMessage(err.message || "Failed to load note");
            setIsLoading(false);
          }
        },
        (error: any) => {
          console.error("Websocket auth failed", error);
          router.push("/notes");
          setErrorMessage(String(error));
        },
      );
    }

    start();

    return () => {
      cancelled = true;
      collaborationReady = false;
      preReadyRelayBuffer = [];

      if (client?.active) {
        client.disconnect();
      }
    };
  }, [
    noteId,
    user,
    router,
    stompClientRef,
    docStateRef,
    collaborationModeRef,
    isOwnerRef,
    setNote,
    setCollaborators,
    setIsLoading,
    setErrorMessage,
    setCollaborationMode,
    setIsReviewing,
  ]);

  useEffect(() => {
    if (!noteId || !user) return;

    const intervalId = window.setInterval(() => {
      const client = stompClientRef.current;

      if (!client?.connected) return;

      client.send(`/app/note/${noteId}/heartbeat`, {}, JSON.stringify({}));
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [noteId, user, stompClientRef]);
}
