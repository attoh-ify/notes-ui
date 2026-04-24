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
  OpReference,
  ReviewAction,
  ReviewEntry,
  ReviewInProgressResponse,
  ReviewProjection,
  ReviewSegment,
  RuntimeSnapshot,
  TooltipState,
} from "../../../../src/types";
import { ReviewTooltip } from "@/components/ReviewTooltip";
import ExitReviewModal from "@/components/ExitReviewModal";
import FormatSidebarModal from "@/components/FormatSidebarModal";
import {
  buildFormatOverlayDelta,
  buildFormatOverlayClearDelta,
  cloneFormatSuggestions,
  cloneSegments,
  deleteInsertGroupSegments,
  deltaToSegments,
  findDeleteGroupRangeInRuntime,
  findInsertGroupRangeInRuntime,
  getSuggestionSelector,
  mergeAdjacentSegments,
  mergeOpReferences,
  normalizeLineBreaksAfterRejectedInsert,
  removeInsertSuggestionFromSegments,
  restoreFormatSuggestionToBase,
  segmentsToDelta,
  stripSuggestionAttributes,
  transformSpansAfterRuntimeInsertRemoval,
  getRuntimeTextInRange,
  segmentsToPlainDelta,
  segmentsToAttributeOverlayDelta,
} from "@/src/lib/attribution";

