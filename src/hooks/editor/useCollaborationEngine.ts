import { useEffect, useRef } from "react";
import type { CurrentRef } from "./editorHookTypes";
import type { CompatClient } from "@stomp/stompjs";
import type Quill from "quill";
import Delta from "quill-delta";
import type { CollaborationMode, Note } from "@/src/types";
import type { DocState } from "@/src/lib/docState";
import { OperationState, TextOperation } from "@/src/lib/textOperation";

const INITIAL_SEND_RETRY_DELAY_MS = 3000;
const MAX_SEND_RETRY_DELAY_MS = 10000;
const SEND_RETRY_BACKOFF_MULTIPLIER = 2;

interface PendingSoloSyncAck {
  resolve: (revision: number) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface UseCollaborationEngineArgs {
  noteId: string;
  quillRef: CurrentRef<Quill | null>;
  docStateRef: CurrentRef<DocState | null>;
  stompClientRef: CurrentRef<CompatClient | null>;
  userRef: CurrentRef<{ email: string } | null | undefined>;
  noteRef: CurrentRef<Note | null>;
  isReviewingRef: CurrentRef<boolean>;
  collaborationModeRef: CurrentRef<CollaborationMode>;
  pendingSoloSyncAcksRef: CurrentRef<Map<string, PendingSoloSyncAck>>;
  soloSentOperationRef: CurrentRef<TextOperation | null>;
  soloPendingOperationRef: CurrentRef<TextOperation | null>;
  clearSoloRetryTimer: () => void;
  resetSoloRetryDelay: () => void;
  scheduleSoloSync: (delayMs?: number) => void;
  transformRemoteCursorAgainstDelta: (
    delta: Delta,
    operationActorEmail: string,
  ) => void;
}

export function useCollaborationEngine({
  noteId,
  quillRef,
  docStateRef,
  stompClientRef,
  userRef,
  noteRef,
  isReviewingRef,
  collaborationModeRef,
  pendingSoloSyncAcksRef,
  soloSentOperationRef,
  soloPendingOperationRef,
  clearSoloRetryTimer,
  resetSoloRetryDelay,
  scheduleSoloSync,
  transformRemoteCursorAgainstDelta,
}: UseCollaborationEngineArgs) {
  const isSendingRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(INITIAL_SEND_RETRY_DELAY_MS);
  const processedOperationIdsRef = useRef<Set<string>>(new Set());
  const pendingRemoteOpsRef = useRef<Map<number, TextOperation>>(new Map());

  useEffect(() => {
    return () => {
      clearSendRetryTimer();
    };
  }, []);

  function handleRemoteOperation(payload: TextOperation) {
    const { opId, revision, actorEmail } = payload;
    const docState = docStateRef.current;

    if (!docState) return;

    if (!opId) {
      console.error("Received operation without opId. Ignoring for safety.", payload);
      return;
    }

    if (hasProcessedOperation(opId)) {
      console.warn("Duplicate operation relay ignored", {
        opId,
        revision,
        actorEmail,
      });
      return;
    }

    const expectedRevision = docState.lastSyncedRevision + 1;

    if (revision <= docState.lastSyncedRevision) {
      console.warn("STALE_REMOTE_OP_IGNORED", {
        opId,
        actorEmail,
        receivedRevision: revision,
        lastSyncedRevision: docState.lastSyncedRevision,
        expectedRevision,
      });

      markOperationProcessed(opId);
      return;
    }

    if (revision > expectedRevision) {
      console.error("REVISION_GAP_DETECTED_BUFFERING", {
        opId,
        actorEmail,
        receivedRevision: revision,
        lastSyncedRevision: docState.lastSyncedRevision,
        expectedRevision,
        missingRevisions: {
          from: expectedRevision,
          to: revision - 1,
        },
      });

      bufferFutureRemoteOperation(payload);
      return;
    }

    processRemoteOperationInOrder(payload);
    drainPendingRemoteOperations();
  }

  async function sendOperationToServer(operation: TextOperation) {
    if (!canCurrentUserEditDuringReview()) return;

    if (!stompClientRef.current?.connected) {
      throw new Error("Cannot send operation while websocket is disconnected");
    }

    if (isSendingRef.current) {
      throw new Error("Concurrent operation send detected");
    }

    isSendingRef.current = true;

    try {
      sendOperationOverWebsocket(operation);
    } finally {
      isSendingRef.current = false;
    }
  }

  function sendOperationOverWebsocket(operation: TextOperation) {
    const client = stompClientRef.current;

    if (!client?.connected) {
      throw new Error("Cannot send operation while websocket is disconnected");
    }

    client.send(
      `/app/note/${noteId}/operation`,
      {},
      JSON.stringify(
        new TextOperation(
          operation.opId,
          operation.delta,
          userRef.current!.email,
          operation.revision,
          OperationState.PENDING,
          operation.createdAt,
        ),
      ),
    );
  }

  function processRemoteOperationInOrder(payload: TextOperation) {
    const { opId, delta, actorEmail, revision, state, createdAt } = payload;
    const docState = docStateRef.current;

    if (!docState || !opId) return;

    if (hasProcessedOperation(opId)) {
      console.warn("Duplicate operation ignored during ordered processing", {
        opId,
        revision,
        actorEmail,
      });
      return;
    }

    const pendingSoloAck = pendingSoloSyncAcksRef.current.get(opId);

    if (pendingSoloAck && actorEmail === userRef.current?.email) {
      clearTimeout(pendingSoloAck.timeoutId);
      pendingSoloSyncAcksRef.current.delete(opId);

      clearSoloRetryTimer();
      resetSoloRetryDelay();

      soloSentOperationRef.current = null;
      docState.lastSyncedRevision = revision;
      pendingSoloAck.resolve(revision);
      markOperationProcessed(opId);

      if (soloPendingOperationRef.current && collaborationModeRef.current === "SOLO") {
        scheduleSoloSync(0);
      }

      return;
    }

    const isAckForThisTab =
      actorEmail === userRef.current?.email &&
      docState.sentOperation?.opId === opId;

    if (isAckForThisTab) {
      clearSendRetryTimer();
      resetSendRetryDelay();

      docState.acknowledgeOperation(revision, (pending) => {
        if (pending) {
          void sendOrRetry(pending);
        }
      });

      markOperationProcessed(opId);
      return;
    }

    const d = docState.applyRemoteOperation({
      opId,
      delta: new Delta(delta.ops || []),
      actorEmail,
      revision,
      state,
      createdAt,
    });

    quillRef.current?.updateContents(d, "api");

    transformRemoteCursorAgainstDelta(d, actorEmail);

    markOperationProcessed(opId);
  }

  function drainPendingRemoteOperations() {
    const docState = docStateRef.current;
    if (!docState) return;

    while (true) {
      const nextRevision = docState.lastSyncedRevision + 1;
      const nextOp = pendingRemoteOpsRef.current.get(nextRevision);

      if (!nextOp) return;

      pendingRemoteOpsRef.current.delete(nextRevision);

      console.log("DRAINING_BUFFERED_REMOTE_OP", {
        opId: nextOp.opId,
        actorEmail: nextOp.actorEmail,
        revision: nextOp.revision,
        nextExpectedRevision: nextRevision,
      });

      processRemoteOperationInOrder(nextOp);
    }
  }

  function bufferFutureRemoteOperation(payload: TextOperation) {
    const existing = pendingRemoteOpsRef.current.get(payload.revision);

    if (existing && existing.opId !== payload.opId) {
      console.error("Revision collision detected: two different ops for same revision", {
        revision: payload.revision,
        existingOpId: existing.opId,
        incomingOpId: payload.opId,
        existing,
        incoming: payload,
      });

      return;
    }

    pendingRemoteOpsRef.current.set(payload.revision, payload);

    console.warn("REMOTE_OP_BUFFERED_FOR_GAP", {
      opId: payload.opId,
      actorEmail: payload.actorEmail,
      receivedRevision: payload.revision,
      lastSyncedRevision: docStateRef.current?.lastSyncedRevision,
      expectedRevision: (docStateRef.current?.lastSyncedRevision ?? 0) + 1,
      bufferedRevisions: [...pendingRemoteOpsRef.current.keys()].sort((a, b) => a - b),
    });
  }

  function hasProcessedOperation(opId?: string | null): boolean {
    if (!opId) return false;
    return processedOperationIdsRef.current.has(opId);
  }

  function markOperationProcessed(opId?: string | null) {
    if (!opId) return;
    processedOperationIdsRef.current.add(opId);
  }

  function clearRemoteOperationState() {
    pendingRemoteOpsRef.current.clear();
    processedOperationIdsRef.current.clear();
  }

  function clearSendRetryTimer() {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }

  function resetSendRetryDelay() {
    retryDelayRef.current = INITIAL_SEND_RETRY_DELAY_MS;
  }

  function increaseSendRetryDelay() {
    retryDelayRef.current = Math.min(
      retryDelayRef.current * SEND_RETRY_BACKOFF_MULTIPLIER,
      MAX_SEND_RETRY_DELAY_MS,
    );
  }

  function scheduleSendRetry(delayMs = retryDelayRef.current) {
    if (retryTimerRef.current) return;

    retryTimerRef.current = setTimeout(async () => {
      retryTimerRef.current = null;

      const op = docStateRef.current?.sentOperation;

      if (!op) {
        resetSendRetryDelay();
        return;
      }

      try {
        await sendOperationToServer(op);
        resetSendRetryDelay();
      } catch (err) {
        console.error("Retry send failed", {
          opId: op.opId,
          revision: op.revision,
          err,
        });

        increaseSendRetryDelay();
        scheduleSendRetry();
      }
    }, delayMs);
  }

  async function sendOrRetry(operation: TextOperation) {
    try {
      await sendOperationToServer(operation);
      resetSendRetryDelay();
    } catch (err) {
      console.error("Send failed; scheduling retry", {
        opId: operation.opId,
        revision: operation.revision,
        err,
      });

      scheduleSendRetry();
    }
  }

  function canCurrentUserEditDuringReview(): boolean {
    return !isReviewingRef.current || noteRef.current?.accessRole === "OWNER";
  }

  return {
    handleRemoteOperation,
    sendOperationToServer,
    sendOperationOverWebsocket,
    processRemoteOperationInOrder,
    drainPendingRemoteOperations,
    bufferFutureRemoteOperation,
    hasProcessedOperation,
    markOperationProcessed,
    scheduleSendRetry,
    sendOrRetry,
    clearSendRetryTimer,
    clearRemoteOperationState,
  };
}
