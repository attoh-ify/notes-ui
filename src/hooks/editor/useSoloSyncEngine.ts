import { useEffect, useRef } from "react";
import type { CurrentRef } from "./editorHookTypes";
import type { CompatClient } from "@stomp/stompjs";
import type Quill from "quill";
import Delta from "quill-delta";
import { createOpId, type DocState } from "@/src/lib/docState";
import { OperationState, TextOperation } from "@/src/lib/textOperation";
import type { CollaborationMode, Note, SoloSyncAckPayload } from "@/src/types";
import { hasOps } from "@/src/lib/editor/editorTransforms";

const INITIAL_SEND_RETRY_DELAY_MS = 3000;
const MAX_SEND_RETRY_DELAY_MS = 10000;
const SEND_RETRY_BACKOFF_MULTIPLIER = 2;
const SOLO_SYNC_DEBOUNCE_MS = 5000;
const SOLO_SYNC_ACK_TIMEOUT_MS = 8000;

interface PendingSoloSyncAck {
  resolve: (revision: number) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface UseSoloSyncEngineArgs {
  noteId: string;
  quillRef: CurrentRef<Quill | null>;
  docStateRef: CurrentRef<DocState | null>;
  stompClientRef: CurrentRef<CompatClient | null>;
  userRef: CurrentRef<{ email: string } | null | undefined>;
  noteRef: CurrentRef<Note | null>;
  isReviewingRef: CurrentRef<boolean>;
  collaborationModeRef: CurrentRef<CollaborationMode>;
  setErrorMessage: (message: string | null) => void;
}

export function useSoloSyncEngine({
  noteId,
  quillRef,
  docStateRef,
  stompClientRef,
  userRef,
  noteRef,
  isReviewingRef,
  collaborationModeRef,
  setErrorMessage,
}: UseSoloSyncEngineArgs) {
  const pendingSoloSyncAcksRef = useRef<Map<string, PendingSoloSyncAck>>(
    new Map(),
  );
  const soloSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soloSyncInFlightPromiseRef = useRef<Promise<void> | null>(null);
  const soloSentOperationRef = useRef<TextOperation | null>(null);
  const soloPendingOperationRef = useRef<TextOperation | null>(null);
  const soloRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soloRetryDelayRef = useRef(INITIAL_SEND_RETRY_DELAY_MS);

  useEffect(() => {
    return () => {
      clearSoloSyncTimer();
      clearSoloRetryTimer();
      clearPendingSoloSyncAcks();
    };
  }, []);

  function queueSoloOperation(delta: Delta) {
    const docState = docStateRef.current;
    const currentUser = userRef.current;

    if (!docState || !currentUser) return;

    docState.document = docState.document.compose(delta);

    if (!soloSentOperationRef.current) {
      soloPendingOperationRef.current = new TextOperation(
        createOpId(),
        soloPendingOperationRef.current
          ? soloPendingOperationRef.current.delta.compose(delta)
          : delta,
        currentUser.email,
        docState.lastSyncedRevision,
        OperationState.PENDING,
        new Date().toISOString().slice(0, 19),
      );

      scheduleSoloSync();
      return;
    }

    if (!soloPendingOperationRef.current) {
      soloPendingOperationRef.current = new TextOperation(
        createOpId(),
        delta,
        currentUser.email,
        docState.lastSyncedRevision,
        OperationState.PENDING,
        new Date().toISOString().slice(0, 19),
      );
      return;
    }

    soloPendingOperationRef.current = new TextOperation(
      soloPendingOperationRef.current.opId,
      soloPendingOperationRef.current.delta.compose(delta),
      soloPendingOperationRef.current.actorEmail,
      soloPendingOperationRef.current.revision,
      soloPendingOperationRef.current.state,
      soloPendingOperationRef.current.createdAt,
    );
  }

  function handleSoloSyncAck(payload: SoloSyncAckPayload) {
    if (payload.noteId !== noteId) return;

    const pending = pendingSoloSyncAcksRef.current.get(payload.opId);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    pendingSoloSyncAcksRef.current.delete(payload.opId);

    if (!payload.success || typeof payload.revision !== "number") {
      pending.reject(new Error(payload.error || "Solo sync failed"));
      return;
    }

    pending.resolve(payload.revision);
  }

  function scheduleSoloSync(delayMs = SOLO_SYNC_DEBOUNCE_MS) {
    if (collaborationModeRef.current !== "SOLO") return;
    if (soloSentOperationRef.current) return;

    clearSoloSyncTimer();

    soloSyncTimerRef.current = setTimeout(() => {
      soloSyncTimerRef.current = null;
      void flushSoloSync();
    }, delayMs);
  }

  async function flushSoloSync(options?: {
    force?: boolean;
    throwOnError?: boolean;
  }) {
    if (!canCurrentUserEditDuringReview()) return;

    const force = options?.force === true;

    if (!force && collaborationModeRef.current !== "SOLO") return;

    if (soloSyncInFlightPromiseRef.current) {
      try {
        await soloSyncInFlightPromiseRef.current;
      } catch (err) {
        if (options?.throwOnError) throw err;
      }

      if (!force) return;
    }

    const quill = quillRef.current;
    const docState = docStateRef.current;

    if (!quill || !docState) return;

    clearSoloSyncTimer();

    const run = runSoloSync(options);
    soloSyncInFlightPromiseRef.current = run;

    try {
      await run;
    } finally {
      soloSyncInFlightPromiseRef.current = null;
    }
  }

  async function runSoloSync(options?: { throwOnError?: boolean }) {
    const docState = docStateRef.current;

    if (!docState) return;
    if (soloSentOperationRef.current) return;

    const operation = soloPendingOperationRef.current;

    if (!operation || !hasOps(operation.delta)) {
      soloPendingOperationRef.current = null;
      return;
    }

    soloPendingOperationRef.current = null;

    const operationToSend = new TextOperation(
      operation.opId,
      operation.delta,
      userRef.current!.email,
      docState.lastSyncedRevision,
      OperationState.PENDING,
      operation.createdAt,
    );

    soloSentOperationRef.current = operationToSend;

    try {
      const newRevision = await sendSoloSyncOverWebsocket(operationToSend);

      docState.lastSyncedRevision = newRevision;
      soloSentOperationRef.current = null;
      resetSoloRetryDelay();

      if (
        soloPendingOperationRef.current &&
        collaborationModeRef.current === "SOLO"
      ) {
        scheduleSoloSync(0);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to sync solo note changes");

      if (options?.throwOnError) throw err;

      scheduleSoloSyncRetry();
    }
  }

  function sendSoloSyncOverWebsocket(
    operation: TextOperation,
  ): Promise<number> {
    const client = stompClientRef.current;

    if (!client?.connected) {
      return Promise.reject(
        new Error("Cannot solo-sync while websocket is disconnected"),
      );
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingSoloSyncAcksRef.current.delete(operation.opId);
        reject(new Error("Solo sync acknowledgement timed out"));
      }, SOLO_SYNC_ACK_TIMEOUT_MS);

      pendingSoloSyncAcksRef.current.set(operation.opId, {
        resolve,
        reject,
        timeoutId,
      });

      try {
        client.send(
          `/app/note/${noteId}/solo-sync`,
          {},
          JSON.stringify(operation),
        );
      } catch (err) {
        clearTimeout(timeoutId);
        pendingSoloSyncAcksRef.current.delete(operation.opId);

        reject(
          err instanceof Error ? err : new Error("Failed to send solo sync"),
        );
      }
    });
  }

  function scheduleSoloSyncRetry(delayMs = soloRetryDelayRef.current) {
    if (soloRetryTimerRef.current) return;

    soloRetryTimerRef.current = setTimeout(async () => {
      soloRetryTimerRef.current = null;

      const op = soloSentOperationRef.current;

      if (!op) {
        resetSoloRetryDelay();
        return;
      }

      try {
        const newRevision = await sendSoloSyncOverWebsocket(op);

        const docState = docStateRef.current;
        if (docState) {
          docState.lastSyncedRevision = newRevision;
        }

        soloSentOperationRef.current = null;
        resetSoloRetryDelay();

        if (
          soloPendingOperationRef.current &&
          collaborationModeRef.current === "SOLO"
        ) {
          scheduleSoloSync(0);
        }
      } catch {
        increaseSoloRetryDelay();
        scheduleSoloSyncRetry();
      }
    }, delayMs);
  }

  function clearSoloSyncTimer() {
    if (soloSyncTimerRef.current) {
      clearTimeout(soloSyncTimerRef.current);
      soloSyncTimerRef.current = null;
    }
  }

  function clearSoloRetryTimer() {
    if (soloRetryTimerRef.current) {
      clearTimeout(soloRetryTimerRef.current);
      soloRetryTimerRef.current = null;
    }
  }

  function resetSoloRetryDelay() {
    soloRetryDelayRef.current = INITIAL_SEND_RETRY_DELAY_MS;
  }

  function increaseSoloRetryDelay() {
    soloRetryDelayRef.current = Math.min(
      soloRetryDelayRef.current * SEND_RETRY_BACKOFF_MULTIPLIER,
      MAX_SEND_RETRY_DELAY_MS,
    );
  }

  function clearPendingSoloSyncAcks() {
    for (const pending of pendingSoloSyncAcksRef.current.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Editor closed before solo sync completed"));
    }

    pendingSoloSyncAcksRef.current.clear();
  }

  function canCurrentUserEditDuringReview(): boolean {
    return !isReviewingRef.current || noteRef.current?.accessRole === "OWNER";
  }

  return {
    queueSoloOperation,
    scheduleSoloSync,
    flushSoloSync,
    runSoloSync,
    sendSoloSyncOverWebsocket,
    handleSoloSyncAck,
    scheduleSoloSyncRetry,
    clearSoloSyncTimer,
    clearSoloRetryTimer,
    clearPendingSoloSyncAcks,
    pendingSoloSyncAcksRef,
    soloSentOperationRef,
    soloPendingOperationRef,
    resetSoloRetryDelay,
  };
}