function EditContent() {
  const { id: noteId } = useParams();
  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(null);
  const [collaborators, setCollaborators] = useState<Record<string, string>>(
    {},
  );
  const [isLoading, setIsloading] = useState(true);
  const [errorMessage, setErrorMessageMessage] = useState<string | null>(null);

  const [isReviewing, setIsReviewing] = useState<boolean>(false);

  const [formatSuggestions, setFormatSuggestions] = useState<
    FormatSuggestionItem[]
  >([]);
  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState<TooltipState | null>(
    null,
  );
  const [showExitReviewModal, setShowExitReviewModal] = useState(false);
  const [showReviewSidebarModal, setShowReviewSidebarModal] = useState(false);
  const [hasPendingSuggestions, setHasPendingSuggestions] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const docStateRef = useRef<DocState | null>(null);
  const stompClientRef = useRef<CompatClient | null>(null);
  const isSyncComplete = useRef<boolean>(false);
  const isOwner = useRef<boolean>(false);
  const reviewHistory = useRef<ReviewEntry[]>([]);
  const rejectedChanges = useRef<Delta[]>([]);
  const acceptedReferences = useRef<OpReference[][]>([]);
  const reviewSegmentsRef = useRef<ReviewSegment[]>([]);
  let _runtimeSegCtr = 0;

  const formatSuggestionsRef = useRef<FormatSuggestionItem[]>([]);
  const activeFormatIdRef = useRef<string | null>(null);
  const activeSuggestionRef = useRef<TooltipState | null>(null);

  useEffect(() => {
    formatSuggestionsRef.current = formatSuggestions;
  }, [formatSuggestions]);

  useEffect(() => {
    activeFormatIdRef.current = activeFormatId;
  }, [activeFormatId]);

  // why do we have them both as useState and useRef

  useEffect(() => {
    activeSuggestionRef.current = activeSuggestion;
  }, [activeSuggestion]);

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
      const selector = getSuggestionSelector(activeSuggestion.groupId, activeSuggestion.type);

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
      shouldShowEditor
    ) {
      const init = async () => {
        const { default: Q } = await import("quill");
        const { default: QCursors } = await import("quill-cursors");
        Q.register("modules/cursors", QCursors);
        registerFormats(Q);

        quillRef.current = new Q(editorRef.current!, {
          theme: "snow",
          readOnly: isReviewing,
          modules: {
            toolbar: [
              "bold",
              "italic",
              "underline",
              "strike",
              "color",
              "background",
              "font",
              "size",
              "header",
              "indent",
              "list",
              "align",
              "link",
              "image",
              "video",
              "blockquote",
              "code-block",
              "formula",
            ],
            cursors: true,
          },
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
              if (!stompClientRef.current?.connected) {
                return;
              }
              await sendOperationToServer(op);  // if this operation is still an await call, does the system really wait for the operation so finish sending before changing isSyncComplete to true?
              isSyncComplete.current = true;
            },
          );
        });

        quillRef.current.on("selection-change", async (range, _old, source) => {
          if (source !== "user" || !range) return;
          sendCursorChange(range.index ?? -1);
        });
      };

      init();
    }
  }, [isLoading, isReviewing, note?.accessRole]);

  const activateFormatSuggestion = useCallback((groupId: string) => {
    const quill = quillRef.current;
    if (!quill) {
      return;
    }

    const fmts = formatSuggestionsRef.current;
    const prevId = activeFormatIdRef.current;

    if (prevId) {
      const prev = fmts.find((f) => f.groupId === prevId);
      if (prev) {
        quill.updateContents(buildFormatOverlayClearDelta(prev), "api");
      }
    }

    if (prevId === groupId) {
      closeReviewTooltip();
      return;
    }

    const item = fmts.find((f) => f.groupId === groupId);
    if (!item) {
      return;
    }

    quill.updateContents(buildFormatOverlayDelta(item), "api");
    setActiveFormatId(groupId);
    setActiveSuggestion({
      groupId: item.groupId,
      type: "format",
      actorEmail: item.actorEmail,
      createdAt: item.createdAt,
      references: item.references,
    });
  }, []);

  const loadNoteAndJoin = useCallback(async () => {
    if (!noteId || !user) {
      return;
    }

    try {
      const noteData = await apiFetch<Note>(`notes/${noteId}`, {
        method: "GET",
      });
      setNote(noteData);

      if (noteData.accessRole === "VIEWER") {
        router.push(`/notes/${noteId}`);
        return;
      }

      // TODO: change JoinResponse to pass isReviewing isntead of returning null when isReviewing
      const joinData = await apiFetch<JoinResponse>(`notes/${noteId}/join`, {
        method: "GET",
      });

      if (joinData === null) {
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
    loadNoteAndJoin();
  }, [loadNoteAndJoin]);

  useEffect(() => {
    if (!noteId || isLoading) {
      return;
    }

    const client = Stomp.over(
      () => new SockJS(`${API_BASE_URL}/relay?noteId=${noteId}`),
    );
    client.debug = () => {};
    stompClientRef.current = client;

    client.connect({}, () => {
      client.subscribe(`/topic/note/${noteId}`, (message) => {
        const { type, payload } = JSON.parse(message.body);
        if (type === MessageType.OPERATION) handleRemoteOperation(payload);
        if (type === MessageType.COLLABORATOR_JOIN) {
          setCollaborators(payload.collaborators);
        }
        if (type === MessageType.COLLABORATOR_CURSOR) {
          handleCursorChange(payload);
        }
        if (type === MessageType.REVIEW_IN_PROGRESS) {
          handleReviewInProgress(payload);
        }
      });

      if (docStateRef.current?.sentOperation && !isSyncComplete.current) {
        sendOperationToServer(docStateRef.current.sentOperation);
        isSyncComplete.current = true;
      }
    });

    return () => {
      if (client.active) {
        client.disconnect();
      }
    };
  }, [noteId, isLoading]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) {
      return;
    }

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
    if (!quill) return;

    if (!isReviewing) return;

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
        "[data-suggestion-type][data-group-id]"
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
      "[data-suggestion-type][data-group-id]"
    ) as HTMLElement | null;

    if (!node) {
      setActiveSuggestion(null);
      return;
    }

    const type = node.getAttribute("data-suggestion-type");
    if (type === "format") {
      return;
    }

    const suggestionType = node.getAttribute(
      "data-suggestion-type",
    ) as TooltipState["type"];
    const groupId = node.getAttribute("data-group-id")!;
    const actorEmail = node.getAttribute("data-actor-email")!;
    const createdAt = node.getAttribute("data-created-at")!;
    const references = JSON.parse(node.getAttribute("data-references") ?? "[]");

    setActiveSuggestion((prev) => {
      const next = prev?.groupId === groupId ? null : { groupId, type: suggestionType, actorEmail, createdAt, references };
      return next;
    });
  }, []);

  function cloneTooltipState(
    tooltip: TooltipState | null,
  ): TooltipState | null {
    return tooltip
      ? {
          ...tooltip,
          references: [...tooltip.references],
        }
      : null;
  }

  function snapshotAndApply(fn: () => void, type: ReviewAction) {
    const snapshot = captureRuntimeSnapshot();
 
    const beforeDeltaForReject = type === "REJECT"
      ? segmentsToDelta(snapshot.segments)  // which is better to use here, segmentsToDelta or quillRef.current!.getContents(), in terms of efficiency and functionality
      : null;

 
    fn();
 
    reviewHistory.current.push({ type, snapshot });
 
    if (type === "REJECT") {
      const afterDelta = quillRef.current!.getContents();
      const redoDelta  = beforeDeltaForReject!.diff(afterDelta);
      const stripped   = stripSuggestionAttributes(redoDelta);
      rejectedChanges.current.push(stripped);
    }
  }

  async function undo() {
    if (reviewHistory.current.length === 0) {
      return;
    }
 
    const entry = reviewHistory.current[reviewHistory.current.length - 1];
 
    const suspended = suspendActiveFormatOverlay();
 
    try {
      reviewSegmentsRef.current = cloneSegments(entry.snapshot.segments);
 
      refreshEditorFromRuntime();
 
      setFormatSuggestions(cloneFormatSuggestions(entry.snapshot.formatSuggestions));
      setActiveFormatId(entry.snapshot.activeFormatId);
      setActiveSuggestion(cloneTooltipState(entry.snapshot.activeSuggestion));
 
    } finally {
      restoreActiveFormatOverlay(suspended);
    }
 
    if (entry.type === "REJECT") {
      rejectedChanges.current.pop();
    } else {
      acceptedReferences.current.pop();
    }
 
    reviewHistory.current.pop();
  }

  function acceptChange(
    groupId: string,
    type: "insert" | "delete" | "format",
    references: OpReference[],
  ) {
    if (type === "format") {
      const item = formatSuggestionsRef.current.find((f) => f.groupId === groupId);
      if (!item) return;
      acceptFormatSuggestion(item);
      closeReviewTooltip();
      return;
    }
 
    snapshotAndApply(() => {
      const suspended = suspendActiveFormatOverlay();
 
      try {
        const quill = quillRef.current!;
        acceptedReferences.current.push(references);
 
        if (type === "insert") {
          reviewSegmentsRef.current = removeInsertSuggestionFromSegments(
            reviewSegmentsRef.current,
            groupId,
          );
 
          refreshEditorFromRuntime();
          updateFormatSuggestionsAfterInsertAccept(groupId);
 
          const activeId = activeFormatIdRef.current;
          if (activeId) {
            const activeItem = formatSuggestionsRef.current.find((f) => f.groupId === activeId);
            if (activeItem) quill.updateContents(buildFormatOverlayDelta(activeItem), "api");
          }
 
        } else if (type === "delete") {
          const range = findDeleteGroupRangeInRuntime(reviewSegmentsRef.current, groupId);
          if (!range) return;
 
          let cursor = 0;
          const nextSegments: ReviewSegment[] = [];
 
          for (const seg of reviewSegmentsRef.current) {
            const segStart = cursor;
            const segEnd   = cursor + seg.text.length;
            cursor = segEnd;
 
            // Segment is entirely outside the deleted range — keep it as-is.
            if (segEnd <= range.index || segStart >= range.index + range.length) {
              nextSegments.push(seg);
              continue;
            }
 
            // Segment overlaps the deleted range — keep only the parts outside it.
            // BUG FIX: surviving partial pieces must NOT inherit suggestion-delete
            // from the parent segment. They become plain committed content, so
            // restore their committed formatting from baseAttributes.
            const leftLen  = Math.max(0, range.index - segStart);
            const rightLen = Math.max(0, segEnd - (range.index + range.length));
 
            // Committed attrs for the surviving pieces = baseAttributes of the seg.
            // (For a committed deleted run, seg.attrs has suggestion-delete and
            // seg.baseAttributes has the real formatting like bold:true.)
            const committedAttrs = seg.baseAttributes ?? {};
 
            if (leftLen > 0) {
              nextSegments.push({
                ...seg,
                id:             nextRuntimeSegmentId(),
                text:           seg.text.slice(0, leftLen),
                attrs:          Object.keys(committedAttrs).length > 0 ? { ...committedAttrs } : {},
                baseAttributes: { ...committedAttrs },
              });
            }
            if (rightLen > 0) {
              nextSegments.push({
                ...seg,
                id:             nextRuntimeSegmentId(),
                text:           seg.text.slice(seg.text.length - rightLen),
                attrs:          Object.keys(committedAttrs).length > 0 ? { ...committedAttrs } : {},
                baseAttributes: { ...committedAttrs },
              });
            }
          }
 
          reviewSegmentsRef.current = mergeAdjacentSegments(nextSegments);
          refreshEditorFromRuntime();
        }
      } finally {
        restoreActiveFormatOverlay(suspended);
      }
    }, "ACCEPT");
 
    setActiveSuggestion((prev) => (prev?.groupId === groupId ? null : prev));
  }
 
  function rejectChange(groupId: string, type: "insert" | "delete" | "format") {
    if (type === "format") {
      const item = formatSuggestionsRef.current.find((f) => f.groupId === groupId);
      if (!item) return;
      rejectFormatSuggestion(item);
      closeReviewTooltip();
      return;
    }
 
    snapshotAndApply(() => {
      const suspended = suspendActiveFormatOverlay();
 
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
 
          // FIX 1: assign the return value (pure function).
          // FIX 2: pass insertRange so deleteInsertGroupSegments can strip
          //        committed newlines that were stranded inside the deleted range
          //        (orphaned \n chars that create empty lines after deletion).
          reviewSegmentsRef.current = deleteInsertGroupSegments(
            reviewSegmentsRef.current,
            groupId,
            range,
          );
 
          reviewSegmentsRef.current = normalizeLineBreaksAfterRejectedInsert(
            reviewSegmentsRef.current,
            range,
            removedText,
            nextRuntimeSegmentId,
          );
 
          refreshEditorFromRuntime();
 
          const updated = formatSuggestions
            .map((item) => ({
              ...item,
              spans: transformSpansAfterRuntimeInsertRemoval(item.spans, range.index, range.length),
              dependsOnInsertGroupIds: item.dependsOnInsertGroupIds.filter((id) => id !== groupId),
            }))
            .filter((item) => item.spans.length > 0);
 
          setFormatSuggestions(refreshPreviewTextsAgainstRuntime(updated));
 
        } else if (type === "delete") {
          // Rejecting a delete: the text stays, we just strip the suggestion-delete
          // marker and restore the committed formatting from baseAttributes.
          reviewSegmentsRef.current = mergeAdjacentSegments(
            reviewSegmentsRef.current.map((seg) => {
              const deleteAttr =
                seg.attrs["suggestion-delete"] ?? seg.attrs["suggestion-delete-newline"];
              if (!deleteAttr || deleteAttr.groupId !== groupId) return seg;
 
              const {
                "suggestion-delete":         _d,
                "suggestion-delete-newline": _dn,
                ...rest
              } = seg.attrs;
 
              // BUG FIX: restore committed formatting from baseAttributes.
              // Without this, deleted committed runs that had formatting (bold,
              // italic, etc.) lose it after rejection because their attrs only
              // contained suggestion-delete and the real formatting was only in
              // baseAttributes.
              const restored: Record<string, any> = {
                ...(seg.baseAttributes ?? {}),
                ...rest,
              };
 
              return { ...seg, attrs: Object.keys(restored).length > 0 ? restored : {} };
            }),
          );
 
          refreshEditorFromRuntime();
        }
      } finally {
        restoreActiveFormatOverlay(suspended);
      }
    }, "REJECT");
 
    setActiveSuggestion((prev) => (prev?.groupId === groupId ? null : prev));
  }

  function acceptFormatSuggestion(item: FormatSuggestionItem) {
    const canAct = canActOnFormatSuggestion(item);

    if (!canAct) {
      return;
    }

    snapshotAndApply(() => {
      const quill = quillRef.current!;
      quill.updateContents(buildFormatOverlayClearDelta(item), "api");
      acceptedReferences.current.push(item.references);
      setFormatSuggestions((prev) => {
        const next = prev.filter((f) => f.groupId !== item.groupId);
        return next;
      });
      setActiveFormatId(null);
    }, "ACCEPT");
  }

  function rejectFormatSuggestion(item: FormatSuggestionItem) {
    const canAct = canActOnFormatSuggestion(item);

    if (!canAct) {
      return;
    }

    snapshotAndApply(() => {
      const quill = quillRef.current!;
      quill.updateContents(buildFormatOverlayClearDelta(item), "api");

      reviewSegmentsRef.current = restoreFormatSuggestionToBase(
        reviewSegmentsRef.current,
        item,
      );

      refreshEditorFromRuntime();

      setFormatSuggestions((prev) => {
        const next = prev.filter((f) => f.groupId !== item.groupId);
        return next;
      });
      setActiveFormatId(null);
    }, "REJECT");
  }

  async function sendCursorChange(position: number) {
    if (isReviewing) return;
    await apiFetch(`notes/${noteId}/cursor`, {
      method: "POST",
      body: JSON.stringify({ position }),
    });
  }

  function handleCursorChange(payload: CursorPayload) {
    if (isReviewing || payload.actorEmail === user!.email) return;
    const cursor = quillRef.current!.getModule("cursors") as CursorModule;
    cursor.createCursor(
      payload.actorEmail,
      payload.actorEmail,
      collaborators[payload.actorEmail],
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
        if (pending) {
          sendOperationToServer(pending);
        }
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
    if (isReviewing) {
      return;
    }
    await apiFetch(`notes/${noteId}/enqueue`, {
      method: "POST",
      body: JSON.stringify(
        new TextOperation(
          "",
          operation.delta,
          user!.email,
          operation.revision,
          OperationState.PENDING,
          new Date().toISOString().slice(0, 19),
        ),
      ),
    });
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
    await apiFetch(`notes/${noteId}/review`, { method: "GET" });

    const quill = quillRef.current;
    if (!quill) {
      return;
    }
    
    const run = async () => {
      const projection = await apiFetch<ReviewProjection>(`notes/${noteId}/build-attribution`, {
        method: "GET",
      });
      
      if (projection.visualDelta.ops.length > 0 || projection.formatSuggestions.length > 0) {
        quill.setContents(new Delta(projection.baseDelta.ops), "api");
        quill.updateContents(new Delta(projection.visualDelta.ops), "api");
        setFormatSuggestions(projection.formatSuggestions);
      }
      
      setHasPendingSuggestions(
        projection.visualDelta.ops.length > 0 || projection.formatSuggestions.length > 0
      );
      
      reviewSegmentsRef.current = deltaToSegments(
        quill.getContents(),
        nextRuntimeSegmentId,
      );
      console.log(JSON.stringify(reviewSegmentsRef.current));

      quill.root.removeEventListener("click", handleClick);
      quill.root.addEventListener("click", handleClick);
    };

    run();
  }

  function handleReviewInProgress(payload: ReviewInProgressResponse) {
    if (payload.state === false && note?.ownerEmail !== user?.email) {
      quillRef.current = null;
    }
    setIsReviewing(payload.state);
    if (isOwner.current && payload.state === true) {
      setShowReviewSidebarModal(true);
    }
  }

  async function handleExitReview() {
    try {
      await apiFetch(`notes/${noteId}/review/exit`, { method: "GET" });
      setFormatSuggestions([]);
      setActiveFormatId(null);
      setHasPendingSuggestions(false);
      setIsReviewing(false);
      setShowReviewSidebarModal(false);
      setActiveSuggestion(null);
      reviewHistory.current = [];
      rejectedChanges.current = [];
      acceptedReferences.current = [];
      await loadNoteAndJoin();
    } catch (err: any) {
      setErrorMessageMessage(err.message);
    }
  }

  async function openSettings() {
    await saveNote();
    router.push(`/notes/${noteId}/edit/note-setting`);
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

      const flatRefs = acceptedReferences.current.flat();
      const mergedRefs = mergeOpReferences(flatRefs);

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
          acceptedReferences: mergedRefs,
        }),
      });

      handleExitReview();
    } catch (err: any) {
      setErrorMessageMessage(err.message);
    }
  }

  function suspendActiveFormatOverlay(): FormatSuggestionItem | null {
    const quill = quillRef.current;
    if (!quill) return null;

    const activeId = activeFormatIdRef.current;
    if (!activeId) {
      return null;
    }

    const activeItem =
      formatSuggestionsRef.current.find((f) => f.groupId === activeId) ?? null;

    if (activeItem) {
      quill.updateContents(buildFormatOverlayClearDelta(activeItem), "api");
    }

    return activeItem;
  }

  function restoreActiveFormatOverlay(item: FormatSuggestionItem | null) {
    const quill = quillRef.current;
    if (!quill || !item) {
      return;
    }
    quill.updateContents(buildFormatOverlayDelta(item), "api");
  }

  function isInsertGroupStillPending(groupId: string): boolean {
    const quill = quillRef.current;
    if (!quill) return false;

    const found = !!quill.root.querySelector(
      `[data-suggestion-type="insert"][data-group-id="${groupId}"]`,
    );
    return found;
  }

  function canActOnFormatSuggestion(item: FormatSuggestionItem): boolean {
    const canAct = item.dependsOnInsertGroupIds.every(
      (groupId) => !isInsertGroupStillPending(groupId),
    );
    return canAct;
  }

  function closeReviewTooltip() {
    const quill = quillRef.current;

    if (
      quill &&
      activeSuggestionRef.current?.type === "format" &&
      activeFormatIdRef.current
    ) {
      const activeItem = formatSuggestionsRef.current.find(
        (f) => f.groupId === activeFormatIdRef.current,
      );

      if (activeItem) {
        quill.updateContents(buildFormatOverlayClearDelta(activeItem), "api");
      }

      setActiveFormatId(null);
    }

    setActiveSuggestion(null);
  }

  function nextRuntimeSegmentId() {
    _runtimeSegCtr += 1;
    return `seg_${_runtimeSegCtr}`;
  }
  
  function captureRuntimeSnapshot(): RuntimeSnapshot {
    return {
      segments: cloneSegments(reviewSegmentsRef.current),
      formatSuggestions: cloneFormatSuggestions(formatSuggestionsRef.current),
      activeSuggestion: activeSuggestionRef.current
        ? {
            ...activeSuggestionRef.current,
            references: [...activeSuggestionRef.current.references],
          }
        : null,
      activeFormatId: activeFormatIdRef.current,
    };
  }

  function refreshEditorFromRuntime() {
    const quill = quillRef.current!;
    const plainDelta = segmentsToPlainDelta(reviewSegmentsRef.current);
    const overlayDelta = segmentsToAttributeOverlayDelta(reviewSegmentsRef.current);

    quill.setContents(plainDelta, "api");
    quill.updateContents(overlayDelta, "api");
  }

  function updateFormatSuggestionsAfterInsertAccept(groupId: string) {
    setFormatSuggestions((prev) => {
      const next = prev.map((item) => ({
        ...item,
        dependsOnInsertGroupIds: item.dependsOnInsertGroupIds.filter(
          (id) => id !== groupId,
        ),
      }));
      return next;
    });
  }

  function refreshPreviewTextsAgainstRuntime(items: FormatSuggestionItem[]) {
    return items.map((item) => {
      const text = item.spans
        .map((span) =>
          getRuntimeTextInRange(
            reviewSegmentsRef.current,
            span.start,
            span.length,
          ),
        )
        .join("")
        .replace(/\n/g, " ↵ ")
        .slice(0, 60);

      return {
        ...item,
        previewText: text,
      };
    });
  }

  if (loadingUser) return <div className="container-wide">Checking session...</div>;

  if (!user) {
    router.push("/login");
    return null;
  }

  if (isLoading) return <div className="container-wide">Loading note...</div>;

  if (errorMessage) {
    return (
      <div className="container-wide" style={{ color: "red" }}>
        {errorMessage}
      </div>
    );
  }

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
                  Collaborators:{" "}
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
            <button
              className="btn-icon"
              title="Settings"
              onClick={openSettings}
            >
              ⚙️
            </button>
            <div
              style={{
                width: "1px",
                background: "var(--border)",
                margin: "0 4px",
              }}
            />

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
                onClick={undo}
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
          <p
            style={{ color: "var(--text-muted)", maxWidth: "400px", margin: 0 }}
          >
            The owner is reviewing proposed changes. The editor will be
            available once review is complete.
          </p>
        </div>
      ) : (
        <>
          {isReviewing && isOwner.current && !hasPendingSuggestions && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#f9fafb",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                textAlign: "center",
                padding: "2rem",
                gap: "1rem",
                marginBottom: "1rem",
              }}
            >
              <div style={{ fontSize: "2.5rem" }}>✅</div>
              <h3 style={{ color: "var(--text)", margin: 0 }}>
                No pending changes
              </h3>
              <p
                style={{
                  color: "var(--text-muted)",
                  maxWidth: "400px",
                  margin: 0,
                }}
              >
                All changes have been reviewed.
              </p>
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
                display:
                  isReviewing &&
                  note.accessRole === "OWNER" &&
                  !hasPendingSuggestions
                    ? "none"
                    : "block",
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
                formatSuggestions={formatSuggestions.filter(
                  canActOnFormatSuggestion,
                )}
                activeFormatId={activeFormatId}
                onActivateFormat={activateFormatSuggestion}
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
          onAccept={acceptChange}
          onReject={rejectChange}
          onClose={closeReviewTooltip}
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