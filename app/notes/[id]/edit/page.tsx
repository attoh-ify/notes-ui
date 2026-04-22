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
  segmentsToDelta,
  stripSuggestionAttributes,
  transformSpansAfterRuntimeInsertRemoval,
  getRuntimeTextInRange,
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
      console.log(`[HIGHLIGHT] Activating highlight for groupId=${activeSuggestion.groupId} type=${activeSuggestion.type}`);
      const selector = getSuggestionSelector(activeSuggestion.groupId, activeSuggestion.type);

      quill.root.querySelectorAll(selector).forEach((el) => {
        el.classList.add("active");
      });
    } else {
      console.log(`[HIGHLIGHT] Cleared all active highlights (no active suggestion)`);
    }
  }, [activeSuggestion]);

  useEffect(() => {
    const shouldShowEditor = !isReviewing || note?.accessRole === "OWNER";

    console.log(`[EDITOR_INIT] isLoading=${isLoading} isReviewing=${isReviewing} accessRole="${note?.accessRole ?? "unknown"}" shouldShowEditor=${shouldShowEditor} quillAlreadyMounted=${!!quillRef.current}`);

    if (
      !isLoading &&
      editorRef.current &&
      !quillRef.current &&
      shouldShowEditor
    ) {
      const init = async () => {
        console.log(`[EDITOR_INIT] Mounting Quill editor — isReviewing=${isReviewing}`);
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

        console.log(`[EDITOR_INIT] Quill mounted successfully — readOnly=${isReviewing}`);

        if (docStateRef.current?.document) {
          console.log(`[EDITOR_INIT] Setting initial document contents from docState`);
          quillRef.current.setContents(docStateRef.current.document, "api");
        }

        quillRef.current.on("text-change", (delta, _old, source) => {
          if (source !== "user") return;
          const range = quillRef.current?.getSelection();
          if (range) sendCursorChange(range.index ?? -1);
          console.log("delta", delta);

          console.log(`[TEXT_CHANGE] User-triggered text change — deltaOpCount=${delta.ops.length}`);
          docStateRef.current?.queueOperation(
            delta,
            async (op: TextOperation) => {
              isSyncComplete.current = false;
              if (!stompClientRef.current?.connected) {
                console.log(`[TEXT_CHANGE] STOMP not connected — operation queued but not sent`);
                return;
              }
              console.log(`[TEXT_CHANGE] Sending operation to server — revision=${op.revision}`);
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
      console.log(`[ACTIVATE_FORMAT] Cannot activate — Quill not mounted`);
      return;
    }

    const fmts = formatSuggestionsRef.current;
    const prevId = activeFormatIdRef.current;

    console.log(`[ACTIVATE_FORMAT] Activating groupId=${groupId} prevActiveId="${prevId ?? "none"}"`);

    if (prevId) {
      const prev = fmts.find((f) => f.groupId === prevId);
      if (prev) {
        console.log(`[ACTIVATE_FORMAT] Clearing overlay for previously active groupId=${prevId}`);
        quill.updateContents(buildFormatOverlayClearDelta(prev), "api");
      } else {
        console.log(`[ACTIVATE_FORMAT] WARNING — prevId=${prevId} not found in formatSuggestions, could not clear overlay`);
      }
    }

    if (prevId === groupId) {
      console.log(`[ACTIVATE_FORMAT] Same groupId clicked again — toggling OFF, closing tooltip`);
      closeReviewTooltip();
      return;
    }

    const item = fmts.find((f) => f.groupId === groupId);
    if (!item) {
      console.log(`[ACTIVATE_FORMAT] WARNING — groupId=${groupId} not found in formatSuggestions`);
      return;
    }

    console.log(`[ACTIVATE_FORMAT] Applying overlay for groupId=${groupId} actor=${item.actorEmail} spanCount=${item.spans.length}`);
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
      console.log(`[LOAD_NOTE] Skipping — noteId="${noteId}" user="${user?.email ?? "null"}"`);
      return;
    }

    console.log(`[LOAD_NOTE] Loading note noteId=${noteId} for user=${user.email}`);

    try {
      const noteData = await apiFetch<Note>(`notes/${noteId}`, {
        method: "GET",
      });
      setNote(noteData);
      console.log(`[LOAD_NOTE] Fetched note — title="${noteData.title}" accessRole="${noteData.accessRole}" ownerEmail="${noteData.ownerEmail}"`);

      if (noteData.accessRole === "VIEWER") {
        console.log(`[LOAD_NOTE] User is VIEWER — redirecting to view-only page`);
        router.push(`/notes/${noteId}`);
        return;
      }

      // TODO: change JoinResponse to pass isReviewing isntead of returning null when isReviewing
      const joinData = await apiFetch<JoinResponse>(`notes/${noteId}/join`, {
        method: "GET",
      });

      if (joinData === null) {
        console.log(`[LOAD_NOTE] joinData is null — review is already in progress, entering review mode`);
        setIsReviewing(true);
        return;
      }

      console.log(`[LOAD_NOTE] Joined note — revision=${joinData.revision} collaboratorCount=${Object.keys(joinData.collaborators).length}`);
      docStateRef.current!.lastSyncedRevision = joinData.revision;
      docStateRef.current!.setDocument(new Delta(joinData.delta.ops || []));
      setCollaborators(joinData.collaborators);

      if (noteData.accessRole === "OWNER") {
        isOwner.current = true;
        console.log(`[LOAD_NOTE] User is OWNER`);
      }
    } catch (err: any) {
      console.log(`[LOAD_NOTE] ERROR — ${err.message}`);
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
      console.log(`[STOMP_INIT] Skipping STOMP setup — noteId="${noteId}" isLoading=${isLoading}`);
      return;
    }

    console.log(`[STOMP_INIT] Connecting to STOMP for noteId=${noteId}`);

    const client = Stomp.over(
      () => new SockJS(`${API_BASE_URL}/relay?noteId=${noteId}`),
    );
    client.debug = () => {};
    stompClientRef.current = client;

    client.connect({}, () => {
      console.log(`[STOMP_INIT] Connected — subscribing to /topic/note/${noteId}`);
      client.subscribe(`/topic/note/${noteId}`, (message) => {
        const { type, payload } = JSON.parse(message.body);
        console.log(`[STOMP_MSG] Received type=${type}`);
        if (type === MessageType.OPERATION) handleRemoteOperation(payload);
        if (type === MessageType.COLLABORATOR_JOIN) {
          console.log(`[STOMP_MSG] Collaborator joined — updating collaborators`);
          setCollaborators(payload.collaborators);
        }
        if (type === MessageType.COLLABORATOR_CURSOR) {
          handleCursorChange(payload);
        }
        if (type === MessageType.REVIEW_IN_PROGRESS) {
          console.log(`[STOMP_MSG] Review in progress message received`);
          handleReviewInProgress(payload);
        }
      });

      if (docStateRef.current?.sentOperation && !isSyncComplete.current) {
        console.log(`[STOMP_INIT] Reconnected with unsent operation — resending`);
        sendOperationToServer(docStateRef.current.sentOperation);
        isSyncComplete.current = true;
      }
    });

    return () => {
      if (client.active) {
        console.log(`[STOMP_INIT] Disconnecting STOMP client`);
        client.disconnect();
      }
    };
  }, [noteId, isLoading]);

  // useEffect(() => {
  //   if (!user || !isReviewing) {
  //     console.log(`[REVIEW_LOG_FETCH] Skipping — user="${user?.email ?? "null"}" isReviewing=${isReviewing}`);
  //     return;
  //   }

  //   console.log(`[REVIEW_LOG_FETCH] Entering review mode — fetching revision log for noteId=${noteId}`);

  //   (async () => {
  //     try {
  //       const noteData = await apiFetch<Note>(`notes/${noteId}`, {
  //         method: "GET",
  //       });
  //       setNote(noteData);
  //       console.log(`[REVIEW_LOG_FETCH] Fetched note — title="${noteData.title}" accessRole="${noteData.accessRole}"`);
  //     } catch (err: any) {
  //       console.log(`[REVIEW_LOG_FETCH] ERROR — ${err.message}`);
  //       setErrorMessageMessage(err.message || "Failed to fetch note data");
  //     } finally {
  //       setIsloading(false);
  //     }
  //   })();
  // }, [user, isReviewing, noteId]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) {
      console.log(`[REVIEW_MODE_TOGGLE] Quill not mounted yet — skip toggle`);
      return;
    }

    const toolbar = editorRef.current?.previousSibling as HTMLElement;
    const isToolbar = toolbar?.classList.contains("ql-toolbar");

    console.log(`[REVIEW_MODE_TOGGLE] isReviewing=${isReviewing} toolbarFound=${isToolbar}`);

    if (isReviewing) {
      quill.enable(false);
      if (isToolbar) toolbar.style.display = "none";
      console.log(`[REVIEW_MODE_TOGGLE] Editor DISABLED for review — toolbar hidden`);
    } else {
      quill.enable(true);
      if (isToolbar) toolbar.style.display = "block";
      console.log(`[REVIEW_MODE_TOGGLE] Editor ENABLED for editing — toolbar shown`);
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
        console.log(
          `[HOVER] Hovering groupId=${hoveredGroupId} type=${hoveredType}`
        );
      }
    };

    const onMouseLeave = () => {
      if (
        hoveredGroupId &&
        hoveredType &&
        hoveredGroupId !== activeSuggestionRef.current?.groupId
      ) {
        setGroupHoverState(hoveredGroupId, false, hoveredType);
        console.log(`[HOVER] Left groupId=${hoveredGroupId} type=${hoveredType}`);
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
      console.log(`[CLICK] Clicked outside any suggestion node — clearing active suggestion`);
      setActiveSuggestion(null);
      return;
    }

    const type = node.getAttribute("data-suggestion-type");
    if (type === "format") {
      console.log(`[CLICK] Clicked on format suggestion node — handled by sidebar, not tooltip`);
      return;
    }

    const suggestionType = node.getAttribute(
      "data-suggestion-type",
    ) as TooltipState["type"];
    const groupId = node.getAttribute("data-group-id")!;
    const actorEmail = node.getAttribute("data-actor-email")!;
    const createdAt = node.getAttribute("data-created-at")!;
    const references = JSON.parse(node.getAttribute("data-references") ?? "[]");

    console.log(`[CLICK] Clicked on suggestion — type=${suggestionType} groupId=${groupId} actor=${actorEmail}`);

    setActiveSuggestion((prev) => {
      const next = prev?.groupId === groupId ? null : { groupId, type: suggestionType, actorEmail, createdAt, references };
      console.log(`[CLICK] Toggling activeSuggestion — was="${prev?.groupId ?? "none"}" now="${next?.groupId ?? "none"}"`);
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
 
    console.log(`\n[SNAPSHOT] Action=${type} — capturing state BEFORE fn()`);
    console.log(`[SNAPSHOT] formatSuggestionCount=${snapshot.formatSuggestions.length} activeFormatId="${snapshot.activeFormatId ?? "none"}" activeSuggestionGroupId="${snapshot.activeSuggestion?.groupId ?? "none"}"`);
    console.log(`[SNAPSHOT] segmentCount=${snapshot.segments.length}`);
 
    const beforeDeltaForReject = type === "REJECT"
      ? segmentsToDelta(snapshot.segments)  // which is better to use here, segmentsToDelta or quillRef.current!.getContents(), in terms of efficiency and functionality
      : null;

 
    fn();
 
    reviewHistory.current.push({ type, snapshot });
    console.log(`[SNAPSHOT] Pushed to reviewHistory — historyLength=${reviewHistory.current.length}`);
 
    if (type === "REJECT") {
      const afterDelta = quillRef.current!.getContents();
      const redoDelta  = beforeDeltaForReject!.diff(afterDelta);
      const stripped   = stripSuggestionAttributes(redoDelta);
      rejectedChanges.current.push(stripped);
      console.log(`[SNAPSHOT] REJECT — pushed stripped redoDelta to rejectedChanges, total=${rejectedChanges.current.length}`);
    }
  }

  async function undo() {
    console.log(`\n[UNDO] Triggered — historyLength=${reviewHistory.current.length}`);
 
    if (reviewHistory.current.length === 0) {
      console.log(`[UNDO] History is empty — nothing to undo`);
      return;
    }
 
    const entry = reviewHistory.current[reviewHistory.current.length - 1];
    console.log(`[UNDO] Reverting action type=${entry.type} — restoring snapshot with segmentCount=${entry.snapshot.segments.length} formatSuggestionCount=${entry.snapshot.formatSuggestions.length}`);
 
    const suspended = suspendActiveFormatOverlay();
 
    try {
      reviewSegmentsRef.current = cloneSegments(entry.snapshot.segments);
      console.log(`[UNDO] Runtime segments restored — segmentCount=${reviewSegmentsRef.current.length}`);
 
      refreshEditorFromRuntime();
      console.log(`[UNDO] Editor refreshed from restored runtime segments`);
 
      setFormatSuggestions(cloneFormatSuggestions(entry.snapshot.formatSuggestions));
      setActiveFormatId(entry.snapshot.activeFormatId);
      setActiveSuggestion(cloneTooltipState(entry.snapshot.activeSuggestion));
 
      console.log(`[UNDO] State fully restored — formatCount=${entry.snapshot.formatSuggestions.length} activeFormatId="${entry.snapshot.activeFormatId ?? "none"}" activeSuggestionGroupId="${entry.snapshot.activeSuggestion?.groupId ?? "none"}"`);
    } finally {
      restoreActiveFormatOverlay(suspended);
    }
 
    if (entry.type === "REJECT") {
      rejectedChanges.current.pop();
      console.log(`[UNDO] Popped last rejectedChange — remaining=${rejectedChanges.current.length}`);
    } else {
      acceptedReferences.current.pop();
      console.log(`[UNDO] Popped last acceptedReferences — remaining=${acceptedReferences.current.length}`);
    }
 
    reviewHistory.current.pop();
    console.log(`[UNDO] Popped history entry — historyLength now=${reviewHistory.current.length}`);
  }

  function acceptChange(
    groupId: string,
    type: "insert" | "delete" | "format",
    references: OpReference[],
  ) {
    console.log(`\n[ACCEPT] Triggered — groupId=${groupId} type=${type} referenceCount=${references.length}`);

    if (type === "format") {
      console.log(`[ACCEPT] Format suggestion — delegating to acceptFormatSuggestion`);
      const item = formatSuggestionsRef.current.find(
        (f) => f.groupId === groupId,
      );
      if (!item) {
        console.log(`[ACCEPT] WARNING — format groupId=${groupId} not found in formatSuggestions`);
        return;
      }
      acceptFormatSuggestion(item);
      closeReviewTooltip();
      return;
    }

    snapshotAndApply(() => {
      const suspended = suspendActiveFormatOverlay();  // is this really necessary? the only way to accept an insert or delete is to click on the suggestion, which removes any other active suggestion first. so is there ever going to be a point where I have to suspend an active format suggestion to accept an insert or delete without clicking that insert or delete first, which will on its own remove the format suggestion (or any other active suggestions).

      try {
        const quill = quillRef.current!;
        acceptedReferences.current.push(references);
        console.log(`[ACCEPT] Pushed references to acceptedReferences — total=${acceptedReferences.current.length}`);

        if (type === "insert") {
          console.log(`[ACCEPT] INSERT accept — groupId=${groupId}`);

          removeInsertSuggestionFromSegments(reviewSegmentsRef.current, groupId);
          console.log(`[ACCEPT] Removed insert suggestion from segments — remaining segmentCount=${reviewSegmentsRef.current.length}`);

          refreshEditorFromRuntime();  // why this extra processing???
          console.log(`[ACCEPT] Editor refreshed after insert accept`);

          updateFormatSuggestionsAfterInsertAccept(groupId);
          console.log(`[ACCEPT] Format suggestions updated — removed dependency on insertGroupId=${groupId}`);

          const activeId = activeFormatIdRef.current;
          if (activeId) {
            const activeItem = formatSuggestionsRef.current.find(
              (f) => f.groupId === activeId,
            );
            if (activeItem) {
              console.log(`[ACCEPT] Reapplying active format overlay for groupId=${activeId} after insert accept`);
              quill.updateContents(buildFormatOverlayDelta(activeItem), "api");
            }
          }
        } else if (type === "delete") {
          console.log(`[ACCEPT] DELETE accept — groupId=${groupId} — removing range from runtime`);

          const range = findDeleteGroupRangeInRuntime(reviewSegmentsRef.current, groupId);

          if (!range) {
            console.log(`[ACCEPT] WARNING — could not find runtime range for delete groupId=${groupId}`);
            return;
          }

          console.log(`[ACCEPT] Deleting delete-group range index=${range.index} length=${range.length}`);

          let cursor = 0;
          const nextSegments: ReviewSegment[] = [];

          for (const seg of reviewSegmentsRef.current) {
            const segStart = cursor;
            const segEnd = cursor + seg.text.length;

            if (segEnd <= range.index || segStart >= range.index + range.length) {
              nextSegments.push(seg);
            } else {
              const leftCut = Math.max(0, range.index - segStart);
              const rightCut = Math.max(0, segEnd - (range.index + range.length));

              if (leftCut > 0) {
                nextSegments.push({
                  ...seg,
                  id: nextRuntimeSegmentId(),
                  text: seg.text.slice(0, leftCut),
                });
              }

              if (rightCut > 0) {
                nextSegments.push({
                  ...seg,
                  id: nextRuntimeSegmentId(),
                  text: seg.text.slice(seg.text.length - rightCut),
                });
              }
            }

            cursor = segEnd;
          }

          reviewSegmentsRef.current = mergeAdjacentSegments(nextSegments);
          refreshEditorFromRuntime();  // why this extra processing???
          console.log(`[ACCEPT] Runtime updated after delete accept — segmentCount=${reviewSegmentsRef.current.length}`);
        }
      } finally {
        restoreActiveFormatOverlay(suspended);
      }
    }, "ACCEPT");

    setActiveSuggestion((prev) =>
      prev?.groupId === groupId ? null : prev,
    );
    console.log(`[ACCEPT] Done — cleared activeSuggestion if it matched groupId=${groupId}`);
  }

  function rejectChange(groupId: string, type: "insert" | "delete" | "format") {
    console.log(`\n[REJECT] Triggered — groupId=${groupId} type=${type}`);

    if (type === "format") {
      console.log(`[REJECT] Format suggestion — delegating to rejectFormatSuggestion`);
      const item = formatSuggestionsRef.current.find(
        (f) => f.groupId === groupId,
      );
      if (!item) {
        console.log(`[REJECT] WARNING — format groupId=${groupId} not found in formatSuggestions`);
        return;
      }
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
        if (!range) {
          console.log(`[REJECT] WARNING — could not find DOM range for groupId=${groupId} type=${type}`);
          return;
        }

        if (type === "insert") {
          console.log(`[REJECT] INSERT reject — groupId=${groupId}`);

          console.log(`[REJECT] range index=${range.index} length=${range.length}`);

          const removedText = getRuntimeTextInRange(reviewSegmentsRef.current, range.index, range.length);
          console.log(`[REJECT] removedText="${removedText}"`);

          deleteInsertGroupSegments(reviewSegmentsRef.current, groupId);
          console.log(`[REJECT] Deleted insert group segments for groupId=${groupId} — remaining segmentCount=${reviewSegmentsRef.current.length}`);

          normalizeLineBreaksAfterRejectedInsert(reviewSegmentsRef.current, range, removedText, nextRuntimeSegmentId);  // study this
          console.log(`[REJECT] Normalized line breaks after rejected insert`);

          refreshEditorFromRuntime();  // why this extra processing???
          console.log(`[REJECT] Editor refreshed after insert reject`);

          const updated = formatSuggestions
            .map((item) => ({
              ...item,
              spans: transformSpansAfterRuntimeInsertRemoval(
                item.spans,
                range.index,
                range.length,
              ),
              dependsOnInsertGroupIds: item.dependsOnInsertGroupIds.filter(
                (id) => id !== groupId,
              ),
            }))
            .filter((item) => item.spans.length > 0);

          console.log(`[REJECT] Updated format suggestions — before=${formatSuggestions.length} after=${updated.length}`);

          setFormatSuggestions(refreshPreviewTextsAgainstRuntime(updated));
        } else if (type === "delete") {
          console.log(
            `[REJECT] DELETE reject — removing delete attrs from runtime for groupId=${groupId} range index=${range.index} length=${range.length}`
          );

          reviewSegmentsRef.current = mergeAdjacentSegments(
            reviewSegmentsRef.current.map((seg) => {
              const deleteAttr =
                seg.attrs["suggestion-delete"] ??
                seg.attrs["suggestion-delete-newline"];

              if (!deleteAttr || deleteAttr.groupId !== groupId) return seg;

              const {
                ["suggestion-delete"]: _d,
                ["suggestion-delete-newline"]: _dn,
                ...rest
              } = seg.attrs;

              return {
                ...seg,
                attrs: Object.keys(rest).length ? rest : {},
              };
            }),
          );

          refreshEditorFromRuntime();  // why this extra processing???
          console.log(
            `[REJECT] Runtime updated after delete reject — segmentCount=${reviewSegmentsRef.current.length}`
          );
        }
      } finally {
        restoreActiveFormatOverlay(suspended);
      }
    }, "REJECT");

    setActiveSuggestion((prev) =>
      prev?.groupId === groupId ? null : prev,
    );
    console.log(`[REJECT] Done — cleared activeSuggestion if it matched groupId=${groupId}`);
  }

  function acceptFormatSuggestion(item: FormatSuggestionItem) {
    console.log(`\n[ACCEPT_FORMAT] groupId=${item.groupId} actor=${item.actorEmail} spanCount=${item.spans.length}`);

    const canAct = canActOnFormatSuggestion(item);
    console.log(`[ACCEPT_FORMAT] canAct=${canAct} dependsOnInsertGroupIds="${item.dependsOnInsertGroupIds.join(",")}"`);

    if (!canAct) {
      console.log(`[ACCEPT_FORMAT] BLOCKED — still pending insert group(s) that must be resolved first`);
      return;
    }

    snapshotAndApply(() => {
      const quill = quillRef.current!;
      console.log(`[ACCEPT_FORMAT] Clearing overlay for groupId=${item.groupId}`);
      quill.updateContents(buildFormatOverlayClearDelta(item), "api");
      acceptedReferences.current.push(item.references);
      console.log(`[ACCEPT_FORMAT] Pushed references — total acceptedReferences=${acceptedReferences.current.length}`);
      setFormatSuggestions((prev) => {
        const next = prev.filter((f) => f.groupId !== item.groupId);
        console.log(`[ACCEPT_FORMAT] Removed groupId=${item.groupId} from formatSuggestions — remaining=${next.length}`);
        return next;
      });
      setActiveFormatId(null);
    }, "ACCEPT");
  }

  function rejectFormatSuggestion(item: FormatSuggestionItem) {
    console.log(`\n[REJECT_FORMAT] groupId=${item.groupId} actor=${item.actorEmail} attrKeys="${Object.keys(JSON.parse(item.attributes)).join(",")}"`);

    const canAct = canActOnFormatSuggestion(item);
    console.log(`[REJECT_FORMAT] canAct=${canAct} dependsOnInsertGroupIds="${item.dependsOnInsertGroupIds.join(",")}"`);

    if (!canAct) {
      console.log(`[REJECT_FORMAT] BLOCKED — still pending insert group(s) that must be resolved first`);
      return;
    }

    snapshotAndApply(() => {
      const quill = quillRef.current!;
      console.log(`[REJECT_FORMAT] Clearing overlay then nulling attrs for groupId=${item.groupId}`);
      quill.updateContents(buildFormatOverlayClearDelta(item), "api");

      const fmtAttrs = JSON.parse(item.attributes) as Record<string, any>;
      const nulled: Record<string, any> = {};
      for (const k of Object.keys(fmtAttrs)) nulled[k] = null;

      const nulledKeys = Object.keys(nulled).join(",");
      console.log(`[REJECT_FORMAT] Nulling attrs "${nulledKeys}" over ${item.spans.length} span(s)`);

      for (const span of item.spans) {
        console.log(`[REJECT_FORMAT] Applying null attrs at span start=${span.start} length=${span.length}`);
        quill.formatText(span.start, span.length, nulled, "api");
      }

      setFormatSuggestions((prev) => {
        const next = prev.filter((f) => f.groupId !== item.groupId);
        console.log(`[REJECT_FORMAT] Removed groupId=${item.groupId} — remaining=${next.length}`);
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
    console.log(`[CURSOR] Remote cursor update from actor=${payload.actorEmail} position=${payload.position}`);
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

    console.log(`[REMOTE_OP] Received from actor=${actorEmail} revision=${revision} state=${state}`);

    if (actorEmail === user!.email) {
      console.log(`[REMOTE_OP] This is our own op echoed back — acknowledging revision=${revision}`);
      docState.acknowledgeOperation(revision, (pending) => {
        isSyncComplete.current = false;
        if (pending) {
          console.log(`[REMOTE_OP] Sending next pending operation after ack`);
          sendOperationToServer(pending);
        }
      });
    } else {
      console.log(`[REMOTE_OP] Foreign op from actor=${actorEmail} — transforming and applying`);
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
      console.log(`[SEND_OP] Skipped — currently in review mode`);
      return;
    }
    console.log(`[SEND_OP] Sending operation to server — revision=${operation.revision}`);
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
    console.log(`[SAVE_NOTE] Saving note noteId=${noteId}`);
    try {
      await apiFetch(`notes/${noteId}/save`, { method: "POST" });
      console.log(`[SAVE_NOTE] Save successful`);
    } catch (err: any) {
      console.log(`[SAVE_NOTE] ERROR — ${err.message}`);
      setErrorMessageMessage(err.message || "Failed to save note");
    }
  }

  async function saveVersion(comment: string) {
    console.log(`[SAVE_VERSION] Saving version with comment="${comment}"`);
    try {
      await saveReviewChanges();
      await apiFetch(`notes/${noteId}/versions`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });
      console.log(`[SAVE_VERSION] Version saved successfully`);
    } catch (err: any) {
      console.log(`[SAVE_VERSION] ERROR — ${err.message}`);
      setErrorMessageMessage(err.message || "Failed to save version");
    }
  }

  async function handleReviewNote() {
    console.log(`[REVIEW_NOTE] Saving note then triggering review for noteId=${noteId}`);
    await saveNote();
    await apiFetch(`notes/${noteId}/review`, { method: "GET" });

    const quill = quillRef.current;
    if (!quill) {
      console.log(`[QUILL] quill=${quill ? "present" : "null"}`);
      return;
    }
    
    const run = async () => {
      const projection = await apiFetch<ReviewProjection>(`notes/${noteId}/build-attribution`, {
        method: "GET",
      });

      console.log(`[PROJECTION] Projection result - ${JSON.stringify(projection)}`);

      if (projection.visualDelta.ops.length === 0) {
        console.log(`[PROJECTION] visualDelta is empty — skipping setContents`);
        return;
      }

      console.log(`[PROJECTION] Applying visualDelta to Quill — opCount=${projection.visualDelta.ops.length} formatSuggestionCount=${projection.formatSuggestions.length}`);
      quill.setContents(new Delta(projection.visualDelta.ops), "api");
      console.log(`[PROJECTION] visualDelta applied to Quill: ${JSON.stringify(quill.getContents())}`);
      setFormatSuggestions(projection.formatSuggestions);
      setHasPendingSuggestions(true);

      reviewSegmentsRef.current = deltaToSegments(projection.visualDelta, nextRuntimeSegmentId);
      console.log(`[PROJECTION] Runtime initialized from projection — segmentCount=${reviewSegmentsRef.current.length}`);

      quill.root.removeEventListener("click", handleClick);
      quill.root.addEventListener("click", handleClick);
      console.log(`[PROJECTION] Click handler (re)attached to Quill root`);
    };

    run();

    console.log(`[REVIEW_NOTE] Review triggered`);
  }

  function handleReviewInProgress(payload: ReviewInProgressResponse) {
    console.log(`[REVIEW_IN_PROGRESS] state=${payload.state} isOwner=${isOwner.current} currentUserEmail=${user?.email ?? "null"} ownerEmail=${note?.ownerEmail ?? "unknown"}`);

    if (payload.state === false && note?.ownerEmail !== user?.email) {
      console.log(`[REVIEW_IN_PROGRESS] Review ended and current user is NOT owner — unmounting Quill ref`);
      quillRef.current = null;
    }
    setIsReviewing(payload.state);
    if (isOwner.current && payload.state === true) {
      console.log(`[REVIEW_IN_PROGRESS] Owner entered review — showing sidebar modal`);
      setShowReviewSidebarModal(true);
    }
  }

  async function handleExitReview() {
    console.log(`[EXIT_REVIEW] Exiting review mode for noteId=${noteId}`);
    try {
      await apiFetch(`notes/${noteId}/review/exit`, { method: "GET" });
      console.log(`[EXIT_REVIEW] Exit API call successful — resetting all review state`);
      setFormatSuggestions([]);
      setActiveFormatId(null);
      setHasPendingSuggestions(false);
      setIsReviewing(false);
      setShowReviewSidebarModal(false);
      setActiveSuggestion(null);
      reviewHistory.current = [];
      rejectedChanges.current = [];
      acceptedReferences.current = [];
      console.log(`[EXIT_REVIEW] State cleared — reloading note`);
      await loadNoteAndJoin();
    } catch (err) {
      console.log(`[EXIT_REVIEW] ERROR — ${err}`);
    }
  }

  async function openSettings() {
    await saveNote();
    router.push(`/notes/${noteId}/edit/note-setting`);
  }

  async function saveReviewChanges() {
    console.log(`\n[SAVE_REVIEW] Saving review changes — rejectedChangesCount=${rejectedChanges.current.length} acceptedReferenceGroupCount=${acceptedReferences.current.length}`);

    try {
      const currentActive = activeFormatIdRef.current;
      if (currentActive) {
        const item = formatSuggestionsRef.current.find(
          (f) => f.groupId === currentActive,
        );
        if (item) {
          console.log(`[SAVE_REVIEW] Clearing active format overlay for groupId=${currentActive} before save`);
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

      console.log(`[SAVE_REVIEW] Composed rejected delta — opCount=${delta.ops.length}`);

      const flatRefs = acceptedReferences.current.flat();
      const mergedRefs = mergeOpReferences(flatRefs);
      console.log(`[SAVE_REVIEW] Sending to API — flatRefCount=${flatRefs.length} mergedRefCount=${mergedRefs.length}`);

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

      console.log(`[SAVE_REVIEW] API call successful — calling handleExitReview`);
      handleExitReview();
    } catch (err) {
      console.log(`[SAVE_REVIEW] ERROR — ${err}`);
    }
  }

  function suspendActiveFormatOverlay(): FormatSuggestionItem | null {
    const quill = quillRef.current;
    if (!quill) return null;

    const activeId = activeFormatIdRef.current;
    if (!activeId) {
      console.log(`[OVERLAY_SUSPEND] No active format overlay to suspend`);
      return null;
    }

    const activeItem =
      formatSuggestionsRef.current.find((f) => f.groupId === activeId) ?? null;

    if (activeItem) {
      console.log(`[OVERLAY_SUSPEND] Suspending overlay for groupId=${activeId}`);
      quill.updateContents(buildFormatOverlayClearDelta(activeItem), "api");
    } else {
      console.log(`[OVERLAY_SUSPEND] activeId=${activeId} not found in formatSuggestions — nothing to clear`);
    }

    return activeItem;
  }

  function restoreActiveFormatOverlay(item: FormatSuggestionItem | null) {
    const quill = quillRef.current;
    if (!quill || !item) {
      if (!item) console.log(`[OVERLAY_RESTORE] No item to restore`);
      return;
    }
    console.log(`[OVERLAY_RESTORE] Restoring overlay for groupId=${item.groupId}`);
    quill.updateContents(buildFormatOverlayDelta(item), "api");
  }

  function isInsertGroupStillPending(groupId: string): boolean {
    const quill = quillRef.current;
    if (!quill) return false;

    const found = !!quill.root.querySelector(
      `[data-suggestion-type="insert"][data-group-id="${groupId}"]`,
    );
    console.log(`[IS_INSERT_PENDING] groupId=${groupId} — stillPending=${found}`);
    return found;
  }

  function canActOnFormatSuggestion(item: FormatSuggestionItem): boolean {
    const canAct = item.dependsOnInsertGroupIds.every(
      (groupId) => !isInsertGroupStillPending(groupId),
    );
    console.log(`[CAN_ACT_FORMAT] groupId=${item.groupId} dependsOnCount=${item.dependsOnInsertGroupIds.length} canAct=${canAct}`);
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
        console.log(`[CLOSE_TOOLTIP] Clearing format overlay for groupId=${activeFormatIdRef.current}`);
        quill.updateContents(buildFormatOverlayClearDelta(activeItem), "api");
      }

      setActiveFormatId(null);
    }

    console.log(`[CLOSE_TOOLTIP] Setting activeSuggestion=null`);
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
    const nextDelta = segmentsToDelta(reviewSegmentsRef.current);
    console.log(`[REFRESH_EDITOR] Calling setContents from ${reviewSegmentsRef.current.length} runtime segment(s) — deltaOpCount=${nextDelta.ops.length}`);
    quillRef.current!.setContents(nextDelta, "api");
  }

  function updateFormatSuggestionsAfterInsertAccept(groupId: string) {
    setFormatSuggestions((prev) => {
      const next = prev.map((item) => ({
        ...item,
        dependsOnInsertGroupIds: item.dependsOnInsertGroupIds.filter(
          (id) => id !== groupId,
        ),
      }));
      console.log(`[UPDATE_FORMAT_AFTER_ACCEPT] Removed insertGroupId=${groupId} from all dependencies — formatCount=${next.length}`);
      return next;
    });
  }

  function refreshPreviewTextsAgainstRuntime(items: FormatSuggestionItem[]) {
    const delta = segmentsToDelta(reviewSegmentsRef.current);
    const temp = quillRef.current!;
    const current = temp.getContents();

    console.log(`[REFRESH_PREVIEW_TEXTS] Refreshing preview for ${items.length} format suggestion(s) against current runtime`);

    temp.setContents(delta, "api");

    const refreshed = items.map((item) => {
      const text = item.spans
        .map((span) => temp.getText(span.start, span.length))
        .join("")
        .replace(/\n/g, " ↵ ")
        .slice(0, 60);

      console.log(`[REFRESH_PREVIEW_TEXTS] groupId=${item.groupId} new previewText="${text}"`);

      return {
        ...item,
        previewText: text,
      };
    });

    temp.setContents(current, "api");
    return refreshed;
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