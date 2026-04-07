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
  JoinResponse,
  messageType,
  Note,
  ReviewInProgressResponse,
  TooltipState,
} from "../../../../src/types";
import { AuditTooltip } from "@/components/AuditTooltip";
import ExitReviewModal from "@/components/ExitReviewModal";
import FormatSidebarModal from "@/components/FormatSidebarModal";
import {
  buildReviewProjection,
  buildFormatOverlayDelta,
  buildFormatOverlayClearDelta,
  FormatSuggestionItem,
  OpReference,
} from "@/src/lib/attribution";

type ReviewAction = "ACCEPT" | "REJECT";

interface ReviewEntry {
  type: ReviewAction;
  undoDelta: Delta;
  redoDelta: Delta;
  beforeFormatSuggestions: FormatSuggestionItem[];
  afterFormatSuggestions: FormatSuggestionItem[];
  beforeActiveFormatId: string | null;
  afterActiveFormatId: string | null;
  beforeActiveSuggestion: TooltipState | null;
  afterActiveSuggestion: TooltipState | null;
}

type RuntimeActionKind = "accept-insert" | "reject-insert";

interface ReviewSegment {
  id: string;
  text: string;
  attrs: Record<string, any>;
  references: OpReference[];
}

interface RuntimeSnapshot {
  segments: ReviewSegment[];
  formatSuggestions: FormatSuggestionItem[];
  activeSuggestion: TooltipState | null;
  activeFormatId: string | null;
}

