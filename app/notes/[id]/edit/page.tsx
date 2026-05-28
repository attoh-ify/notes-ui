"use client";

import { API_BASE_URL, apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, Suspense, useCallback } from "react";
import { Stomp, CompatClient } from "@stomp/stompjs";
import { DocState } from "@/src/lib/docState";
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
} from "../../../../src/types";
import { ReviewTooltip } from "@/components/ReviewTooltip";
import ExitReviewModal from "@/components/ExitReviewModal";
import FormatSidebarModal from "@/components/FormatSidebarModal";
import {
  deleteInsertGroupSegments,
  deleteNewlineGroupSegments,
  deltaToSegments,
  findDeleteGroupRangeInRuntime,
  findInsertGroupRangeInRuntime,
  findNewlineGroupRangeInRuntime,
  getSuggestionSelector,
  mergeAdjacentSegments,
  removeInsertSuggestionFromSegments,
  removeNewlineSuggestionFromSegments,
  resolveFormatSuggestionsAfterMutation,
  resolveNewlineSuggestionsAfterDependencyChange,
  restoreRejectedDeleteSegments,
  collectSuggestionReferencesByGroup,
  segmentLength,
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
  const isExitingReviewRef = useRef(false);

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

  useEffect(() => {
    return () => {
      clearSendRetryTimer();
    };
  }, []);

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
        acceptBlockFormatSuggestion(
          ctx,
          found.item as BlockFormatSuggestionItem,
          {
            snapshotAndApply,
            setBlockFormatSuggestions: setBlockFormatSuggestionsSync,
            setActiveFormatId: setActiveFormatIdSync,
            acceptedReferences,
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
        recordRejectedReferences(
          collectSuggestionReferencesByGroup(
            reviewSegmentsRef.current,
            groupId,
            "newline",
          ),
        );

        reviewSegmentsRef.current = deleteNewlineGroupSegments(
          reviewSegmentsRef.current,
          groupId,
        );

        refreshEditorFromRuntime(ctx);
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
      if (email !== userRef.current?.email) {
        cursor.removeCursor(email);
      }
    });

    quill.root
      .querySelectorAll(".ql-cursors, .ql-cursor")
      .forEach((el) => el.remove());
  }

  async function handleReviewNote() {
    await saveNote();

    const quill = quillRef.current;
    if (!quill) return;

    clearCollaboratorCursors();
    await sendCursorChange(-1);

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

    if (isExitingReviewRef.current) {
      return;
    }

    restoreEditorAfterReviewEnd();
  }

  async function handleExitReview() {
    try {
      isExitingReviewRef.current = true;

      if (quillRef.current) {
        quillRef.current.root.removeEventListener("click", handleClick);
        clearActiveFormatOverlay(getReviewCtx());
      }

      await apiFetch(`notes/${noteId}/review/exit`, {
        method: "GET",
      });

      await restoreEditorAfterReviewEnd();
    } catch (err: any) {
      setErrorMessageMessage(err.message || "Failed to exit review");
    } finally {
      isExitingReviewRef.current = false;
    }
  }

  async function saveReviewChanges() {
    if (!hasPendingSuggestions) {
      setErrorMessageMessage(
        "There are currently no changes made to this document. Please make changes before creating a new version.",
      );
      return;
    }

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