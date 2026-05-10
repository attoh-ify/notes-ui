"use client";

import { API_BASE_URL, apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, Suspense, useCallback } from "react";
import { Stomp, CompatClient } from "@stomp/stompjs";
import SockJS from "sockjs-client";
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
  SuggestionSlice,
} from "../../../../src/types";
import { ReviewTooltip } from "@/components/ReviewTooltip";
import ExitReviewModal from "@/components/ExitReviewModal";
import FormatSidebarModal from "@/components/FormatSidebarModal";
import {
  buildFormatOverlayClearDelta,
  deleteInsertGroupSegments,
  deltaToSegments,
  findDeleteGroupRangeInRuntime,
  findInsertGroupRangeInRuntime,
  getSuggestionSelector,
  mergeAdjacentSegments,
  normalizeLineBreaksAfterRejectedInsert,
  removeInsertSuggestionFromSegments,
  getRuntimeTextInRange,
  resolveFormatSuggestionsAfterMutation,
} from "@/src/lib/attribution";
import {
  canActOnFormatSuggestion,
  nextRuntimeSegmentId,
  refreshEditorFromRuntime,
  refreshPreviewTextsAgainstRuntime,
  restoreActiveFormatOverlay,
  suspendActiveFormatOverlay,
} from "@/src/lib/review/runtimeHelpers";
import {
  acceptFormatSuggestion,
  activateFormatSuggestion,
  closeReviewTooltip,
  rejectFormatSuggestion,
} from "@/src/lib/review/formatSuggestionEngine";
import { snapshotAndApply, undo } from "@/src/lib/review/reviewHistory";
import CollaboratorsModal from "@/components/CollaboratorsSection";

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
  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<TooltipState | null>(null);
  const [showExitReviewModal, setShowExitReviewModal] = useState(false);
  const [showReviewSidebarModal, setShowReviewSidebarModal] = useState(false);
  const [hasPendingSuggestions, setHasPendingSuggestions] = useState(false);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [showCollaboratorsModal, setShowCollaboratorsModal] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const initializingEditorRef = useRef(false);
  const docStateRef = useRef<DocState | null>(null);
  const stompClientRef = useRef<CompatClient | null>(null);
  const isSyncComplete = useRef<boolean>(false);
  const isOwner = useRef<boolean>(false);
  const reviewHistory = useRef<ReviewEntry[]>([]);
  const rejectedChanges = useRef<Delta[]>([]);
  const acceptedReferences = useRef<SuggestionSlice[][]>([]);
  const reviewSegmentsRef = useRef<ReviewSegment[]>([]);
  const runtimeSegCtrRef = useRef(0);

  const formatSuggestionsRef = useRef<FormatSuggestionItem[]>([]);
  const activeFormatIdRef = useRef<string | null>(null);
  const activeSuggestionRef = useRef<TooltipState | null>(null);
  const collaboratorsRef = useRef<Record<string, string>>({});
  const noteRef = useRef<Note | null>(null);
  const userRef = useRef(user);
  const isSendingRef = useRef(false);
  const pendingSendQueueRef = useRef<TextOperation[]>([]);

  useEffect(() => { formatSuggestionsRef.current = formatSuggestions; }, [formatSuggestions]);
  useEffect(() => { activeFormatIdRef.current = activeFormatId; }, [activeFormatId]);
  useEffect(() => { activeSuggestionRef.current = activeSuggestion; }, [activeSuggestion]);
  useEffect(() => { collaboratorsRef.current = collaborators; }, [collaborators]);
  useEffect(() => { noteRef.current = note; }, [note]);
  useEffect(() => { userRef.current = user; }, [user]);

  const getReviewCtx = () => ({
    quill: quillRef.current,
    runtimeSegCtrRef,
    reviewSegmentsRef,
    formatSuggestionsRef,
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
              isSyncComplete.current = false;
              if (!stompClientRef.current?.connected) return;
              try {
                await sendOperationToServer(op);
              } finally {
                isSyncComplete.current = true;
              }
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

  const loadNoteAndJoin = useCallback(async () => {
    if (!noteId || !user) return;

    try {
      const noteData = await apiFetch<Note>(`notes/${noteId}`, { method: "GET" });
      setNote(noteData);

      if (noteData.accessRole === "VIEWER") {
        router.push(`/notes/${noteId}`);
        return;
      }

      const joinData = await apiFetch<JoinResponse>(`notes/${noteId}/join`, {
        method: "GET",
      });

      if (joinData.isReviewing === true) {
        setIsReviewing(true);
        return;
      }

      docStateRef.current!.lastSyncedRevision = joinData.revision;
      docStateRef.current!.setDocument(new Delta(joinData.delta.ops || []));
      setCollaborators(joinData.collaborators);

      if (noteData.accessRole === "OWNER") {
        isOwner.current = true;
      }
    } catch (err: any) {
      setErrorMessageMessage(err.message || "Failed to load note");
    } finally {
      setIsloading(false);
    }
  }, [noteId, user, router]);

  useEffect(() => {
    if (!noteId || !user) return;

    const client = Stomp.over(
      () => new SockJS(`${API_BASE_URL}/relay?noteId=${noteId}`)
    );

    client.debug = () => {};

    stompClientRef.current = client;

    client.connect({}, async () => {
      try {
        client.subscribe(`/topic/note/${noteId}`, (message) => {
          const { type, payload } = JSON.parse(message.body);

          if (type === MessageType.OPERATION)
            handleRemoteOperation(payload);

          if (type === MessageType.COLLABORATOR_JOIN)
            setCollaborators(payload.collaborators);

          if (type === MessageType.COLLABORATOR_CURSOR)
            handleCursorChange(payload);

          if (type === MessageType.REVIEW_IN_PROGRESS)
            handleReviewInProgress(payload);
        });

        const noteData = await apiFetch<Note>(`notes/${noteId}`, {
          method: "GET",
        });

        setNote(noteData);

        if (noteData.accessRole === "VIEWER") {
          router.push(`/notes/${noteId}`);
          return;
        }

        const joinData = await apiFetch<JoinResponse>(
          `notes/${noteId}/join`,
          {
            method: "GET",
          }
        );

        if (joinData.isReviewing === true) {
          setIsReviewing(true);
          return;
        }

        docStateRef.current!.lastSyncedRevision =
          joinData.revision;

        docStateRef.current!.setDocument(
          new Delta(joinData.delta.ops || [])
        );

        setCollaborators(joinData.collaborators);

        if (noteData.accessRole === "OWNER") {
          isOwner.current = true;
        }

        setIsloading(false);
      } catch (err: any) {
        setErrorMessageMessage(
          err.message || "Failed to load note"
        );

        setIsloading(false);
      }
    });

    return () => {
      if (client.active) {
        client.disconnect();
      }
    };
  }, [noteId, user]);

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
        rawType === "insert" || rawType === "delete" || rawType === "format"
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

    if (!node) {
      setActiveSuggestion(null);
      return;
    }

    const type = node.getAttribute("data-suggestion-type") as TooltipState["type"];
    if (type === "format") return;

    const groupId = node.getAttribute("data-group-id")!;
    const actorEmail = node.getAttribute("data-actor-email")!;
    const createdAt = node.getAttribute("data-created-at")!;
    const references = JSON.parse(node.getAttribute("data-references") ?? "[]");

    setActiveSuggestion((prev) =>
      prev?.groupId === groupId
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

  function applyWithSnapshot(fn: () => void, type: ReviewAction) {
    snapshotAndApply(getReviewCtx(), fn, type, {
      reviewHistory,
      rejectedChanges,
    });
  }

  function acceptChange(
    groupId: string,
    type: "insert" | "delete" | "format",
    references: SuggestionSlice[],
  ) {
    const ctx = getReviewCtx();

    if (type === "format") {
      const item = ctx.formatSuggestionsRef.current.find(
        (f) => f.groupId === groupId,
      );
      if (!item) return;

      acceptFormatSuggestion(ctx, item, {
        snapshotAndApply,
        setFormatSuggestions,
        setActiveFormatId,
        acceptedReferences,
        reviewHistory,
        rejectedChanges,
      });

      closeReviewTooltip(ctx, setActiveFormatId, setActiveSuggestion);
      return;
    }

    applyWithSnapshot(() => {
      const suspended = suspendActiveFormatOverlay(ctx);

      try {
        const range =
          type === "delete"
            ? findDeleteGroupRangeInRuntime(reviewSegmentsRef.current, groupId)
            : findInsertGroupRangeInRuntime(reviewSegmentsRef.current, groupId);
        if (!range) return;

        acceptedReferences.current.push(references);

        if (type === "insert") {
          reviewSegmentsRef.current = removeInsertSuggestionFromSegments(
            reviewSegmentsRef.current,
            groupId,
          );

          refreshEditorFromRuntime(ctx);

          setFormatSuggestions((prev) =>
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
        } else if (type === "delete") {
          let cursor = 0;
          const nextSegments: ReviewSegment[] = [];

          for (const seg of reviewSegmentsRef.current) {
            const segStart = cursor;
            const segEnd = cursor + seg.text.length;
            cursor = segEnd;

            if (
              segEnd <= range.index ||
              segStart >= range.index + range.length
            ) {
              nextSegments.push(seg);
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
              });
            }
            if (rightLen > 0) {
              nextSegments.push({
                id: nextRuntimeSegmentId(ctx),
                text: seg.text.slice(seg.text.length - rightLen),
                baseAttributes: { ...(seg.baseAttributes ?? {}) },
                suggestionAttributes: { ...(seg.suggestionAttributes ?? {}) },
              });
            }
          }

          reviewSegmentsRef.current = mergeAdjacentSegments(nextSegments);
          refreshEditorFromRuntime(ctx);

          setFormatSuggestions((prev) =>
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
        }
      } finally {
        restoreActiveFormatOverlay(ctx, suspended);
      }
    }, "ACCEPT");

    setActiveSuggestion((prev) => (prev?.groupId === groupId ? null : prev));
  }

  function rejectChange(groupId: string, type: "insert" | "delete" | "format") {
    const ctx = getReviewCtx();

    if (type === "format") {
      const item = ctx.formatSuggestionsRef.current.find(
        (f) => f.groupId === groupId,
      );
      if (!item) return;

      rejectFormatSuggestion(ctx, item, {
        snapshotAndApply,
        setFormatSuggestions,
        setActiveFormatId,
        reviewHistory,
        rejectedChanges,
      });

      closeReviewTooltip(ctx, setActiveFormatId, setActiveSuggestion);
      return;
    }

    applyWithSnapshot(() => {
      const suspended = suspendActiveFormatOverlay(ctx);

      try {
        const range =
          type === "delete"
            ? findDeleteGroupRangeInRuntime(reviewSegmentsRef.current, groupId)
            : findInsertGroupRangeInRuntime(reviewSegmentsRef.current, groupId);
        if (!range) return;

        if (type === "insert") {
          const removedText = getRuntimeTextInRange(
            reviewSegmentsRef.current,
            range.index,
            range.length,
          );

          reviewSegmentsRef.current = deleteInsertGroupSegments(
            reviewSegmentsRef.current,
            groupId,
            range,
          );

          reviewSegmentsRef.current = normalizeLineBreaksAfterRejectedInsert(
            reviewSegmentsRef.current,
            range,
            removedText,
            () => nextRuntimeSegmentId(ctx),
          );

          refreshEditorFromRuntime(ctx);

          setFormatSuggestions((prev) =>
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
        } else if (type === "delete") {
          reviewSegmentsRef.current = mergeAdjacentSegments(
            reviewSegmentsRef.current.map((seg) => {
              if (seg.deleteSuggestion?.groupId !== groupId) return seg;
              return { ...seg, deleteSuggestion: undefined };
            }),
          );

          refreshEditorFromRuntime(ctx);

          setFormatSuggestions((prev) =>
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
        }
      } finally {
        restoreActiveFormatOverlay(ctx, suspended);
      }
    }, "REJECT");

    setActiveSuggestion((prev) => (prev?.groupId === groupId ? null : prev));
  }

  function handleUndo() {
    undo(getReviewCtx(), {
      reviewHistory,
      rejectedChanges,
      acceptedReferences,
      setFormatSuggestions,
      setActiveFormatId,
      setActiveSuggestion,
    });
  }

  async function sendCursorChange(position: number) {
    if (isReviewing) return;
    await apiFetch(`notes/${noteId}/cursor`, {
      method: "POST",
      body: JSON.stringify({ position }),
    });
  }

  function handleCursorChange(payload: CursorPayload) {
    if (isReviewing || payload.actorEmail === userRef.current?.email) return;
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
    const { delta, actorEmail, revision, state, createdAt } = payload;
    const docState = docStateRef.current!;

    if (actorEmail === user!.email) {
      docState.acknowledgeOperation(revision, (pending) => {
        isSyncComplete.current = false;
        if (pending) sendOperationToServer(pending);
      });
    } else {
      const d = docState.applyRemoteOperation({
        opId: "",
        delta: new Delta(delta.ops || []),
        actorEmail,
        revision,
        state,
        createdAt,
      });
      quillRef.current?.updateContents(d, "api");
    }
  }

  async function sendOperationToServer(operation: TextOperation) {
    if (isReviewing) return;

    pendingSendQueueRef.current.push(operation);
    if (isSendingRef.current) return;

    isSendingRef.current = true;

    try {
      while (pendingSendQueueRef.current.length > 0) {
        const next = pendingSendQueueRef.current.shift();
        if (!next) continue;

        await apiFetch(`notes/${noteId}/enqueue`, {
          method: "POST",
          body: JSON.stringify(
            new TextOperation(
              "",
              next.delta,
              userRef.current!.email,
              next.revision,
              OperationState.PENDING,
              new Date().toISOString().slice(0, 19),
            ),
          ),
        });
      }
    } finally {
      isSendingRef.current = false;
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

  async function handleReviewNote() {
    await saveNote();

    const quill = quillRef.current;
    if (!quill) return;

    setIsReviewing(true);
    setReviewLoaded(false);

    await apiFetch(`notes/${noteId}/review`, { method: "GET" });

    const projection = await apiFetch<ReviewProjection>(
      `notes/${noteId}/build-attribution`,
      { method: "GET" },
    );

    const hasPending =
      projection.visualDelta.ops.length > 0 ||
      projection.formatSuggestions.length > 0;

    quill.setContents(new Delta(projection.baseDelta.ops), "api");

    if (projection.visualDelta.ops.length > 0) {
      quill.updateContents(new Delta(projection.visualDelta.ops), "api");
    }

    setFormatSuggestions(projection.formatSuggestions);
    setHasPendingSuggestions(hasPending);
    setReviewLoaded(true);

    reviewSegmentsRef.current = deltaToSegments(
      quill.getContents(),
      () => nextRuntimeSegmentId(getReviewCtx()),
    );

    quill.root.removeEventListener("click", handleClick);
    quill.root.addEventListener("click", handleClick);
  }

  function handleReviewInProgress(payload: ReviewInProgressResponse) {
    if (
      payload.state === false &&
      noteRef.current?.ownerEmail !== userRef.current?.email
    ) {
      const quill = quillRef.current;
      if (quill) {
        quill.enable(true);
        quill.root.removeEventListener("click", handleClick);
      }
    }
    setIsReviewing(payload.state);
    if (isOwner.current && payload.state === true) {
      setShowReviewSidebarModal(true);
    }
  }

  async function handleExitReview() {
    try {
      quillRef.current?.root.removeEventListener("click", handleClick);
      await apiFetch(`notes/${noteId}/review/exit`, { method: "GET" });
      setFormatSuggestions([]);
      setActiveFormatId(null);
      setHasPendingSuggestions(false);
      setIsReviewing(false);
      setShowReviewSidebarModal(false);
      setActiveSuggestion(null);
      setReviewLoaded(false);
      reviewHistory.current = [];
      rejectedChanges.current = [];
      acceptedReferences.current = [];
      await loadNoteAndJoin();
    } catch (err: any) {
      setErrorMessageMessage(err.message);
    }
  }

  async function saveReviewChanges() {
    try {
      const currentActive = activeFormatIdRef.current;
      if (currentActive) {
        const item = formatSuggestionsRef.current.find(
          (f) => f.groupId === currentActive,
        );
        if (item) {
          quillRef.current?.updateContents(
            buildFormatOverlayClearDelta(item),
            "api",
          );
        }
      }

      const delta =
        rejectedChanges.current.length > 0
          ? rejectedChanges.current.reduce((acc, d) => acc.compose(d))
          : new Delta();

      const acceptedSlices = acceptedReferences.current.flat();

      await apiFetch(`notes/${noteId}/review`, {
        method: "POST",
        body: JSON.stringify({
          rejectedChange: new TextOperation(
            "",
            delta,
            user!.email,
            0,
            OperationState.PENDING,
            new Date().toISOString().slice(0, 19),
          ),
          acceptedReferences: acceptedSlices,
        }),
      });

      handleExitReview();
    } catch (err: any) {
      setErrorMessageMessage(err.message);
    }
  }

  async function openSettings() {
    await saveNote();
    router.push(`/notes/${noteId}/edit/note-setting`);
  }

  if (loadingUser)
    return <div className="container-wide">Checking session...</div>;

  if (!user) {
    router.push("/login");
    return null;
  }

  if (isLoading)
    return <div className="container-wide">Loading note...</div>;

  if (errorMessage)
    return (
      <div className="container-wide" style={{ color: "red" }}>
        {errorMessage}
      </div>
    );

  if (!note) return <div className="container-wide">Note not found.</div>;

  return (
    <main
      className="container-wide"
      style={{ maxWidth: "1000px", paddingBottom: 60 }}
    >
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          paddingBottom: "1rem",
          marginBottom: "1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--primary)",
              fontWeight: "bold",
              textTransform: "uppercase",
            }}
          >
            Editing Note
          </span>
          <h1 style={{ fontSize: "1.75rem", margin: 0 }}>{note.title}</h1>
        </div>

        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: "0.875rem",
              marginBottom: "8px",
              display: "flex",
              gap: "5px",
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            {Object.entries(collaborators).length > 0 ? (
              <>
                <span style={{ color: "var(--textmuted)" }}>
                  Collaborating:{" "}
                </span>
                {Object.entries(collaborators).map(([email, color], i, arr) => (
                  <span key={email} style={{ color, fontWeight: "600" }}>
                    {email === user?.email ? "You" : email}
                    {i < arr.length - 1 && (
                      <span style={{ color, marginLeft: "2px" }}>,</span>
                    )}
                  </span>
                ))}
              </>
            ) : (
              <span style={{ color: "var(--textmuted)" }}>Working alone</span>
            )}
          </div>

          <div
            style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}
          >
            <button className="btn-icon" title="Settings" onClick={openSettings}>
              ⚙️
            </button>
            <div
              style={{
                width: "1px",
                background: "var(--border)",
                margin: "0 4px",
              }}
            />

            {(isOwner.current || note.accessRole === "SUPER") && <button
              className="btn-outline"
              onClick={() => setShowCollaboratorsModal(true)}
            >
              Collaborators
            </button>}

            {!isReviewing && (
              <button
                className="btn-outline"
                onClick={() => router.push(`/notes/${noteId}`)}
              >
                View
              </button>
            )}

            {isOwner.current && !isReviewing && (
              <button className="btn-outline" onClick={handleReviewNote}>
                Review
              </button>
            )}

            {!isReviewing && (
              <button className="btn-primary" onClick={saveNote}>
                Save changes
              </button>
            )}

            {isReviewing && isOwner.current && (
              <button
                className="btn-primary"
                onClick={handleUndo}
                disabled={reviewHistory.current.length === 0}
                style={{
                  opacity: reviewHistory.current.length === 0 ? 0.4 : 1,
                }}
              >
                ↩ Undo
              </button>
            )}
          </div>
        </div>
      </header>

      {isReviewing && (
        <div
          style={{
            backgroundColor: "#fffbeb",
            border: "1px solid #fcd34b",
            color: "#f3f031ff",
            padding: "0.75rem 1rem",
            borderRadius: "6px",
            marginBottom: "1rem",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "0.875rem",
            fontWeight: "500",
          }}
        >
          <span style={{ fontSize: "1.2rem" }}>📝</span>
          <span>
            {note.accessRole === "OWNER" ? (
              <>
                <strong>Review Mode:</strong> You are reviewing proposed
                changes. Accept or reject them.
              </>
            ) : (
              <>
                <strong>Review in Progress:</strong> The owner is reviewing a
                proposed version of this note.
              </>
            )}
          </span>
        </div>
      )}

      {isReviewing && !isOwner.current ? (
        <div
          style={{
            minHeight: "500px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#f9fafb",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            textAlign: "center",
            padding: "2rem",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔒</div>
          <h3 style={{ color: "var(--text)", margin: "0 0 0.5rem 0" }}>
            Editor Locked
          </h3>
          <p style={{ color: "var(--text-muted)", maxWidth: "400px", margin: 0 }}>
            The owner is reviewing proposed changes. The editor will be
            available once review is complete.
          </p>
        </div>
      ) : (
        <>
          {isReviewing &&
            reviewLoaded &&
            note.accessRole === "OWNER" &&
            !hasPendingSuggestions && (
              <div
                style={{
                  backgroundColor: "#ecfdf5",
                  border: "1px solid #10b981",
                  color: "#065f46",
                  padding: "0.75rem 1rem",
                  borderRadius: "6px",
                  marginBottom: "1rem",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                }}
              >
                <span style={{ fontSize: "1.1rem" }}>✅</span>
                <span>
                  <strong>No pending changes:</strong> The note is shown below
                  with its current saved content.
                </span>
              </div>
            )}

          <div
            style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}
          >
            <div
              style={{
                flex: 1,
                minWidth: 0,
                position: "relative",
                minHeight: "500px",
                borderRadius: "8px",
                padding: "2px",
                border: isReviewing
                  ? "2px solid #fcd34b"
                  : "1px solid var(--border)",
                backgroundColor: isReviewing ? "#fafafa" : "#fcfcfc",
                display: "block",
              }}
            >
              <div
                ref={editorRef}
                style={{
                  fontFamily: "monospace",
                  fontSize: "1rem",
                  lineHeight: "1.6",
                  padding: "2rem",
                  border: "none",
                  cursor: isReviewing ? "default" : "text",
                }}
              />
            </div>

            {showReviewSidebarModal && isOwner.current && (
              <FormatSidebarModal
                open={showReviewSidebarModal}
                hasPendingSuggestions={hasPendingSuggestions}
                formatSuggestions={formatSuggestions.filter((item) =>
                  canActOnFormatSuggestion(getReviewCtx(), item),
                )}
                activeFormatId={activeFormatId}
                onActivateFormat={(groupId) =>
                  activateFormatSuggestion(
                    getReviewCtx(),
                    groupId,
                    setActiveFormatId,
                    setActiveSuggestion,
                    closeReviewTooltip,
                  )
                }
                onClose={
                  hasPendingSuggestions
                    ? () => setShowExitReviewModal(true)
                    : handleExitReview
                }
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

      <footer
        style={{
          marginTop: "1rem",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
        }}
      >
        Created at: {new Date(note.createdAt).toLocaleString()}
      </footer>

      {activeSuggestion && (
        <ReviewTooltip
          tooltip={activeSuggestion}
          onAccept={(groupId, type, references) =>
            acceptChange(groupId, type, references)
          }
          onReject={(groupId, type) => rejectChange(groupId, type)}
          onClose={() =>
            closeReviewTooltip(
              getReviewCtx(),
              setActiveFormatId,
              setActiveSuggestion,
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
    </main>
  );
}

export default function EditPage() {
  return (
    <Suspense fallback={<p>Initializing Editor...</p>}>
      <EditContent />
    </Suspense>
  );
}