interface RuntimeActionEntry {
  kind: RuntimeActionKind;
  before: RuntimeSnapshot;
  after: RuntimeSnapshot;
}

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
  const [revisionLog, setRevisionLog] = useState<TextOperation[] | null>(null);

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
  const runtimeHistoryRef = useRef<RuntimeActionEntry[]>([]);
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
      quill.root
        .querySelectorAll(`[data-group-id="${activeSuggestion.groupId}"]`)
        .forEach((el) => el.classList.add("active"));
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
          if (range) sendCursorChange(range.index ?? 0);

          docStateRef.current?.queueOperation(
            delta,
            async (op: TextOperation) => {
              isSyncComplete.current = false;
              if (!stompClientRef.current?.connected) return;
              await sendOperationToServer(op);
              isSyncComplete.current = true;
            },
          );
        });

        quillRef.current.on("selection-change", async (range, _old, source) => {
          if (source !== "user" || !range) return;
          sendCursorChange(range.index ?? 0);
        });
      };

      init();
    }
  }, [isLoading, isReviewing, note?.accessRole]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!revisionLog || !quill) return;

    let cancelled = false;

    const run = async () => {
      const committedOps = revisionLog.filter((op) => op.state === "COMMITTED");
      const pendingOps = revisionLog.filter((op) => op.state === "PENDING");

      if (pendingOps.length === 0) {
        let base = new Delta();
        for (const op of committedOps) {
          base = base.compose(new Delta(op.delta.ops));
        }
        quill.setContents(base, "api");
        setFormatSuggestions([]);
        setHasPendingSuggestions(false);
        return;
      }

      if (cancelled) return;

      const projection = await buildReviewProjection(
        noteId as string,
        committedOps,
        pendingOps,
      );

      quill.setContents(projection.visualDelta, "api");
      setFormatSuggestions(projection.formatSuggestions);
      setHasPendingSuggestions(true);

      initializeRuntimeFromProjection(projection);
      runtimeHistoryRef.current = [];

      quill.root.removeEventListener("click", handleClick);
      quill.root.addEventListener("click", handleClick);
    };

    run();

    return () => {
      cancelled = true;
      quillRef.current?.root.removeEventListener("click", handleClick);
    };
  }, [revisionLog, noteId]);

  const activateFormatSuggestion = useCallback((groupId: string) => {
    const quill = quillRef.current;
    if (!quill) return;

    const fmts = formatSuggestionsRef.current;
    const prevId = activeFormatIdRef.current;

    if (prevId) {
      const prev = fmts.find((f) => f.groupId === prevId);
      if (prev) quill.updateContents(buildFormatOverlayClearDelta(prev), "api");
    }

    if (prevId === groupId) {
      closeAuditTooltip();
      return;
    }

    const item = fmts.find((f) => f.groupId === groupId);
    if (!item) return;

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
    if (!noteId || !user) return;

    try {
      const noteData = await apiFetch<Note>(`notes/${noteId}`, {
        method: "GET",
      });
      setNote(noteData);

      if (noteData.accessRole === "VIEWER") {
        router.push(`/notes/${noteId}`);
        return;
      }

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
    if (!noteId || isLoading) return;

    const client = Stomp.over(
      () => new SockJS(`${API_BASE_URL}/relay?noteId=${noteId}`),
    );
    client.debug = () => {};
    stompClientRef.current = client;

    client.connect({}, () => {
      client.subscribe(`/topic/note/${noteId}`, (message) => {
        const { type, payload } = JSON.parse(message.body);
        if (type === messageType.OPERATION) handleRemoteOperation(payload);
        if (type === messageType.COLLABORATOR_JOIN) {
          setCollaborators(payload.collaborators);
        }
        if (type === messageType.COLLABORATOR_CURSOR) {
          handleCursorChange(payload);
        }
        if (type === messageType.REVIEW_IN_PROGRESS) {
          handleReviewInProgress(payload);
        }
      });

      if (docStateRef.current?.sentOperation && !isSyncComplete.current) {
        sendOperationToServer(docStateRef.current.sentOperation);
        isSyncComplete.current = true;
      }
    });

    return () => {
      if (client.active) client.disconnect();
    };
  }, [noteId, isLoading]);

  useEffect(() => {
    if (!user || !isReviewing) return;

    (async () => {
      try {
        const noteData = await apiFetch<Note>(`notes/${noteId}`, {
          method: "GET",
        });
        setNote(noteData);

        const logData = await apiFetch<TextOperation[]>(
          `notes/${noteData.id}/revision-log`,
          { method: "GET" },
        );
        setRevisionLog(logData);
      } catch (err: any) {
        setErrorMessageMessage(err.message || "Failed to fetch note data");
      } finally {
        setIsloading(false);
      }
    })();
  }, [user, isReviewing, noteId]);

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

  const handleClick = useCallback((e: Event) => {
    const target = (e as MouseEvent).target as HTMLElement;
    const node = target.closest("[data-suggestion-type]") as HTMLElement | null;

    if (!node) {
      setActiveSuggestion(null);
      return;
    }

    const type = node.getAttribute("data-suggestion-type");
    if (type === "format") return;

    const parentInsert = node.closest('[data-suggestion-type="insert"]');
    const effective = (parentInsert || node) as HTMLElement;

    const suggestionType = effective.getAttribute(
      "data-suggestion-type",
    ) as TooltipState["type"];
    const groupId = effective.getAttribute("data-group-id")!;
    const actorEmail = effective.getAttribute("data-actor-email")!;
    const createdAt = effective.getAttribute("data-created-at")!;
    const references = JSON.parse(effective.getAttribute("data-references") ?? "[]");

    setActiveSuggestion((prev) =>
      prev?.groupId === groupId
        ? null
        : { groupId, type: suggestionType, actorEmail, createdAt, references },
    );
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
    const quill = quillRef.current!;
    const beforeContents = quill.getContents();
    const beforeFormatSuggestions = cloneFormatSuggestions(formatSuggestionsRef.current);
    const beforeActiveFormatId = activeFormatIdRef.current;
    const beforeActiveSuggestion = cloneTooltipState(activeSuggestionRef.current);

    fn();

    const afterContents = quill.getContents();
    const afterFormatSuggestions = cloneFormatSuggestions(formatSuggestionsRef.current);
    const afterActiveFormatId = activeFormatIdRef.current;
    const afterActiveSuggestion = cloneTooltipState(activeSuggestionRef.current);

    const redoDelta = beforeContents.diff(afterContents);
    const undoDelta = afterContents.diff(beforeContents);

    reviewHistory.current.push({
      type,
      undoDelta,
      redoDelta,
      beforeFormatSuggestions,
      afterFormatSuggestions,
      beforeActiveFormatId,
      afterActiveFormatId,
      beforeActiveSuggestion,
      afterActiveSuggestion,
    });

    if (type === "REJECT") {
      rejectedChanges.current.push(stripSuggestionAttributes(redoDelta));
    }
  }

  async function undo() {

    if (runtimeHistoryRef.current.length > 0) {
      const entry = runtimeHistoryRef.current.pop()!;
      restoreRuntimeSnapshot(entry.before);

      if (entry.kind === "accept-insert") {
        acceptedReferences.current.pop();
      } else if (entry.kind === "reject-insert") {
        rejectedChanges.current.pop();
      }

      return;
    }

    if (reviewHistory.current.length === 0) return;

    const entry = reviewHistory.current[reviewHistory.current.length - 1];
    const quill = quillRef.current!;
    const suspended = suspendActiveFormatOverlay();

    try {
      quill.updateContents(entry.undoDelta, "api");
      setFormatSuggestions(cloneFormatSuggestions(entry.beforeFormatSuggestions));
      setActiveFormatId(entry.beforeActiveFormatId);
      setActiveSuggestion(cloneTooltipState(entry.beforeActiveSuggestion));
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

  function stripSuggestionAttributes(delta: Delta): Delta {
    return new Delta(
      delta.ops.map((op) => {
        if (!op.attributes) return op;
        const {
          "suggestion-format": _f,
          "suggestion-delete": _d,
          "suggestion-insert": _i,
          ...attrs
        } = op.attributes;
        return {
          ...op,
          attributes: Object.keys(attrs).length ? attrs : undefined,
        };
      }),
    );
  }

  function getGroupRange(
    groupId: string,
  ): { index: number; length: number } | null {
    const quill = quillRef.current!;
    const els = Array.from(
      quill.root.querySelectorAll(`[data-group-id="${groupId}"]`),
    ) as HTMLElement[];

    if (els.length === 0) return null;

    let minIdx = Infinity;
    let maxEnd = -Infinity;

    for (const el of els) {
      const blot = (quill.constructor as any).find(el, true);
      if (!blot) continue;
      const idx = quill.getIndex(blot);
      const len = blot.length ? blot.length() : (el.textContent?.length ?? 0);
      if (idx < minIdx) minIdx = idx;
      if (idx + len > maxEnd) maxEnd = idx + len;
    }

    return minIdx === Infinity
      ? null
      : { index: minIdx, length: maxEnd - minIdx };
  }

  function acceptChange(
    groupId: string,
    type: "insert" | "delete" | "format",
    references: OpReference[],
  ) {
    if (type === "format") {
      const item = formatSuggestionsRef.current.find(
        (f) => f.groupId === groupId,
      );
      if (!item) return;
      acceptFormatSuggestion(item);
      closeAuditTooltip();
      return;
    }

    snapshotAndApply(() => {
      const suspended = suspendActiveFormatOverlay();

      try {
        const quill = quillRef.current!;
        acceptedReferences.current.push(references);

        if (type === "insert") {
          const before = captureRuntimeSnapshot();

          removeInsertSuggestionFromSegments(groupId);
          refreshEditorFromRuntime();
          updateFormatSuggestionsAfterInsertAccept(groupId);

          const after = captureRuntimeSnapshot();
          runtimeHistoryRef.current.push({
            kind: "accept-insert",
            before: cloneRuntimeSnapshot(before),
            after: cloneRuntimeSnapshot(after),
          });

          const activeId = activeFormatIdRef.current;
          if (activeId) {
            const activeItem = formatSuggestionsRef.current.find(
              (f) => f.groupId === activeId,
            );
            if (activeItem) {
              quill.updateContents(buildFormatOverlayDelta(activeItem), "api");
            }
          }
        } else if (type === "delete") {
          const range = getGroupRange(groupId);

          if (!range) return;

          quill.deleteText(range.index, range.length, "api");
        }
      } finally {
        restoreActiveFormatOverlay(suspended);
      }
    }, "ACCEPT");

    setActiveSuggestion((prev) =>
      prev?.groupId === groupId ? null : prev,
    );
  }

  function rejectChange(groupId: string, type: "insert" | "delete" | "format") {
    if (type === "format") {
      const item = formatSuggestionsRef.current.find(
        (f) => f.groupId === groupId,
      );
      if (!item) return;
      rejectFormatSuggestion(item);
      closeAuditTooltip();
      return;
    }

    snapshotAndApply(() => {
      const suspended = suspendActiveFormatOverlay();

      try {
        const quill = quillRef.current!;
        const range = getGroupRange(groupId);
        if (!range) return;

        if (type === "insert") {
          const runtimeRange = findInsertGroupRangeInRuntime(groupId);
          const before = captureRuntimeSnapshot();

          if (!runtimeRange) return;

          deleteInsertGroupSegments(groupId);
          refreshEditorFromRuntime();

          const updated = formatSuggestionsRef.current
            .map((item) => ({
              ...item,
              spans: transformSpansAfterRuntimeInsertRemoval(
                item.spans,
                runtimeRange.index,
                runtimeRange.length,
              ),
              dependsOnInsertGroupIds: item.dependsOnInsertGroupIds.filter(
                (id) => id !== groupId,
              ),
            }))
            .filter((item) => item.spans.length > 0);

          setFormatSuggestions(refreshPreviewTextsAgainstRuntime(updated));

          const after = captureRuntimeSnapshot();
          runtimeHistoryRef.current.push({
            kind: "reject-insert",
            before: cloneRuntimeSnapshot(before),
            after: cloneRuntimeSnapshot(after),
          });
        } else if (type === "delete") {
          quill.formatText(
            range.index,
            range.length,
            { "suggestion-delete": null },
            "api",
          );
        }
      } finally {
        restoreActiveFormatOverlay(suspended);
      }
    }, "REJECT");

    setActiveSuggestion((prev) =>
      prev?.groupId === groupId ? null : prev,
    );
  }

  function acceptFormatSuggestion(item: FormatSuggestionItem) {
    if (!canActOnFormatSuggestion(item)) return;

    snapshotAndApply(() => {
      const quill = quillRef.current!;
      quill.updateContents(buildFormatOverlayClearDelta(item), "api");
      acceptedReferences.current.push(item.references);
      setFormatSuggestions((prev) =>
        prev.filter((f) => f.groupId !== item.groupId),
      );
      setActiveFormatId(null);
    }, "ACCEPT");
  }

  function rejectFormatSuggestion(item: FormatSuggestionItem) {
    if (!canActOnFormatSuggestion(item)) return;

    snapshotAndApply(() => {
      const quill = quillRef.current!;
      quill.updateContents(buildFormatOverlayClearDelta(item), "api");

      const fmtAttrs = JSON.parse(item.attributes) as Record<string, any>;
      const nulled: Record<string, any> = {};
      for (const k of Object.keys(fmtAttrs)) nulled[k] = null;

      for (const span of item.spans) {
        quill.formatText(span.start, span.length, nulled, "api");
      }

      setFormatSuggestions((prev) =>
        prev.filter((f) => f.groupId !== item.groupId),
      );
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
    cursor.moveCursor(payload.actorEmail, {
      index: payload.position,
      length: 0,
    });
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
      setRevisionLog(null);
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
    } catch (err) {
      console.error("Failed to exit review:", err);
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
          acceptedReferences: [...new Set(acceptedReferences.current.flat())],
        }),
      });

      handleExitReview();
    } catch (err) {
      console.error("Failed to save changes:", err);
    }
  }

  function suspendActiveFormatOverlay(): FormatSuggestionItem | null {
    const quill = quillRef.current;
    if (!quill) return null;

    const activeId = activeFormatIdRef.current;
    if (!activeId) return null;

    const activeItem =
      formatSuggestionsRef.current.find((f) => f.groupId === activeId) ?? null;

    if (activeItem) {
      quill.updateContents(buildFormatOverlayClearDelta(activeItem), "api");
    }

    return activeItem;
  }

  function restoreActiveFormatOverlay(item: FormatSuggestionItem | null) {
    const quill = quillRef.current;
    if (!quill || !item) return;
    quill.updateContents(buildFormatOverlayDelta(item), "api");
  }

  function isInsertGroupStillPending(groupId: string): boolean {
    const quill = quillRef.current;
    if (!quill) return false;

    return !!quill.root.querySelector(
      `[data-suggestion-type="insert"][data-group-id="${groupId}"]`,
    );
  }

  function canActOnFormatSuggestion(item: FormatSuggestionItem): boolean {
    return item.dependsOnInsertGroupIds.every(
      (groupId) => !isInsertGroupStillPending(groupId),
    );
  }

  function cloneFormatSuggestions(
    items: FormatSuggestionItem[],
  ): FormatSuggestionItem[] {
    return items.map((item) => ({
      ...item,
      references: [...item.references],
      spans: item.spans.map((s) => ({ ...s })),
      dependsOnInsertGroupIds: [...item.dependsOnInsertGroupIds],
    }));
  }

  function closeAuditTooltip() {
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

  function cloneSegments(items: ReviewSegment[]): ReviewSegment[] {
    return items.map((s) => ({
      ...s,
      attrs: { ...s.attrs },
      references: [...s.references],
    }));
  }

  function cloneRuntimeSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
    return {
      segments: cloneSegments(snapshot.segments),
      formatSuggestions: cloneFormatSuggestions(snapshot.formatSuggestions),
      activeSuggestion: snapshot.activeSuggestion
        ? {
            ...snapshot.activeSuggestion,
            references: [...snapshot.activeSuggestion.references],
          }
        : null,
      activeFormatId: snapshot.activeFormatId,
    };
  }

  function deltaToSegments(delta: Delta): ReviewSegment[] {
    const ops = delta.ops ?? [];

    return ops
      .filter((op: any) => typeof op.insert === "string")
      .map((op: any) => ({
        id: nextRuntimeSegmentId(),
        text: op.insert,
        attrs: { ...(op.attributes ?? {}) },
        references: [...(op.attributes?.["suggestion-insert"]?.references ?? [])],
    }));
  }

  function mergeAdjacentSegments(segments: ReviewSegment[]): ReviewSegment[] {
    const merged: ReviewSegment[] = [];

    for (const seg of segments) {
      const last = merged[merged.length - 1];

      const canMerge =
        !!last &&
        JSON.stringify(last.attrs ?? {}) === JSON.stringify(seg.attrs ?? {}) &&
        JSON.stringify(last.references ?? []) === JSON.stringify(seg.references ?? []);

      if (canMerge) {
        last.text += seg.text;
      } else {
        merged.push({
          ...seg,
          attrs: { ...seg.attrs },
          references: [...seg.references],
        });
      }
    }

    return merged;
  }

  function segmentsToDelta(segments: ReviewSegment[]): Delta {
    const delta = new Delta();

    for (const seg of segments) {
      if (Object.keys(seg.attrs).length > 0) {
        delta.insert(seg.text, seg.attrs);
      } else {
        delta.insert(seg.text);
      }
    }

    return delta;
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

  function restoreRuntimeSnapshot(snapshot: RuntimeSnapshot) {
    reviewSegmentsRef.current = cloneSegments(snapshot.segments);

    const nextDelta = segmentsToDelta(reviewSegmentsRef.current);
    quillRef.current!.setContents(nextDelta, "api");

    setFormatSuggestions(cloneFormatSuggestions(snapshot.formatSuggestions));
    setActiveSuggestion(
      snapshot.activeSuggestion
        ? {
            ...snapshot.activeSuggestion,
            references: [...snapshot.activeSuggestion.references],
          }
        : null,
    );
    setActiveFormatId(snapshot.activeFormatId);
  }

  function initializeRuntimeFromProjection(projection: {
    visualDelta: Delta;
    formatSuggestions: FormatSuggestionItem[];
  }) {
    reviewSegmentsRef.current = deltaToSegments(projection.visualDelta);
  }

  function removeInsertSuggestionFromSegments(groupId: string) {
    reviewSegmentsRef.current = mergeAdjacentSegments(
      reviewSegmentsRef.current.map((seg) => {
        const insertAttr = seg.attrs["suggestion-insert"];
        if (!insertAttr || insertAttr.groupId !== groupId) return seg;

        const { ["suggestion-insert"]: _removed, ...rest } = seg.attrs;
        return {
          ...seg,
          attrs: Object.keys(rest).length > 0 ? rest : {},
        };
      }),
    );
  }

  function deleteInsertGroupSegments(groupId: string) {
    reviewSegmentsRef.current = mergeAdjacentSegments(
      reviewSegmentsRef.current.filter((seg) => {
        const insertAttr = seg.attrs["suggestion-insert"];
        return !(insertAttr && insertAttr.groupId === groupId);
      }),
    );
  }

  function refreshEditorFromRuntime() {
    const nextDelta = segmentsToDelta(reviewSegmentsRef.current);
    quillRef.current!.setContents(nextDelta, "api");
  }

  function updateFormatSuggestionsAfterInsertAccept(groupId: string) {
    setFormatSuggestions((prev) =>
      prev.map((item) => ({
        ...item,
        dependsOnInsertGroupIds: item.dependsOnInsertGroupIds.filter(
          (id) => id !== groupId,
        ),
      })),
    );
  }

  function transformSpansAfterRuntimeInsertRemoval(
    spans: { start: number; length: number }[],
    deleteStart: number,
    deleteLength: number,
  ) {
    const deleteEnd = deleteStart + deleteLength;
    const next: { start: number; length: number }[] = [];

    for (const span of spans) {
      const spanStart = span.start;
      const spanEnd = span.start + span.length;

      if (spanEnd <= deleteStart) {
        next.push({ ...span });
        continue;
      }

      if (spanStart >= deleteEnd) {
        next.push({
          start: spanStart - deleteLength,
          length: span.length,
        });
        continue;
      }

      const leftLen = Math.max(0, deleteStart - spanStart);
      const rightLen = Math.max(0, spanEnd - deleteEnd);

      if (leftLen > 0) {
        next.push({ start: spanStart, length: leftLen });
      }
      if (rightLen > 0) {
        next.push({ start: deleteStart, length: rightLen });
      }
    }

    const merged: { start: number; length: number }[] = [];
    for (const span of next) {
      const last = merged[merged.length - 1];
      if (last && last.start + last.length === span.start) {
        last.length += span.length;
      } else {
        merged.push({ ...span });
      }
    }

    return merged;
  }

  function findInsertGroupRangeInRuntime(groupId: string): { index: number; length: number } | null {
    let cursor = 0;
    let start = -1;
    let end = -1;

    for (const seg of reviewSegmentsRef.current) {
      const len = seg.text.length;
      const insertAttr = seg.attrs["suggestion-insert"];

      if (insertAttr?.groupId === groupId) {
        if (start === -1) start = cursor;
        end = cursor + len;
      }

      cursor += len;
    }

    if (start === -1 || end === -1) return null;
    return { index: start, length: end - start };
  }

  function refreshPreviewTextsAgainstRuntime(items: FormatSuggestionItem[]) {
    const delta = segmentsToDelta(reviewSegmentsRef.current);
    const temp = quillRef.current!;
    const current = temp.getContents();

    temp.setContents(delta, "api");

    const refreshed = items.map((item) => {
      const text = item.spans
        .map((span) => temp.getText(span.start, span.length))
        .join("")
        .replace(/\n/g, " ↵ ")
        .slice(0, 60);

      return {
        ...item,
        previewText: text,
      };
    });

    temp.setContents(current, "api");
    return refreshed;
  }

  if (loadingUser)
    return <div className="container-wide">Checking session...</div>;

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
                className="btn-secondary"
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
            color: "#92400e",
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
        <AuditTooltip
          tooltip={activeSuggestion}
          onAccept={acceptChange}
          onReject={rejectChange}
          onClose={closeAuditTooltip}
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
