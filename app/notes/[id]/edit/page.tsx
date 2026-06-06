"use client";

import { API_BASE_URL, apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, Suspense, useCallback } from "react";
import { Stomp, CompatClient } from "@stomp/stompjs";
import { createOpId, DocState } from "@/src/lib/docState";
import { OperationState, TextOperation } from "@/src/lib/textOperation";
import { useAuth } from "@/src/context/AuthContext";
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import Delta from "quill-delta";
import { registerFormats } from "../../../../src/lib/quillformats";
import {
  CursorModule,
  CursorPayload,
  FormatSuggestionItem,
  JoinResponse,
  MessageType,
  Note,
  ReviewAction,
  ReviewEntry,
  ReviewInProgressResponse,
  ReviewProjection,
  ReviewSegment,
  TooltipState,
  Reference,
  ReviewDecisionReference,
  BlockFormatSuggestionItem, 
  ReviewFormatSuggestion,
  CollaborationMode,
  SoloSyncAckPayload,
  CollaborationModePayload,
} from "../../../../src/types";
import { ReviewTooltip } from "@/components/ReviewTooltip";
import ExitReviewModal from "@/components/ExitReviewModal";
import FormatSidebarModal from "@/components/FormatSidebarModal";
import {
  deleteInsertGroupSegments,
  deleteNewlineGroupSegmentsPreservingBlockFormats,
  deltaToSegments,
  findDeleteGroupRangeInRuntime,
  findInsertGroupRangeInRuntime,
  findNewlineGroupRangeInRuntime,
  getSuggestionSelector,
  mergeAdjacentSegments,
  removeInsertSuggestionFromSegments,
  removeNewlineSuggestionFromSegments,
  resolveBlockFormatSuggestionsAfterNewlineDeletion,
  resolveFormatSuggestionsAfterMutation,
  resolveNewlineSuggestionsAfterDependencyChange,
  restoreRejectedDeleteSegments,
  collectSuggestionReferencesByGroup,
  segmentLength,
  resolveFormatSuggestionsAfterRuntimeDeletion,
  resolveBlockFormatSuggestionsAfterNewlineDecision,
} from "@/src/lib/attribution";
import {
  clearActiveFormatOverlay,
  nextRuntimeSegmentId,
  refreshBlockPreviewTextsAgainstRuntime,
  refreshEditorFromRuntime,
  refreshPreviewTextsAgainstRuntime,
} from "@/src/lib/review/runtimeHelpers";
import {
  acceptBlockFormatSuggestion,
  acceptFormatSuggestion,
  activateFormatSuggestion,
  closeReviewTooltip,
  rejectBlockFormatSuggestion,
  rejectFormatSuggestion,
} from "@/src/lib/review/formatSuggestionEngine";
import { snapshotAndApply, undo } from "@/src/lib/review/reviewHistory";
import CollaboratorsModal from "@/components/CollaboratorsSection";
import VisibilityModal from "@/components/VisibilityModal";
import { Badge, Button, EmptyState, ErrorBanner, LoadingState } from "@/components/ui";

const INITIAL_SEND_RETRY_DELAY_MS = 3000;
const MAX_SEND_RETRY_DELAY_MS = 10000;
const SEND_RETRY_BACKOFF_MULTIPLIER = 2;
const HEARTBEAT_INTERVAL_MS = 120_000;
const SOLO_SYNC_DEBOUNCE_MS = 5000;
const SOLO_SYNC_ACK_TIMEOUT_MS = 8000;

function hasOps(delta: Delta): boolean {
  return Array.isArray(delta.ops) && delta.ops.length > 0;
}

