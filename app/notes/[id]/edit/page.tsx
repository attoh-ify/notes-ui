"use client";

import { API_BASE_URL, apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, Suspense, useCallback } from "react";
import { Stomp, CompatClient } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { DocState } from "@/src/lib/docState";
import { TextOperation } from "@/src/lib/textOperation";
import { useAuth } from "@/src/context/AuthContext";
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import Delta from "quill-delta";
import { saveAs } from "file-saver";
import * as quillToWord from "quill-to-word";
import { registerFormats } from "../../../../src/quillformats";
import {
  CursorModule,
  CursorPayload,
  JoinResponse,
  messageType,
  MutableOp,
  Note,
  ReviewInProgressResponse,
  SuggestionDelete,
  SuggestionFormat,
  SuggestionInsert,
  TooltipState,
} from "../../../../src/types";
import { AuditTooltip } from "@/components/AuditTooltip";

let _groupCounter = 0;
function nextGroupId(): string {
  return `g_${++_groupCounter}`;
}

function EditContent() {
  const { id: noteId } = useParams();
  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(null);
  const [collaborators, setCollaborators] = useState<{
    [email: string]: string;
  }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reviewInProgress, setReviewInProgress] = useState<boolean>(false);
  const [revisionLog, setRevisionLog] = useState<TextOperation[] | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [reviewComment, setReviewComment] = useState<string>("");
  const [undoStack, setUndoStack] = useState<Delta[]>([]);
  const [panel, setPanel] = useState<TooltipState | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const docStateRef = useRef<DocState | null>(null);
  const stompClientRef = useRef<CompatClient | null>(null);
  const sentOperationFlushed = useRef<boolean>(false);

  if (!docStateRef.current && user) {
    docStateRef.current = new DocState(user.email);
  }

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    quill.root.querySelectorAll(".active").forEach((el) => {
      el.classList.remove("active");
    });
    if (panel?.groupId) {
      quill.root
        .querySelectorAll(`[data-group-id="${panel.groupId}"]`)
        .forEach((el) => el.classList.add("active"));
    }
  }, [panel]);

  useEffect(() => {
    const shouldShowEditor = !reviewInProgress || note?.accessRole === "OWNER";

    if (
      !loading &&
      editorRef.current &&
      !quillRef.current &&
      shouldShowEditor
    ) {
      const initQuill = async () => {
        const { default: QuillModule } = await import("quill");
        const { default: QuillCursors } = await import("quill-cursors");

        QuillModule.register("modules/cursors", QuillCursors);
        registerFormats(QuillModule);

        quillRef.current = new QuillModule(editorRef.current!, {
          theme: "snow",
          readOnly: reviewInProgress,
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

        quillRef.current.on("text-change", (delta, _oldDelta, source) => {
          if (source !== "user") return;
          sendCursorChange(quillRef.current?.getSelection()?.index ?? 0);
          docStateRef.current?.queueOperation(
            delta,
            async (operation: TextOperation) => {
              sentOperationFlushed.current = false;
              if (!stompClientRef.current?.connected) return;
              await sendOperationToServer(operation);
              sentOperationFlushed.current = true;
            },
          );
        });

        quillRef.current.on(
          "selection-change",
          async (range, _oldRange, source) => {
            if (source !== "user") return;
            sendCursorChange(range.index ?? 0);
          },
        );
      };
      initQuill();
    }
  }, [loading, reviewInProgress, note?.accessRole]);

  useEffect(() => {
    if (revisionLog && quillRef.current) {
      displayFormattedNote();
    }
  }, [revisionLog]);

  function displayFormattedNote() {
    const quill = quillRef.current!;
    const log = revisionLog!;

    const baseOps = log.filter((op) => op.state !== "PENDING");
    const pendingOps = log.filter((op) => op.state === "PENDING");

    let baseDocument = new Delta();
    for (const op of baseOps) {
      baseDocument = baseDocument.compose(new Delta(op.delta.ops));
    }

    if (pendingOps.length === 0) {
      quill.setContents(baseDocument, "api");
      setHasChanges(false);
      return false;
    }
    setHasChanges(true);

    const ops: MutableOp[] = [];
    for (const op of baseDocument.ops) {
      if (typeof op.insert === "string") {
        ops.push(
          op.attributes
            ? { insert: op.insert, attributes: { ...op.attributes } }
            : { insert: op.insert },
        );
      }
    }

    function splitOpAt(index: number, offset: number): number {
      if (offset === 0 || offset >= ops[index].insert.length) return index;

      const op = ops[index];
      const left: MutableOp = {
        insert: op.insert.slice(0, offset),
        ...(op.attributes ? { attributes: { ...op.attributes } } : {}),
        ...(op._suggestionInsert
          ? { _suggestionInsert: { ...op._suggestionInsert } }
          : {}),
        ...(op._suggestionFormat
          ? { _suggestionFormat: { ...op._suggestionFormat } }
          : {}),
        ...(op._suggestionDelete
          ? { _suggestionDelete: { ...op._suggestionDelete } }
          : {}),
      };

      const right: MutableOp = {
        insert: op.insert.slice(offset),
        ...(op.attributes ? { attributes: { ...op.attributes } } : {}),
        ...(op._suggestionInsert
          ? { _suggestionInsert: { ...op._suggestionInsert } }
          : {}),
        ...(op._suggestionFormat
          ? { _suggestionFormat: { ...op._suggestionFormat } }
          : {}),
        ...(op._suggestionDelete
          ? { _suggestionDelete: { ...op._suggestionDelete } }
          : {}),
      };

      ops.splice(index, 1, left, right);
      return index + 1;
    }

    function findPos(logicalPos: number): {
      opIndex: number;
      intraOffset: number;
    } {
      let remaining = logicalPos;
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op._suggestionDelete) continue;
        if (remaining === 0) return { opIndex: i, intraOffset: 0 };
        if (remaining < op.insert.length)
          return { opIndex: i, intraOffset: remaining };
        remaining -= op.insert.length;
      }

      return { opIndex: ops.length, intraOffset: 0 };
    }

    function prevSuggestionInsert(
      opIndex: number,
      actorEmail: string,
    ): SuggestionInsert | null {
      for (let i = opIndex - 1; i >= 0; i--) {
        const op = ops[i];
        if (op.insert === "\n") return null;
        if (op._suggestionInsert?.actorEmail === actorEmail)
          return op._suggestionInsert;
        return null;
      }
      return null;
    }

    function prevSuggestionDelete(
      opIndex: number,
      actorEmail: string,
    ): SuggestionDelete | null {
      for (let i = opIndex - 1; i >= 0; i--) {
        const op = ops[i];
        if (op._suggestionDelete?.actorEmail === actorEmail)
          return op._suggestionDelete;
        return null;
      }
      return null;
    }

    for (const textOp of pendingOps) {
      const { actorEmail, createdAt } = textOp;
      let logicalPos = 0;

      let currentInsertGroup: SuggestionInsert | null = null;
      let currentDeleteGroup: SuggestionDelete | null = null;
      let currentFormatGroup: SuggestionFormat | null = null;

      for (const component of textOp.delta.ops) {
        if (typeof component.retain === "number" && !component.attributes) {
          const isLast =
            component === textOp.delta.ops[textOp.delta.ops.length - 1];
          if (isLast) break;

          currentInsertGroup = null;
          currentDeleteGroup = null;
          currentFormatGroup = null;
          logicalPos += component.retain;
        } else if (
          typeof component.retain === "number" &&
          component.attributes
        ) {
          currentInsertGroup = null;
          currentDeleteGroup = null;

          let { opIndex, intraOffset } = findPos(logicalPos);
          if (intraOffset > 0) {
            opIndex = splitOpAt(opIndex, intraOffset);
          }

          let remaining = component.retain;
          let cursor = opIndex;

          if (!currentFormatGroup) {
            const prev = ops[opIndex - 1]?._suggestionFormat;
            currentFormatGroup =
              prev?.actorEmail === actorEmail
                ? prev
                : {
                    groupId: nextGroupId(),
                    actorEmail,
                    createdAt,
                    attributes: JSON.stringify(component.attributes),
                  };
          }

          while (remaining > 0 && cursor < ops.length) {
            const op = ops[cursor];
            if (op.insert === "\n") {
              // we don't format line breaks
              cursor++;
              continue;
            }

            if (op.insert.length > remaining) {
              splitOpAt(cursor, remaining);
            }

            ops[cursor]._suggestionFormat = { ...currentFormatGroup };
            remaining -= ops[cursor].insert.length;
            cursor++;
          }

          logicalPos += component.retain;
        } else if (typeof component.insert === "string") {
          currentDeleteGroup = null;
          currentFormatGroup = null;

          const { opIndex, intraOffset } = findPos(logicalPos);
          let insertAt = opIndex;
          if (intraOffset > 0) {
            insertAt = splitOpAt(opIndex, intraOffset);
          }

          if (!currentInsertGroup) {
            const prev = prevSuggestionInsert(insertAt, actorEmail);
            currentInsertGroup = prev ?? {
              groupId: nextGroupId(),
              actorEmail,
              createdAt,
            };
          } else {
            if (createdAt > currentInsertGroup.createdAt) {
              currentInsertGroup.createdAt = createdAt;
            }
          }

          const newOps: MutableOp[] = [];
          const parts = component.insert.split("\n");

          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (part.length > 0) {
              const attrs: Record<string, any> = {
                ...(component.attributes ?? {}),
              };
              newOps.push({
                insert: part,
                attributes: attrs,
                _suggestionInsert: { ...currentInsertGroup! },
              });
            }

            if (i < parts.length - 1) {
              newOps.push({ insert: "\n" });
              currentInsertGroup = null;
            }
          }

          ops.splice(insertAt, 0, ...newOps);
        } else if (typeof component.delete === "number") {
          currentInsertGroup = null;
          currentFormatGroup = null;

          const { opIndex, intraOffset } = findPos(logicalPos);
          let cursor = opIndex;

          if (intraOffset > 0) {
            cursor = splitOpAt(opIndex, intraOffset);
          }

          if (!currentDeleteGroup) {
            const prev = prevSuggestionDelete(cursor, actorEmail);
            currentDeleteGroup = prev ?? {
              groupId: nextGroupId(),
              actorEmail,
              createdAt,
            };
          }

          let remaining = component.delete;
          let advanceBy = component.delete;
          while (remaining > 0 && cursor < ops.length) {
            const op = ops[cursor];

            if (op.insert === "\n") {
              cursor++;
              remaining--;
              currentDeleteGroup = null;
              continue;
            }

            // actually remove because it was a pending operation
            if (op._suggestionInsert) {
              if (op.insert.length <= remaining) {
                remaining -= op.insert.length;
              } else {
                splitOpAt(cursor, remaining);
                remaining = 0;
              }
              ops.splice(cursor, 1);
              advanceBy -= op.insert.length;
              continue;
            }

            if (op._suggestionDelete) {
              // already marked as deleted so skip
              cursor++;
              continue;
            }

            // base text so mark as deleted - dont actually remove
            if (op.insert.length > remaining) {
              splitOpAt(cursor, remaining);
            }

            ops[cursor]._suggestionDelete = { ...currentDeleteGroup! };
            remaining -= ops[cursor].insert.length;
            cursor++;
          }

          logicalPos += advanceBy;
        }
      }
    }

    // ensure all ops with the same groupId have the same createdAt (the most recent one)
    const groupLatest = new Map<string, string>();
    for (const op of ops) {
      const si = op._suggestionInsert;
      if (si) {
        const current = groupLatest.get(si.groupId);
        if (!current || si.createdAt > current)
          groupLatest.set(si.groupId, si.createdAt);
      }
    }

    for (const op of ops) {
      if (op._suggestionInsert) {
        op._suggestionInsert.createdAt = groupLatest.get(
          op._suggestionInsert.groupId,
        )!;
      }
    }

    function sameGroup(a: MutableOp, b: MutableOp): boolean {
      const insertMatch =
        (!a._suggestionInsert && !b._suggestionInsert) ||
        (a._suggestionInsert &&
          b._suggestionInsert &&
          a._suggestionInsert.groupId === b._suggestionInsert.groupId);

      const deleteMatch =
        (!a._suggestionDelete && !b._suggestionDelete) ||
        (a._suggestionDelete &&
          b._suggestionDelete &&
          a._suggestionDelete.groupId === b._suggestionDelete.groupId);

      const formatMatch =
        (!a._suggestionFormat && !b._suggestionFormat) ||
        (a._suggestionFormat &&
          b._suggestionFormat &&
          a._suggestionFormat.groupId === b._suggestionFormat.groupId);

      const attrMatch =
        JSON.stringify(a.attributes) === JSON.stringify(b.attributes);

      return !!insertMatch && !!deleteMatch && !!formatMatch && attrMatch;
    }

    // collapse ops in the same group
    const collapsed: MutableOp[] = [];
    for (const op of ops) {
      const last = collapsed[collapsed.length - 1];
      if (
        last &&
        op.insert !== "\n" &&
        last.insert !== "\n" &&
        sameGroup(op, last)
      ) {
        last.insert += op.insert;
      } else {
        collapsed.push({ ...op });
      }
    }

    // create the actual ops
    const finalOps = collapsed.map((op) => {
      const attrs: Record<string, any> = { ...(op.attributes ?? {}) };

      if (op._suggestionInsert) {
        attrs["suggestion-insert"] = {
          groupId: op._suggestionInsert.groupId,
          actorEmail: op._suggestionInsert.actorEmail,
          createdAt: op._suggestionInsert.createdAt,
        };
      }
      if (op._suggestionFormat) {
        try {
          const fmtAttrs = JSON.parse(op._suggestionFormat.attributes ?? "{}");
          Object.assign(attrs, fmtAttrs);
        } catch {}

        attrs["suggestion-format"] = {
          groupId: op._suggestionFormat.groupId,
          actorEmail: op._suggestionFormat.actorEmail,
          createdAt: op._suggestionFormat.createdAt,
          attributes: op._suggestionFormat.attributes,
        };
      }
      if (op._suggestionDelete) {
        attrs["suggestion-delete"] = {
          groupId: op._suggestionDelete.groupId,
          actorEmail: op._suggestionDelete.actorEmail,
          createdAt: op._suggestionDelete.createdAt,
        };
      }

      return Object.keys(attrs).length > 0
        ? { insert: op.insert, attributes: attrs }
        : { insert: op.insert };
    });

    quill.setContents(new Delta(finalOps), "api");
    quill.root.addEventListener("click", handleClick);
  }

  useEffect(() => {
    async function loadNoteAndJoin() {
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
          setReviewInProgress(true);
          return;
        }
        docStateRef.current!.lastSyncedRevision = joinData.revision;
        docStateRef.current!.setDocument(new Delta(joinData.delta.ops || []));
        setCollaborators(joinData.collaborators);
      } catch (err: any) {
        setError(err.message || "Failed to load note");
      } finally {
        setLoading(false);
      }
    }
    if (noteId && user) loadNoteAndJoin();
  }, [noteId, user]);

  useEffect(() => {
    if (!noteId || loading) return;
    const client = Stomp.over(
      () => new SockJS(`${API_BASE_URL}/relay?noteId=${noteId}`),
    );
    client.debug = () => {};
    stompClientRef.current = client;

    client.connect({}, () => {
      client.subscribe(`/topic/note/${noteId}`, (message) => {
        const { type, payload } = JSON.parse(message.body);
        if (type === messageType.OPERATION) handleRemoteOperation(payload);
        if (type === messageType.COLLABORATOR_JOIN)
          setCollaborators(payload.collaborators);
        if (type === messageType.COLLABORATOR_CURSOR)
          handleCursorChange(payload);
        if (type === messageType.REVIEW_IN_PROGRESS)
          handleReviewInProgress(payload);
      });
      if (docStateRef.current?.sentOperation && !sentOperationFlushed.current) {
        sendOperationToServer(docStateRef.current.sentOperation);
        sentOperationFlushed.current = true;
      }
    });
    return () => {
      if (client.active) client.disconnect();
    };
  }, [noteId, loading]);

  useEffect(() => {
    if (!user || !reviewInProgress) return;
    async function fetchData() {
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
        setError(err.message || "Failed to fetch note data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [user, reviewInProgress]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    const toolbar = editorRef.current?.previousSibling as HTMLElement;
    const isToolbar = toolbar?.classList.contains("ql-toolbar");

    if (reviewInProgress) {
      quill.enable(false);
      if (isToolbar) toolbar.style.display = "none";
    } else {
      quill.enable(true);
      if (isToolbar) toolbar.style.display = "block";
    }
  }, [reviewInProgress, loading]);

  const handleClick = useCallback((e: Event) => {
    const el = (e as MouseEvent).target as HTMLElement;
    const suggestion = el.closest(
      "[data-suggestion-type]",
    ) as HTMLElement | null;

    if (!suggestion) {
      setPanel(null);
      return;
    }

    const parentInsert = suggestion.closest('[data-suggestion-type="insert"]');
    let effectiveSuggestion = parentInsert || suggestion;

    const type = effectiveSuggestion.getAttribute(
      "data-suggestion-type",
    ) as TooltipState["type"];
    const groupId = effectiveSuggestion.getAttribute("data-group-id")!;
    const actorEmail = effectiveSuggestion.getAttribute("data-actor-email")!;
    const createdAt = effectiveSuggestion.getAttribute("data-created-at")!;

    setPanel((prev) => {
      if (prev?.groupId === groupId) return null;
      return {
        groupId,
        type,
        actorEmail,
        createdAt,
      };
    });
  }, []);

  function snapshotAndApply(fn: () => void) {
    const before = quillRef.current!.getContents();
    fn();
    const after = quillRef.current!.getContents();
    const inverseDelta = after.diff(before);
    setUndoStack((prev) => [...prev, inverseDelta]);
  }

  function undo() {
    if (undoStack.length === 0) return;
    const inversDelta = undoStack[undoStack.length - 1];
    quillRef.current!.updateContents(inversDelta, "api");
    setUndoStack((prev) => prev.slice(0, -1));
  }

  function getGroupRange(
    groupId: string,
  ): { index: number; length: number } | null {
    const quill = quillRef.current!;
    const els = Array.from(
      quill.root.querySelectorAll(`[data-group-id="${groupId}"]`),
    ) as HTMLElement[];

    if (els.length === 0) return null;

    const firstBlot = (quill.constructor as any).find(els[0]);
    if (!firstBlot) return null;

    return {
      index: quill.getIndex(firstBlot),
      length: els.reduce((sum, el) => sum + (el.textContent?.length ?? 0), 0),
    };
  }

  function acceptChange(groupId: string, type: "insert" | "delete" | "format") {
    snapshotAndApply(() => {
      const quill = quillRef.current!;
      const range = getGroupRange(groupId);
      if (!range) return;

      if (type === "insert") {
        quill.formatText(
          range.index,
          range.length,
          { "suggestion-insert": null },
          "api",
        );
      } else if (type === "delete") {
        quill.deleteText(range.index, range.length, "api");
      } else if (type === "format") {
        quill.formatText(
          range.index,
          range.length,
          { "suggestion-format": null },
          "api",
        );
      }
    });
    setPanel(null);
  }

  function rejectChange(groupId: string, type: "insert" | "delete" | "format") {
    snapshotAndApply(() => {
      const quill = quillRef.current!;
      const range = getGroupRange(groupId);
      if (!range) return;

      if (type === "insert") {
        quill.deleteText(range.index, range.length, "api");

        const charAfter = quill.getText(range.index, 1);
        const charBefore =
          range.index > 0 ? quill.getText(range.index - 1, 1) : "";

        if (charAfter === "\n" && (range.index === 0 || charBefore === "\n")) {
          quill.deleteText(range.index, 1, "api");
        }
      } else if (type === "delete") {
        quill.formatText(
          range.index,
          range.length,
          { "suggestion-delete": null },
          "api",
        );
      } else if (type === "format") {
        const els = Array.from(
          quill.root.querySelectorAll(`[data-group-id="${groupId}"]`),
        ) as HTMLElement[];

        if (els.length === 0) return;

        const firstEl = els[0];
        const fmtAttrStr = firstEl.getAttribute("data-format-attributes");

        if (fmtAttrStr) {
          try {
            const fmtAttrs = JSON.parse(fmtAttrStr);
            const nulledAttrs: Record<string, null> = {};

            for (const key of Object.keys(fmtAttrs)) {
              nulledAttrs[key] = null;
            }

            nulledAttrs["suggestion-format" as any] = null;
            quill.formatText(range.index, range.length, nulledAttrs, "api");
          } catch {
            quill.formatText(
              range.index,
              range.length,
              { "suggestion-format": null },
              "api",
            );
          }
        } else {
          quill.formatText(
            range.index,
            range.length,
            { "suggestion-format": null },
            "api",
          );
        }
      }
    });
    setPanel(null);
  }

  async function sendCursorChange(position: number) {
    if (reviewInProgress) return;
    await apiFetch(`notes/${noteId}/cursor`, {
      method: "POST",
      body: JSON.stringify({ position }),
    });
  }

  function handleCursorChange(payload: CursorPayload) {
    if (reviewInProgress || payload.actorEmail === user!.email) return;
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
    const { opId, delta, actorEmail, revision, state, createdAt } = payload;
    const docState = docStateRef.current!;
    if (actorEmail === user!.email) {
      docState.acknowledgeOperation(revision, (pending) => {
        sentOperationFlushed.current = false;
        if (pending) sendOperationToServer(pending);
      });
    } else {
      const deltaForQuill = docState.applyRemoteOperation({
        opId,
        delta: new Delta(delta.ops || []),
        actorEmail,
        revision,
        state,
        createdAt,
      });
      quillRef.current?.updateContents(deltaForQuill, "api");
    }
  }

  async function sendOperationToServer(operation: TextOperation) {
    if (reviewInProgress) return;
    await apiFetch(`notes/${noteId}/enqueue`, {
      method: "POST",
      body: JSON.stringify({
        delta: operation.delta,
        actorEmail: user!.email,
        revision: operation.revision,
        opId: null,
        state: null,
        createdAt: null,
        inverseOf: null,
      }),
    });
  }

  async function saveNote() {
    try {
      await apiFetch(`notes/${noteId}/save`, { method: "POST" });
    } catch (err: any) {
      setError(err.message || "Failed to save note");
    }
  }

  async function saveVersion() {
    if (!quillRef.current) return;
    try {
      await apiFetch(`notes/${noteId}/versions`, {
        method: "POST",
        body: JSON.stringify({ delta: quillRef.current.getContents() }),
      });
      router.push(`/notes/${noteId}`);
    } catch (err: any) {
      setError(err.message || "Failed to save version");
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
    setReviewInProgress(payload.state);
  }

  async function downloadNoteAsWord() {
    const masterDelta = quillRef.current!.getContents();
    try {
      const docx = await quillToWord.generateWord(masterDelta, {
        exportAs: "blob",
      });
      saveAs(docx as Blob, `${note?.title}.docx`);
    } catch (error) {
      console.log("Failed to generate word doc: ", error);
    }
  }

  async function handleExitReview() {
    try {
      await apiFetch(`notes/${noteId}/review/exit`, {
        method: "GET"
      });
      setRevisionLog(null);
      setHasChanges(false);
      setReviewComment("");
      router.refresh();
    } catch (err) {
      console.error("Failed to exit review:", err);
    }
  }

  async function openSettings() {
    saveNote();
    router.push(`/notes/${noteId}/edit/note-setting`);
  }

  if (loadingUser)
    return <div className="container-wide">Checking session...</div>;
  if (!user) {
    router.push("login");
    return null;
  }
  if (loading) return <div className="container-wide">Loading note...</div>;
  if (error)
    return (
      <div className="container-wide" style={{ color: "red" }}>
        {error}
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
                  Collaborators:{" "}
                </span>
                {Object.entries(collaborators).map(
                  ([email, color], index, array) => (
                    <span key={email} style={{ color, fontWeight: "600" }}>
                      {email === user?.email ? "You" : email}
                      {index < array.length - 1 && (
                        <span style={{ color, marginLeft: "2px" }}>,</span>
                      )}
                    </span>
                  ),
                )}
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
            <button className="btn-secondary" onClick={downloadNoteAsWord}>
              Export Docx
            </button>
            <div
              style={{
                width: "1px",
                background: "var(--border)",
                margin: "0 4px",
              }}
            />

            {!reviewInProgress && (
              <button
                className="btn-outline"
                onClick={() => router.push(`/notes/${noteId}`)}
              >
                View
              </button>
            )}
            {note.accessRole === "OWNER" && !reviewInProgress && (
              <button className="btn-outline" onClick={handleReviewNote}>
                Review
              </button>
            )}
            {!reviewInProgress && (
              <button className="btn-primary" onClick={saveNote}>
                Save changes
              </button>
            )}
            {reviewInProgress && note.accessRole === "OWNER" && (
              <button
                className="btn-secondary"
                onClick={undo}
                disabled={undoStack.length === 0}
                style={{ opacity: undoStack.length === 0 ? 0.4 : 1 }}
              >
                ↩ Undo
              </button>
            )}
          </div>
        </div>
      </header>

      {reviewInProgress && (
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
            justifyContent: "space-between",
            fontSize: "0.875rem",
            fontWeight: "500",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "1.2rem" }}>📝</span>
            <span>
              {note.accessRole === "OWNER" ? (
                <>
                  <strong>Review Mode:</strong> You are reviewing proposed
                  changes. Accept or reject them to update the master version.
                </>
              ) : (
                <>
                  <strong>Review in Progress:</strong> The owner is currently
                  reviewing a proposed version of this note.
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {reviewInProgress && note.accessRole !== "OWNER" ? (
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
          <h3 style={{ color: "var(--text)", margin: "0 0 0.5rem 0" }}>Editor Locked</h3>
          <p style={{ color: "var(--text-muted)", maxWidth: "400px", margin: 0 }}>
            The owner is currently reviewing proposed changes. The editor will be available once the review is complete.
          </p>
        </div>
      ) : (
        <>
          {/* No-changes banner — shown when review is done */}
          {reviewInProgress && note.accessRole === "OWNER" && !hasChanges && (
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
              <h3 style={{ color: "var(--text)", margin: 0 }}>No pending changes</h3>
              <p style={{ color: "var(--text-muted)", maxWidth: "400px", margin: 0 }}>
                All proposed changes have been reviewed. Exit review mode when ready.
              </p>
            </div>
          )}
 
          <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
 
            {/* Comment + action sidebar — only in review mode for owner */}
            {reviewInProgress && note.accessRole === "OWNER" && (
              <div
                style={{
                  width: "200px",
                  flexShrink: 0,
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  padding: "0.875rem",
                  backgroundColor: "#fff",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.625rem",
                  position: "sticky",
                  top: "1rem",
                }}
              >
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text)" }}>
                  Review Note
                </span>
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Optional summary..."
                  rows={4}
                  style={{
                    width: "100%",
                    padding: "0.5rem",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    fontSize: "0.8rem",
                    resize: "vertical",
                    fontFamily: "inherit",
                    color: "var(--text)",
                    backgroundColor: "#fafafa",
                    boxSizing: "border-box",
                  }}
                />
                {hasChanges && (
                  <button
                    className="btn-primary"
                    onClick={saveVersion}
                    style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
                  >
                    Create Version
                  </button>
                )}
                <button
                  className="btn-secondary"
                  onClick={() => setShowExitConfirm(true)}
                  style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
                >
                  Exit Review
                </button>
              </div>
            )}
 
            {/* Editor — always mounted so Quill always has a stable DOM node */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                position: "relative",
                minHeight: "500px",
                borderRadius: "8px",
                padding: "2px",
                transition: "border 0.2s ease",
                border: reviewInProgress ? "2px solid #fcd34b" : "1px solid var(--border)",
                backgroundColor: reviewInProgress ? "#fafafa" : "#fcfcfc",
                // Hide (but keep mounted) when there are no changes and we've shown the banner
                display: (reviewInProgress && note.accessRole === "OWNER" && !hasChanges) ? "none" : "block",
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
                  resize: "none",
                  cursor: reviewInProgress ? "default" : "text",
                }}
              />
            </div>
          </div>
 
          {/* Exit review confirmation modal */}
          {showExitConfirm && (
            <div
              style={{
                position: "fixed",
                inset: 0,
                backgroundColor: "rgba(0,0,0,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
              }}
              onClick={() => setShowExitConfirm(false)}
            >
              <div
                style={{
                  backgroundColor: "#fff",
                  borderRadius: "10px",
                  padding: "1.5rem",
                  maxWidth: "380px",
                  width: "90%",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--text)" }}>
                  Exit Review
                </h3>
                <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--text-muted)" }}>
                  What would you like to do with the changes you've reviewed so far?
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setShowExitConfirm(false);
                      saveVersion();
                    }}
                  >
                    Save changes &amp; exit
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      setShowExitConfirm(false);
                      handleExitReview();
                    }}
                  >
                    Exit without saving
                  </button>
                  <button
                    className="btn-outline"
                    onClick={() => setShowExitConfirm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
 
      <footer style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
        Created at: {new Date(note.createdAt).toLocaleString()}
      </footer>
 
      {panel && (
        <AuditTooltip
          tooltip={panel}
          onAccept={acceptChange}
          onReject={rejectChange}
          onClose={() => setPanel(null)}
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