function EditContent() {
  const { id: noteId } = useParams();
  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(null);
  const [collaborators, setCollaborators] = useState<Record<string, string>>({});
  const [isLoading, setIsloading] = useState(true);
  const [errorMessage, setErrorMessageMessage] = useState<string | null>(null);

  const [isReviewing, setIsReviewing] = useState<boolean>(false);
  const [formatSuggestions, setFormatSuggestions] = useState<FormatSuggestionItem[]>([]);
  const [blockFormatSuggestions, setBlockFormatSuggestions] = useState<BlockFormatSuggestionItem[]>([]);
  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<TooltipState | null>(null);
  const [showExitReviewModal, setShowExitReviewModal] = useState(false);
  const [showReviewSidebarModal, setShowReviewSidebarModal] = useState(false);
  const [hasPendingSuggestions, setHasPendingSuggestions] = useState(false);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [showCollaboratorsModal, setShowCollaboratorsModal] = useState(false);
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>("SOLO");
  
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const initializingEditorRef = useRef(false);
  const docStateRef = useRef<DocState | null>(null);
  const stompClientRef = useRef<CompatClient | null>(null);
  const isOwner = useRef<boolean>(false);
  const reviewHistory = useRef<ReviewEntry[]>([]);
  const acceptedReferences = useRef<ReviewDecisionReference[][]>([]);
  const rejectedReferences = useRef<ReviewDecisionReference[][]>([]);
  const reviewSegmentsRef = useRef<ReviewSegment[]>([]);
  const runtimeSegCtrRef = useRef(0);
  const isReviewingRef = useRef(false);
  const collaborationModeRef = useRef<CollaborationMode>("SOLO");
  const pendingSoloSyncAcksRef = useRef<
    Map<
      string,
      {
        resolve: (revision: number) => void;
        reject: (error: Error) => void;
        timeoutId: ReturnType<typeof setTimeout>;
      }
    >
  >(new Map());

  const formatSuggestionsRef = useRef<FormatSuggestionItem[]>([]);
  const blockFormatSuggestionsRef = useRef<BlockFormatSuggestionItem[]>([]);
  const activeFormatIdRef = useRef<string | null>(null);
  const activeSuggestionRef = useRef<TooltipState | null>(null);
  const collaboratorsRef = useRef<Record<string, string>>({});
  const noteRef = useRef<Note | null>(null);
  const userRef = useRef(user);
  const isSendingRef = useRef(false);
  
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(INITIAL_SEND_RETRY_DELAY_MS);
  const processedOperationIdsRef = useRef<Set<string>>(new Set());
  const pendingRemoteOpsRef = useRef<Map<number, TextOperation>>(new Map());
  const collaborationReadyRef = useRef(false);
  const preReadyRelayBufferRef = useRef<Array<{ type: MessageType; payload: any }>>([]);
  const soloSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soloSyncInFlightPromiseRef = useRef<Promise<void> | null>(null);
  const soloSentOperationRef = useRef<TextOperation | null>(null);
  const soloPendingOperationRef = useRef<TextOperation | null>(null);
  const soloRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soloRetryDelayRef = useRef(INITIAL_SEND_RETRY_DELAY_MS);
  
  useEffect(() => { collaborationModeRef.current = collaborationMode; }, [collaborationMode]);
  useEffect(() => { formatSuggestionsRef.current = formatSuggestions; }, [formatSuggestions]);
  useEffect(() => { blockFormatSuggestionsRef.current = blockFormatSuggestions; }, [blockFormatSuggestions]);
  useEffect(() => { activeFormatIdRef.current = activeFormatId; }, [activeFormatId]);
  useEffect(() => { activeSuggestionRef.current = activeSuggestion; }, [activeSuggestion]);
  useEffect(() => { collaboratorsRef.current = collaborators; }, [collaborators]);
  useEffect(() => { noteRef.current = note; }, [note]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { isReviewingRef.current = isReviewing; }, [isReviewing]);

  const getReviewCtx = () => ({
    quill: quillRef.current,
    runtimeSegCtrRef,
    reviewSegmentsRef,
    formatSuggestionsRef,
    blockFormatSuggestionsRef,
    activeSuggestionRef,
    activeFormatIdRef,
  });

  if (!docStateRef.current && user) {
    docStateRef.current = new DocState(user.email);
  }

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;

    quill.root
      .querySelectorAll(".active")
      .forEach((el) => el.classList.remove("active"));

    if (activeSuggestion?.groupId) {
      const selector = getSuggestionSelector(
        activeSuggestion.groupId,
        activeSuggestion.type,
      );
      quill.root.querySelectorAll(selector).forEach((el) => {
        el.classList.add("active");
      });
    }
  }, [activeSuggestion]);

  useEffect(() => {
    const shouldShowEditor = !isReviewing || note?.accessRole === "OWNER";

    if (
      !isLoading &&
      editorRef.current &&
      !quillRef.current &&
      !initializingEditorRef.current &&
      shouldShowEditor
    ) {
      const init = async () => {
        initializingEditorRef.current = true;
        const { default: Q } = await import("quill");
        const { default: QCursors } = await import("quill-cursors");
        Q.register("modules/cursors", QCursors);
        registerFormats(Q);

        const toolbarOptions = [
          [{ font: [] }],
          [{ header: [1, 2, 3, 4, 5, 6, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ color: [] }, { background: [] }],
          [
            { align: "" },
            { align: "center" },
            { align: "right" },
            { align: "justify" },
          ],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ indent: "-1" }, { indent: "+1" }],
          ["blockquote", "code-block"],
          ["link", "image"],
          ["clean"],
        ];

        quillRef.current = new Q(editorRef.current!, {
          theme: "snow",
          readOnly: isReviewing,
          modules: { toolbar: toolbarOptions, cursors: true },
          placeholder: "Start typing...",
        });

        if (docStateRef.current?.document) {
          quillRef.current.setContents(docStateRef.current.document, "api");
        }

        quillRef.current.on("text-change", (delta, _old, source) => {
          if (source !== "user") return;

          const range = quillRef.current?.getSelection();
          if (range) sendCursorChange(range.index ?? -1);

          if (collaborationModeRef.current === "SOLO") {
            queueSoloOperation(delta);
            return;
          }

          docStateRef.current?.queueOperation(
            delta,
            async (op: TextOperation) => {
              await sendOrRetry(op);
            },
          );
        });

        quillRef.current.on("selection-change", async (range, _old, source) => {
          if (source !== "user" || !range) return;
          sendCursorChange(range.index ?? -1);
        });
      };

      init().finally(() => {
        initializingEditorRef.current = false;
      });
    }
  }, [isLoading, isReviewing, note?.accessRole]);
  
  useEffect(() => {
    if (!noteId || !user) return;

    let client: CompatClient | null = null;
    let cancelled = false;

    collaborationReadyRef.current = false;
    preReadyRelayBufferRef.current = [];

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

            setCollaborationMode(joinData.mode ?? "SOLO");
            collaborationModeRef.current = joinData.mode ?? "SOLO";

            if (cancelled) return;

            docStateRef.current!.lastSyncedRevision = joinData.revision;

            pendingRemoteOpsRef.current.clear();
            processedOperationIdsRef.current.clear();

            const cleanDelta = new Delta(joinData.delta.ops || []);
            docStateRef.current!.setDocument(cleanDelta);

            setCollaborators(joinData.collaborators);

            isOwner.current = noteData.accessRole === "OWNER";

            setIsReviewing(joinData.isReviewing === true);
            setIsloading(false);

            collaborationReadyRef.current = true;
            drainPreReadyRelayBuffer();
          } catch (err: any) {
            setErrorMessageMessage(err.message || "Failed to load note");
            setIsloading(false);
          }
        },
        (error: any) => {
          console.error("Websocket auth failed", error);
          router.push("/notes");
          setErrorMessageMessage(String(error));
        },
      );
    }

    start();

    return () => {
      cancelled = true;
      collaborationReadyRef.current = false;
      preReadyRelayBufferRef.current = [];

      if (client?.active) {
        client.disconnect();
      }
    };
  }, [noteId, user]);

  useEffect(() => {
    if (!noteId || !user) return;

    const intervalId = window.setInterval(() => {
      const client = stompClientRef.current;

      if (!client?.connected) return;

      client.send(
        `/app/note/${noteId}/heartbeat`,
        {},
        JSON.stringify({}),
      );
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [noteId, user]);

  useEffect(() => {
    return () => {
      clearSendRetryTimer();
      clearSoloSyncTimer();
      clearSoloRetryTimer();
      clearPendingSoloSyncAcks();
    };
  }, []);

  function processRelayMessage(type: MessageType, payload: any) {
    if (type === MessageType.OPERATION) {
      handleRemoteOperation(payload);
      return;
    }

    if (type === MessageType.COLLABORATOR_JOIN) {
      setCollaborators(payload.collaborators);

      const currentEmail = userRef.current?.email;
      if (!currentEmail) return;

      const isAllowed = Object.hasOwn(payload.collaborators, currentEmail);

      if (!isAllowed) {
        router.push("/notes");
      }

      return;
    }

    if (type === MessageType.COLLABORATOR_CURSOR) {
      handleCursorChange(payload);
      return;
    }

    if (type === MessageType.REVIEW_IN_PROGRESS) {
      handleReviewInProgress(payload);
    }

    if (type === MessageType.COLLABORATION_MODE) {
      handleCollaborationModeChange(payload);
      return;
    }

    if (type === MessageType.SOLO_SYNC_ACK) {
      handleSoloSyncAck(payload);
      return;
    }
  }

  function queueSoloOperation(delta: Delta) {
    const docState = docStateRef.current;
    const user = userRef.current;

    if (!docState || !user) return;

    docState.document = docState.document.compose(delta);

    if (!soloSentOperationRef.current) {
      soloPendingOperationRef.current = new TextOperation(
        createOpId(),
        soloPendingOperationRef.current
          ? soloPendingOperationRef.current.delta.compose(delta)
          : delta,
        user.email,
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
        user.email,
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
      pending.reject(
        new Error(payload.error || "Solo sync failed"),
      );
      return;
    }

    pending.resolve(payload.revision);
  }

  function handleCollaborationModeChange(payload: CollaborationModePayload) {
    if (payload.noteId !== noteId) return;

    const previous = collaborationModeRef.current;
    const next = payload.mode;

    if (previous === next) return;

    if (next === "COLLABORATIVE") {
      void promoteToCollaborativeMode();
      return;
    }

    if (next === "SOLO") {
      const docState = docStateRef.current;

      if (docState?.sentOperation || docState?.pendingOperation) {
        /*
        * Wait briefly. The server ack should still arrive through the socket.
        * Do not enter solo mode while collaborative ops are unresolved.
        */
        setTimeout(() => {
          handleCollaborationModeChange(payload);
        }, 500);

        return;
      }

      collaborationModeRef.current = "SOLO";
      setCollaborationMode("SOLO");
    }
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
    if (isReviewingRef.current) return;

    const force = options?.force === true;

    if (!force && collaborationModeRef.current !== "SOLO") return;

    if (soloSyncInFlightPromiseRef.current) {
      try {
        await soloSyncInFlightPromiseRef.current;
      } catch (err) {
        if (options?.throwOnError) {
          throw err;
        }
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

    if (soloSentOperationRef.current) {
      return;
    }

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

      if (soloPendingOperationRef.current && collaborationModeRef.current === "SOLO") {
        scheduleSoloSync(0);
      }
    } catch (err: any) {
      setErrorMessageMessage(err.message || "Failed to sync solo note changes");

      if (options?.throwOnError) {
        throw err;
      }

      scheduleSoloSyncRetry();
    }
  }

  function clearPendingSoloSyncAcks() {
    for (const pending of pendingSoloSyncAcksRef.current.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error("Editor closed before solo sync completed"));
    }

    pendingSoloSyncAcksRef.current.clear();
  }

  async function promoteToCollaborativeMode() {
    const quill = quillRef.current;
    const docState = docStateRef.current;

    if (!quill || !docState) return;

    try {
      quill.enable(false);

      /*
      * Important:
      * We are still logically SOLO until this flush completes.
      */
      await flushSoloSync({ force: true, throwOnError: true });

      const joinData = await apiFetch<JoinResponse>(
        `notes/${noteId}/join`,
        { method: "GET" },
      );

      const cleanDelta = new Delta(joinData.delta.ops || []);

      docState.lastSyncedRevision = joinData.revision;
      docState.setDocument(cleanDelta);
      docState.resetPendingState();

      pendingRemoteOpsRef.current.clear();
      processedOperationIdsRef.current.clear();

      setCollaborators(joinData.collaborators);

      quill.setContents(cleanDelta, "api");

      collaborationModeRef.current = "COLLABORATIVE";
      setCollaborationMode("COLLABORATIVE");
    } catch (err: any) {
      setErrorMessageMessage(
        err.message || "Failed to switch into collaboration mode",
      );
    } finally {
      if (!isReviewingRef.current) {
        quill.enable(true);
      }
    }
  }

  function clearSoloSyncTimer() {
    if (soloSyncTimerRef.current) {
      clearTimeout(soloSyncTimerRef.current);
      soloSyncTimerRef.current = null;
    }
  }

  function sendSoloSyncOverWebsocket(operation: TextOperation): Promise<number> {
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
          err instanceof Error
            ? err
            : new Error("Failed to send solo sync"),
        );
      }
    });
  }

  function handleRelayMessage(type: MessageType, payload: any) {
    if (!collaborationReadyRef.current) {
      preReadyRelayBufferRef.current.push({ type, payload });
      return;
    }

    processRelayMessage(type, payload);
  }

  function drainPreReadyRelayBuffer() {
    const buffered = preReadyRelayBufferRef.current;
    preReadyRelayBufferRef.current = [];

    for (const message of buffered) {
      processRelayMessage(message.type, message.payload);
    }
  }

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;

    const toolbar = editorRef.current?.previousSibling as HTMLElement;
    const isToolbar = toolbar?.classList.contains("ql-toolbar");

    if (isReviewing) {
      quill.enable(false);
      if (isToolbar) toolbar.style.display = "none";
    } else {
      quill.enable(true);
      if (isToolbar) toolbar.style.display = "block";
    }
  }, [isReviewing, isLoading]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill || !isReviewing) return;

    let hoveredGroupId: string | null = null;
    let hoveredType: TooltipState["type"] | null = null;

    const setGroupHoverState = (
      groupId: string | null,
      isActive: boolean,
      type: TooltipState["type"] | null,
    ) => {
      if (!groupId || !type) return;
      const selector = getSuggestionSelector(groupId, type);
      quill.root.querySelectorAll(selector).forEach((el) => {
        if (isActive) el.classList.add("hover");
        else el.classList.remove("hover");
      });
    };

    const onMouseOver = (e: Event) => {
      const target = e.target as HTMLElement;
      const node = target.closest(
        "[data-suggestion-type][data-group-id]",
      ) as HTMLElement | null;

      const nextGroupId = node?.getAttribute("data-group-id") ?? null;
      const rawType = node?.getAttribute("data-suggestion-type") ?? null;
      const nextType =
        rawType === "insert" ||
        rawType === "newline" ||
        rawType === "delete" ||
        rawType === "format"
          ? (rawType as TooltipState["type"])
          : null;

      if (hoveredGroupId === nextGroupId && hoveredType === nextType) return;

      if (
        hoveredGroupId &&
        hoveredType &&
        hoveredGroupId !== activeSuggestionRef.current?.groupId
      ) {
        setGroupHoverState(hoveredGroupId, false, hoveredType);
      }

      hoveredGroupId = nextGroupId;
      hoveredType = nextType;

      if (
        hoveredGroupId &&
        hoveredType &&
        hoveredGroupId !== activeSuggestionRef.current?.groupId
      ) {
        setGroupHoverState(hoveredGroupId, true, hoveredType);
      }
    };

    const onMouseLeave = () => {
      if (
        hoveredGroupId &&
        hoveredType &&
        hoveredGroupId !== activeSuggestionRef.current?.groupId
      ) {
        setGroupHoverState(hoveredGroupId, false, hoveredType);
      }
      hoveredGroupId = null;
      hoveredType = null;
    };

    quill.root.addEventListener("mouseover", onMouseOver);
    quill.root.addEventListener("mouseleave", onMouseLeave);

    return () => {
      quill.root.removeEventListener("mouseover", onMouseOver);
      quill.root.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [isReviewing]);

  const handleClick = useCallback((e: Event) => {
    const target = (e as MouseEvent).target as HTMLElement;
    const node = target.closest(
      "[data-suggestion-type][data-group-id]",
    ) as HTMLElement | null;

    deactivateActiveFormatSuggestion();

    if (!node) {
      setActiveSuggestionSync(null);
      return;
    }

    const rawType = node.getAttribute("data-suggestion-type");

    const type =
      rawType === "insert" ||
      rawType === "newline" ||
      rawType === "delete" ||
      rawType === "format"
        ? rawType
        : null;

    if (!type) return;
    if (type === "format") return;

    const groupId = node.getAttribute("data-group-id")!;
    const actorEmail = node.getAttribute("data-actor-email")!;
    const createdAt = node.getAttribute("data-created-at")!;
    const references = JSON.parse(node.getAttribute("data-references") ?? "[]");

    setActiveSuggestionSync(
      activeSuggestionRef.current?.groupId === groupId
        ? null
        : { groupId, type, actorEmail, createdAt, references },
    );
  }, []);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    return () => {
      quill.root.removeEventListener("click", handleClick);
    };
  }, [handleClick]);
  
  function setFormatSuggestionsSync(
    next:
      | FormatSuggestionItem[]
      | ((prev: FormatSuggestionItem[]) => FormatSuggestionItem[]),
  ) {
    const resolved =
      typeof next === "function"
        ? next(formatSuggestionsRef.current)
        : next;

    formatSuggestionsRef.current = resolved;
    setFormatSuggestions(resolved);
  }

  function setBlockFormatSuggestionsSync(
    next:
      | BlockFormatSuggestionItem[]
      | ((prev: BlockFormatSuggestionItem[]) => BlockFormatSuggestionItem[]),
  ) {
    const resolved =
      typeof next === "function"
        ? next(blockFormatSuggestionsRef.current)
        : next;

    blockFormatSuggestionsRef.current = resolved;
    setBlockFormatSuggestions(resolved);
  }

  function getPendingInsertGroupIds(): Set<string> {
    const ids = new Set<string>();

    for (const seg of reviewSegmentsRef.current) {
      if (seg.insertSuggestion?.groupId) {
        ids.add(seg.insertSuggestion.groupId);
      }
    }

    return ids;
  }

  function getPendingDeleteGroupIds(): Set<string> {
    const ids = new Set<string>();

    for (const seg of reviewSegmentsRef.current) {
      if (seg.deleteSuggestion?.groupId) {
        ids.add(seg.deleteSuggestion.groupId);
      }
    }

    return ids;
  }

  function isFormatSuggestionUnlocked(item: ReviewFormatSuggestion): boolean {
    const pendingInsertIds = getPendingInsertGroupIds();
    const pendingDeleteIds = getPendingDeleteGroupIds();

    const insertDepsResolved = (item.dependsOnInsertGroupIds ?? []).every(
      (groupId) => !pendingInsertIds.has(groupId),
    );

    const deleteDepsResolved = (item.dependsOnDeleteGroupIds ?? []).every(
      (groupId) => !pendingDeleteIds.has(groupId),
    );

    return insertDepsResolved && deleteDepsResolved;
  }

  function getVisibleFormatSuggestions(): ReviewFormatSuggestion[] {
    return [...formatSuggestionsRef.current, ...blockFormatSuggestionsRef.current].filter(
      isFormatSuggestionUnlocked,
    );
  }

  function findFormatSuggestionByGroupId(
    groupId: string,
  ): {
    item: ReviewFormatSuggestion;
    kind: "inline" | "block";
  } | null {
    const inline = formatSuggestionsRef.current.find(
      (f) => f.groupId === groupId,
    );

    if (inline) {
      return { item: inline, kind: "inline" };
    }

    const block = blockFormatSuggestionsRef.current.find(
      (f) => f.groupId === groupId,
    );

    if (block) {
      return { item: block, kind: "block" };
    }

    return null;
  }

  function deactivateActiveFormatSuggestion() {
    const ctx = getReviewCtx();

    clearActiveFormatOverlay(ctx);

    activeFormatIdRef.current = null;
    setActiveFormatId(null);
  }

  function setActiveFormatIdSync(next: string | null) {
    activeFormatIdRef.current = next;
    setActiveFormatId(next);
  }

  function setActiveSuggestionSync(next: TooltipState | null) {
    activeSuggestionRef.current = next;
    setActiveSuggestion(next);
  }

  function applyWithSnapshot(fn: () => void, type: ReviewAction) {
    snapshotAndApply(getReviewCtx(), fn, type, {
      reviewHistory,
    });
  }

  function toReviewDecisionReferences(
    references: Reference[],
    attributeKey?: string | null,
  ): ReviewDecisionReference[] {
    return references.map((ref) => ({
      opId: ref.opId,
      componentIndex: ref.componentIndex,
      componentStart: ref.componentStart,
      length: ref.length,
      attributeKey: attributeKey ?? null,
    }));
  }

  function recordAcceptedReferences(
    references: Reference[],
    attributeKey?: string | null,
  ) {
    acceptedReferences.current.push(
      toReviewDecisionReferences(references, attributeKey),
    );
  }

  function recordRejectedReferences(
    references: Reference[],
    attributeKey?: string | null,
  ) {
    rejectedReferences.current.push(
      toReviewDecisionReferences(references, attributeKey),
    );
  }

  function acceptChange(
    groupId: string,
    type: "insert" | "newline" | "delete" | "format",
  ) {
    const ctx = getReviewCtx();

    if (type === "format") {
      const found = findFormatSuggestionByGroupId(groupId);
      if (!found) return;

      if (found.kind === "inline") {
        acceptFormatSuggestion(ctx, found.item as FormatSuggestionItem, {
          snapshotAndApply,
          setFormatSuggestions: setFormatSuggestionsSync,
          setActiveFormatId: setActiveFormatIdSync,
          acceptedReferences,
          reviewHistory,
        });
      } else {
        acceptBlockFormatSuggestion(ctx, found.item as BlockFormatSuggestionItem, {
          snapshotAndApply,
          setBlockFormatSuggestions: setBlockFormatSuggestionsSync,
          setActiveFormatId: setActiveFormatIdSync,
          acceptedReferences,
          reviewHistory,
        });
      }

      closeReviewTooltip(ctx, setActiveFormatIdSync, setActiveSuggestionSync);
      return;
    }

    applyWithSnapshot(() => {
      deactivateActiveFormatSuggestion();

      const range =
        type === "delete"
          ? findDeleteGroupRangeInRuntime(reviewSegmentsRef.current, groupId)
          : type === "newline"
            ? findNewlineGroupRangeInRuntime(reviewSegmentsRef.current, groupId)
            : findInsertGroupRangeInRuntime(reviewSegmentsRef.current, groupId);

      if (!range) return;

      recordAcceptedReferences(
        collectSuggestionReferencesByGroup(
          reviewSegmentsRef.current,
          groupId,
          type,
        ),
      );

      if (type === "insert") {
        reviewSegmentsRef.current = removeInsertSuggestionFromSegments(
          reviewSegmentsRef.current,
          groupId,
        );

        refreshEditorFromRuntime(ctx);

        setFormatSuggestionsSync((prev) =>
          refreshPreviewTextsAgainstRuntime(
            ctx,
            resolveFormatSuggestionsAfterMutation(
              prev,
              range,
              groupId,
              "insert",
              "ACCEPT",
            ),
          ),
        );

        setBlockFormatSuggestionsSync((prev) =>
          refreshBlockPreviewTextsAgainstRuntime(
            ctx,
            resolveFormatSuggestionsAfterMutation(
              prev,
              range,
              groupId,
              "insert",
              "ACCEPT",
            ),
          ),
        );
      } else if (type === "newline") {
        reviewSegmentsRef.current = removeNewlineSuggestionFromSegments(
          reviewSegmentsRef.current,
          groupId,
        );

        refreshEditorFromRuntime(ctx);

        setBlockFormatSuggestionsSync((prev) =>
          refreshBlockPreviewTextsAgainstRuntime(
            ctx,
            resolveBlockFormatSuggestionsAfterNewlineDecision(prev, groupId),
          ),
        );
      } else if (type === "delete") {
        let cursor = 0;
        const nextSegments: ReviewSegment[] = [];

        for (const seg of reviewSegmentsRef.current) {
          const segLen = segmentLength(seg);
          const segStart = cursor;
          const segEnd = cursor + segLen;
          cursor = segEnd;

          if (
            segEnd <= range.index ||
            segStart >= range.index + range.length
          ) {
            nextSegments.push(seg);
            continue;
          }

          if (seg.embed) {
            continue;
          }

          const leftLen = Math.max(0, range.index - segStart);
          const rightLen = Math.max(
            0,
            segEnd - (range.index + range.length),
          );

          if (leftLen > 0) {
            nextSegments.push({
              id: nextRuntimeSegmentId(ctx),
              text: seg.text.slice(0, leftLen),
              baseAttributes: { ...(seg.baseAttributes ?? {}) },
              suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
              references: [],
            });
          }

          if (rightLen > 0) {
            nextSegments.push({
              id: nextRuntimeSegmentId(ctx),
              text: seg.text.slice(seg.text.length - rightLen),
              baseAttributes: { ...(seg.baseAttributes ?? {}) },
              suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
              references: [],
            });
          }
        }

        reviewSegmentsRef.current = mergeAdjacentSegments(nextSegments);
        refreshEditorFromRuntime(ctx);

        setFormatSuggestionsSync((prev) =>
          refreshPreviewTextsAgainstRuntime(
            ctx,
            resolveFormatSuggestionsAfterMutation(
              prev,
              range,
              groupId,
              "delete",
              "ACCEPT",
            ),
          ),
        );

        setBlockFormatSuggestionsSync((prev) =>
          refreshBlockPreviewTextsAgainstRuntime(
            ctx,
            resolveFormatSuggestionsAfterMutation(
              prev,
              range,
              groupId,
              "delete",
              "ACCEPT",
            ),
          ),
        );
      }
    }, "ACCEPT");

    if (activeSuggestionRef.current?.groupId === groupId) {
      setActiveSuggestionSync(null);
    }
  }

  function rejectChange(
    groupId: string,
    type: "insert" | "newline" | "delete" | "format",
  ) {
    const ctx = getReviewCtx();

    if (type === "format") {
      const found = findFormatSuggestionByGroupId(groupId);
      if (!found) return;

      if (found.kind === "inline") {
        rejectFormatSuggestion(ctx, found.item as FormatSuggestionItem, {
          snapshotAndApply,
          setFormatSuggestions: setFormatSuggestionsSync,
          setActiveFormatId: setActiveFormatIdSync,
          rejectedReferences,
          reviewHistory,
        });
      } else {
        rejectBlockFormatSuggestion(
          ctx,
          found.item as BlockFormatSuggestionItem,
          {
            snapshotAndApply,
            setBlockFormatSuggestions: setBlockFormatSuggestionsSync,
            setActiveFormatId: setActiveFormatIdSync,
            rejectedReferences,
            reviewHistory,
          },
        );
      }

      closeReviewTooltip(ctx, setActiveFormatIdSync, setActiveSuggestionSync);
      return;
    }

    applyWithSnapshot(() => {
      deactivateActiveFormatSuggestion();

      const range =
        type === "delete"
          ? findDeleteGroupRangeInRuntime(reviewSegmentsRef.current, groupId)
          : type === "newline"
            ? findNewlineGroupRangeInRuntime(reviewSegmentsRef.current, groupId)
            : findInsertGroupRangeInRuntime(reviewSegmentsRef.current, groupId);

      if (!range) return;

      if (type === "insert") {
        recordRejectedReferences(
          collectSuggestionReferencesByGroup(
            reviewSegmentsRef.current,
            groupId,
            "insert",
          ),
        );

        reviewSegmentsRef.current = deleteInsertGroupSegments(
          reviewSegmentsRef.current,
          groupId,
          range,
        );

        const newlineResolution = resolveNewlineSuggestionsAfterDependencyChange(
          reviewSegmentsRef.current,
          `insert:${groupId}`,
        );

        reviewSegmentsRef.current = newlineResolution.segments;

        if (newlineResolution.autoRejectedReferences.length > 0) {
          recordRejectedReferences(newlineResolution.autoRejectedReferences);
        }

        refreshEditorFromRuntime(ctx);

        setFormatSuggestionsSync((prev) =>
          refreshPreviewTextsAgainstRuntime(
            ctx,
            resolveFormatSuggestionsAfterMutation(
              prev,
              range,
              groupId,
              "insert",
              "REJECT",
            ),
          ),
        );

        setBlockFormatSuggestionsSync((prev) =>
          refreshBlockPreviewTextsAgainstRuntime(
            ctx,
            resolveFormatSuggestionsAfterMutation(
              prev,
              range,
              groupId,
              "insert",
              "REJECT",
            ),
          ),
        );
      } else if (type === "newline") {
        setBlockFormatSuggestionsSync((prev) =>
          refreshBlockPreviewTextsAgainstRuntime(
            ctx,
            resolveBlockFormatSuggestionsAfterNewlineDecision(
              resolveBlockFormatSuggestionsAfterNewlineDeletion(
                prev,
                deletion.deletedNewlineRanges,
              ),
              groupId,
            ),
          ),
        );

        const deletion = deleteNewlineGroupSegmentsPreservingBlockFormats(
          reviewSegmentsRef.current,
          groupId,
        );

        reviewSegmentsRef.current = deletion.segments;

        refreshEditorFromRuntime(ctx);

        /*
        * Inline format suggestions only need normal shifting after the newline
        * was removed. They do not live on newline holders.
        */
        let nextInlineSuggestions = formatSuggestionsRef.current;

        nextInlineSuggestions = resolveFormatSuggestionsAfterRuntimeDeletion(
          nextInlineSuggestions,
          deletion.deletedNewlineRanges,
        );

        setFormatSuggestionsSync(
          refreshPreviewTextsAgainstRuntime(ctx, nextInlineSuggestions),
        );

        /*
        * Block format suggestions are different:
        * if their reference was on the removed newline, transfer the reference to
        * the next newline instead of deleting the suggestion.
        */
        setBlockFormatSuggestionsSync((prev) =>
          refreshBlockPreviewTextsAgainstRuntime(
            ctx,
            resolveBlockFormatSuggestionsAfterNewlineDeletion(
              prev,
              deletion.deletedNewlineRanges,
            ),
          ),
        );
      } else if (type === "delete") {
        recordRejectedReferences(
          collectSuggestionReferencesByGroup(
            reviewSegmentsRef.current,
            groupId,
            "delete",
          ),
        );

        reviewSegmentsRef.current = restoreRejectedDeleteSegments(
          reviewSegmentsRef.current,
          groupId,
        );

        refreshEditorFromRuntime(ctx);

        setFormatSuggestionsSync((prev) =>
          refreshPreviewTextsAgainstRuntime(
            ctx,
            resolveFormatSuggestionsAfterMutation(
              prev,
              range,
              groupId,
              "delete",
              "REJECT",
            ),
          ),
        );

        setBlockFormatSuggestionsSync((prev) =>
          refreshBlockPreviewTextsAgainstRuntime(
            ctx,
            resolveFormatSuggestionsAfterMutation(
              prev,
              range,
              groupId,
              "delete",
              "REJECT",
            ),
          ),
        );
      }
    }, "REJECT");

    if (activeSuggestionRef.current?.groupId === groupId) {
      setActiveSuggestionSync(null);
    }
  }

  function handleUndo() {
    undo(getReviewCtx(), {
      reviewHistory,
      rejectedReferences,
      acceptedReferences,
      setFormatSuggestions: setFormatSuggestionsSync,
      setBlockFormatSuggestions: setBlockFormatSuggestionsSync,
      setActiveFormatId: setActiveFormatIdSync,
      setActiveSuggestion: setActiveSuggestionSync,
    });
  }

  function sendCursorChange(position: number) {
    if (isReviewingRef.current) return;
    if (collaborationModeRef.current !== "COLLABORATIVE") return;

    const client = stompClientRef.current;

    if (!client?.connected) {
      return;
    }

    client.send(
      `/app/note/${noteId}/cursor`,
      {},
      JSON.stringify({ position }),
    );
  }

  function handleCursorChange(payload: CursorPayload) {
    if (isReviewingRef.current || payload.actorEmail === userRef.current?.email) return;
    const cursor = quillRef.current!.getModule("cursors") as CursorModule;
    cursor.createCursor(
      payload.actorEmail,
      payload.actorEmail,
      collaboratorsRef.current[payload.actorEmail],
    );
    if (payload.position === -1) {
      cursor.removeCursor(payload.actorEmail);
    } else {
      cursor.moveCursor(payload.actorEmail, {
        index: payload.position,
        length: 0,
      });
    }
  }

  function handleRemoteOperation(payload: TextOperation) {
    const { opId, revision, actorEmail } = payload;
    const docState = docStateRef.current!;

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
    if (isReviewingRef.current) return;

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
    const docState = docStateRef.current!;

    if (!opId) return;

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

  async function saveNote() {
    try {
      if (collaborationModeRef.current === "SOLO") {
        await flushSoloSync();
      }

      await apiFetch(`notes/${noteId}/save`, { method: "POST" });
    } catch (err: any) {
      setErrorMessageMessage(err.message || "Failed to save note");
    }
  }

  async function saveVersion(comment: string) {
    try {
      await saveReviewChanges();
      await apiFetch(`notes/${noteId}/versions`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });
    } catch (err: any) {
      setErrorMessageMessage(err.message || "Failed to save version");
    }
  }

  function clearCollaboratorCursors() {
    const quill = quillRef.current;
    if (!quill) return;

    const cursor = quill.getModule("cursors") as CursorModule | undefined;
    if (!cursor) return;

    Object.keys(collaboratorsRef.current).forEach((email) => {
      cursor.removeCursor(email);
    });

    quill.root
      .querySelectorAll(".ql-cursors, .ql-cursor")
      .forEach((el) => el.remove());
  }

  async function handleReviewNote() {
    if (collaborationModeRef.current === "SOLO") {
      await flushSoloSync();
    }

    await saveNote();

    const quill = quillRef.current;
    if (!quill) return;

    sendCursorChange(-1);
    clearCollaboratorCursors();

    setIsReviewing(true);
    setReviewLoaded(false);
    setShowReviewSidebarModal(true);
    setActiveSuggestionSync(null);
    setActiveFormatIdSync(null);

    await apiFetch(`notes/${noteId}/review`, { method: "GET" });

    const projection = await apiFetch<ReviewProjection>(
      `notes/${noteId}/build-attribution`,
      { method: "GET" },
    );

    const baseDelta = new Delta(projection.baseDelta?.ops || []);
    const visualDelta = new Delta(projection.visualDelta?.ops || []);

    quill.setContents(baseDelta, "api");
    quill.updateContents(visualDelta, "api");
    
    const runtimeReviewDelta = baseDelta.compose(visualDelta);

    reviewSegmentsRef.current = deltaToSegments(
      runtimeReviewDelta,
      () => nextRuntimeSegmentId(getReviewCtx()),
    );

    const inlineFormatItems = projection.formatSuggestions ?? [];
    const blockFormatItems = projection.blockFormatSuggestions ?? [];

    formatSuggestionsRef.current = inlineFormatItems;
    blockFormatSuggestionsRef.current = blockFormatItems;

    setFormatSuggestions(inlineFormatItems);
    setBlockFormatSuggestions(blockFormatItems);

    setHasPendingSuggestions(
      hasSuggestionAttributes(runtimeReviewDelta) ||
        inlineFormatItems.length > 0 ||
        blockFormatItems.length > 0,
    );

    setReviewLoaded(true);

    quill.root.removeEventListener("click", handleClick);
    quill.root.addEventListener("click", handleClick);
  }

  function hasSuggestionAttributes(delta: Delta): boolean {
    return (delta.ops ?? []).some((op: any) => {
      const attrs = op.attributes ?? {};

      return Boolean(
        attrs["suggestion-insert"] ||
          attrs["suggestion-newline"] ||
          attrs["suggestion-delete"] ||
          attrs["suggestion-delete-singleline"] ||
          attrs["suggestion-delete-multiline"] ||
          attrs["suggestion-format"] ||
          attrs["suggestion-block-format"],
      );
    });
  }

  function destroyQuillInstance() {
    if (!quillRef.current) return;

    quillRef.current.root.removeEventListener("click", handleClick);

    const toolbar = editorRef.current?.previousSibling as HTMLElement | null;
    const container = editorRef.current?.parentElement;

    quillRef.current = null;

    if (toolbar?.classList.contains("ql-toolbar")) {
      toolbar.remove();
    }

    if (container) {
      const editor = container.querySelector(".ql-container");
      editor?.remove();
    }
  }

  async function restoreEditorAfterReviewEnd() {
    try {
      const joinData = await apiFetch<JoinResponse>(
        `notes/${noteId}/join`,
        { method: "GET" },
      );

      const cleanDelta = new Delta(joinData.delta.ops || []);

      docStateRef.current!.lastSyncedRevision = joinData.revision;
      docStateRef.current!.setDocument(cleanDelta);

      pendingRemoteOpsRef.current.clear();
      processedOperationIdsRef.current.clear();

      setCollaborators(joinData.collaborators);

      reviewSegmentsRef.current = [];
      runtimeSegCtrRef.current = 0;
      formatSuggestionsRef.current = [];
      blockFormatSuggestionsRef.current = [];
      activeFormatIdRef.current = null;
      activeSuggestionRef.current = null;
      reviewHistory.current = [];
      acceptedReferences.current = [];
      rejectedReferences.current = [];

      setFormatSuggestions([]);
      setBlockFormatSuggestions([]);
      setActiveFormatId(null);
      setActiveSuggestion(null);
      setHasPendingSuggestions(false);
      setShowReviewSidebarModal(false);
      setShowExitReviewModal(false);
      setReviewLoaded(false);
      setIsReviewing(false);

      if (quillRef.current) {
        quillRef.current.root.removeEventListener("click", handleClick);
        clearActiveFormatOverlay(getReviewCtx());

        quillRef.current.setContents(cleanDelta, "api");
        quillRef.current.enable(true);
      }
    } catch (err: any) {
      setErrorMessageMessage(err.message || "Failed to restore note after review");
    }
  }

  function handleReviewInProgress(payload: ReviewInProgressResponse) {
    if (payload.noteId !== noteId) return;

    if (payload.state === true) {
      setIsReviewing(true);

      if (noteRef.current?.accessRole !== "OWNER") {
        destroyQuillInstance();
      }

      if (noteRef.current?.accessRole === "OWNER") {
        setShowReviewSidebarModal(true);
      }

      return;
    }

    restoreEditorAfterReviewEnd();
  }

  async function handleExitReview() {
    try {
      if (quillRef.current) {
        quillRef.current.root.removeEventListener("click", handleClick);
        clearActiveFormatOverlay(getReviewCtx());
      }

      await apiFetch(`notes/${noteId}/review/exit`, {
        method: "GET",
      });

    } catch (err: any) {
      setErrorMessageMessage(err.message || "Failed to exit review");
    }
  }

  async function saveReviewChanges() {
    if (!hasPendingSuggestions) {
      setErrorMessageMessage(
        "There are currently no changes made to this document. Please make changes before creating a new version.",
      );
      return;
    }

    console.log({
      acceptedReferences: acceptedReferences.current.flat(),
      rejectedReferences: rejectedReferences.current.flat(),
    })

    try {
      await apiFetch(`notes/${noteId}/review`, {
        method: "POST",
        body: JSON.stringify({
          acceptedReferences: acceptedReferences.current.flat(),
          rejectedReferences: rejectedReferences.current.flat(),
        }),
      });

      await handleExitReview();
    } catch (err: any) {
      setErrorMessageMessage(err.message);
    }
  }

  async function openSettings() {
    await saveNote();
    router.push(`/notes/${noteId}/edit/note-setting`);
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

  function hasProcessedOperation(opId?: string | null): boolean {
    if (!opId) return false;
    return processedOperationIdsRef.current.has(opId);
  }

  function markOperationProcessed(opId?: string | null) {
    if (!opId) return;
    processedOperationIdsRef.current.add(opId);
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

        if (soloPendingOperationRef.current && collaborationModeRef.current === "SOLO") {
          scheduleSoloSync(0);
        }
      } catch (err) {
        increaseSoloRetryDelay();
        scheduleSoloSyncRetry();
      }
    }, delayMs);
  }

  if (loadingUser) {
    return <LoadingState title="Checking session" message="Confirming your account before opening the editor." />;
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  if (isLoading) {
    return <LoadingState title="Loading editor" message="Preparing the note and syncing collaboration state." />;
  }

  if (errorMessage) {
    return (
      <main className="app-page-shell">
        <ErrorBanner message={errorMessage} />
      </main>
    );
  }

  if (!note) {
    return (
      <main className="app-page-shell">
        <EmptyState title="Note not found" message="This note may have been deleted or you may no longer have access to it." />
      </main>
    );
  }

  return (
    <main className="app-page-shell">
      <header className="app-page-header">
        <div className="min-w-0">
          <p className="app-page-eyebrow">{isReviewing ? "Reviewing note" : "Editing note"}</p>
          <h1 className="app-page-title">{note.title}</h1>

          <div className="app-badge-row">
            <Badge tone="emerald">{note.accessRole}</Badge>
            <Badge tone={note.visibility === "PRIVATE" ? "amber" : "blue"}>Visibility: {note.visibility}</Badge>
            <span className="app-pill">
              <span className="app-pill-label">Active:</span>
              {Object.entries(collaborators).length > 0
                ? `${Object.entries(collaborators).length} collaborator${Object.entries(collaborators).length === 1 ? "" : "s"}`
                : "Working alone"}
            </span>
          </div>

          {Object.entries(collaborators).length > 0 && (
            <div className="app-badge-row">
              {Object.entries(collaborators).map(([email, color]) => (
                <span key={email} className="app-pill">
                  <span
                    aria-hidden="true"
                    style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }}
                  />
                  <span className="truncate">{email === user?.email ? "You" : email}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="app-page-actions">
          {!isReviewing && (
            <Button variant="secondary" onClick={() => router.push(`/notes/${noteId}`)}>View</Button>
          )}

          {!isReviewing && (note.accessRole === "OWNER" || note.accessRole === "SUPER") && (
            <Button variant="secondary" onClick={() => setShowCollaboratorsModal(true)}>Collaborators</Button>
          )}

          {!isReviewing && (note.accessRole === "OWNER" || note.accessRole === "SUPER") && (
            <Button variant="secondary" onClick={() => setShowVisibilityModal(true)}>Visibility: {note.visibility}</Button>
          )}

          {note.accessRole === "OWNER" && !isReviewing && (
            <Button variant="secondary" className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100" onClick={handleReviewNote}>Review</Button>
          )}

          {!isReviewing && <Button onClick={saveNote}>Save Changes</Button>}

          {isReviewing && note.accessRole === "OWNER" && (
            <Button onClick={handleUndo} disabled={reviewHistory.current.length === 0}>↩ Undo</Button>
          )}

          <Button variant="secondary" title="Settings" onClick={openSettings} className="px-3">⚙️</Button>
        </div>
      </header>

      {isReviewing && (
        <div className="app-alert">
          <span className="text-lg">📝</span>
          <span>
            {note.accessRole === "OWNER" ? (
              <><strong>Review Mode:</strong> You are reviewing proposed changes.</>
            ) : (
              <><strong>Review in Progress:</strong> The owner is currently reviewing this note.</>
            )}
          </span>
        </div>
      )}

      {isReviewing && note.accessRole !== "OWNER" ? (
        <EmptyState
          icon="🔒"
          title="Editor locked"
          message="The owner is reviewing proposed changes. Editing will become available once the review is complete."
        />
      ) : (
        <>
          {isReviewing && reviewLoaded && note.accessRole === "OWNER" && !hasPendingSuggestions && (
            <div className="app-alert success">
              <span className="text-lg">✅</span>
              <span><strong>No pending changes:</strong> Everything looks good.</span>
            </div>
          )}

          <div className="editor-workspace">
            <section className={["editor-surface", isReviewing ? "reviewing" : ""].filter(Boolean).join(" ")}>
              <div
                ref={editorRef}
                className="editor-surface-content"
                style={{ cursor: isReviewing ? "default" : "text" }}
              />
            </section>

            {showReviewSidebarModal && reviewLoaded && note.accessRole === "OWNER" && (
              <FormatSidebarModal
                open={showReviewSidebarModal}
                hasPendingSuggestions={hasPendingSuggestions}
                formatSuggestions={getVisibleFormatSuggestions()}
                activeFormatId={activeFormatId}
                onActivateFormat={(groupId) =>
                  activateFormatSuggestion(
                    getReviewCtx(),
                    groupId,
                    setActiveFormatIdSync,
                    setActiveSuggestionSync,
                    closeReviewTooltip,
                  )
                }
                canActOnFormat={(item) => isFormatSuggestionUnlocked(item)}
                onClose={() => setShowExitReviewModal(true)}
                onSave={saveVersion}
              />
            )}
          </div>

          {showExitReviewModal && (
            <ExitReviewModal
              open={showExitReviewModal}
              onClose={() => setShowExitReviewModal(false)}
              onSave={saveReviewChanges}
              exitReview={handleExitReview}
            />
          )}
        </>
      )}

      <footer className="app-footer-meta">
        <span>Created at: {new Date(note.createdAt).toLocaleString()}</span>
      </footer>

      {activeSuggestion && (
        <ReviewTooltip
          tooltip={activeSuggestion}
          onAccept={(groupId, type) => acceptChange(groupId, type)}
          onReject={(groupId, type) => rejectChange(groupId, type)}
          onClose={() =>
            closeReviewTooltip(
              getReviewCtx(),
              setActiveFormatIdSync,
              setActiveSuggestionSync
            )
          }
        />
      )}

      {showCollaboratorsModal && (
        <CollaboratorsModal
          open={showCollaboratorsModal}
          onClose={() => setShowCollaboratorsModal(false)}
          noteId={noteId as string}
          email={user.email}
          accessRole={note.accessRole}
        />
      )}

      {showVisibilityModal && (
        <VisibilityModal
          open={showVisibilityModal}
          onClose={() => setShowVisibilityModal(false)}
          noteId={noteId as string}
          accessRole={note.accessRole}
          visibility={note.visibility}
          onVisibilityChanged={(visibility) => {
            setNote((prev) =>
              prev ? { ...prev, visibility } : prev,
            );
          }}
        />
      )}
    </main>
  );
}

export default function EditPage() {
  return (
    <Suspense fallback={<LoadingState title="Initializing editor" message="Preparing collaboration tools." />}>
      <EditContent />
    </Suspense>
  );
}