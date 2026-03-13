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
import displayFormattedNote from "@/src/lib/attribution";
import ExitReviewModal from "@/components/ExitReviewModal";
import ReviewSidebarModal from "@/components/ReviewSidebarModal";

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
  const [undoStack, setUndoStack] = useState<Delta[]>([]);
  const [panel, setPanel] = useState<TooltipState | null>(null);
  const [showExitReviewModal, setShowExitReviewModal] = useState(false);
  const [showReviewSidebarModal, setShowReviewSidebarModal] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const docStateRef = useRef<DocState | null>(null);
  const stompClientRef = useRef<CompatClient | null>(null);
  const sentOperationFlushed = useRef<boolean>(false);
  const isOwner = useRef<boolean>(false);

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
          const range = quillRef.current?.getSelection();
          if (!range) return;
          sendCursorChange(range.index ?? 0);
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
            if (!range) return;
            sendCursorChange(range.index ?? 0);
          },
        );
      };
      initQuill();
    }
  }, [loading, reviewInProgress, note?.accessRole]);

  useEffect(() => {
    const quill = quillRef.current;

    if (!revisionLog || !quill) return;

    const finalOps = displayFormattedNote(quill, revisionLog);

    if (finalOps !== null) {
      setHasChanges(true);
      quill.setContents(new Delta(finalOps), "api");
    }
    quill.root.addEventListener("click", handleClick);

    return () => {
      quill.root.removeEventListener("click", handleClick);
    };
  }, [revisionLog]);

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

        if (noteData.accessRole === "OWNER") {
          isOwner.current = true;
        }
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

  async function saveVersion(comment: string) {
    if (!quillRef.current) return;
    try {
      // await apiFetch(`notes/${noteId}/versions`, {
      //   method: "POST",
      //   body: JSON.stringify({ delta: quillRef.current.getContents() }),
      // });
      setShowReviewSidebarModal(false);
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
    if (isOwner.current) {
      setShowReviewSidebarModal(true);
    }
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
        method: "GET",
      });
      setRevisionLog(null);
      setHasChanges(false);
      router.refresh();
    } catch (err) {
      console.error("Failed to exit review:", err);
    }
  }

  async function openSettings() {
    saveNote();
    router.push(`/notes/${noteId}/edit/note-setting`);
  }

  async function saveReviewChanges() {}

  if (loadingUser)
    return <div className="container-wide">Checking session...</div>;
  if (!user) {
    router.push("/login");
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
            {isOwner.current && !reviewInProgress && (
              <button className="btn-outline" onClick={handleReviewNote}>
                Review
              </button>
            )}
            {!reviewInProgress && (
              <button className="btn-primary" onClick={saveNote}>
                Save changes
              </button>
            )}
            {reviewInProgress && isOwner.current && (
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

      {reviewInProgress && !isOwner.current ? (
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
            The owner is currently reviewing proposed changes. The editor will
            be available once the review is complete.
          </p>
        </div>
      ) : (
        <>
          {/* No-changes banner — shown when review is done */}
          {reviewInProgress && isOwner.current && !hasChanges && (
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
                All proposed changes have been reviewed. Exit review mode when
                ready.
              </p>
            </div>
          )}

          <div
            style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}
          >
            {/* Comment + action sidebar — only in review mode for owner */}
            {showReviewSidebarModal && isOwner.current && (
              <ReviewSidebarModal
                open={showReviewSidebarModal}
                onClose={() => setShowReviewSidebarModal(false)}
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
                transition: "border 0.2s ease",
                border: reviewInProgress
                  ? "2px solid #fcd34b"
                  : "1px solid var(--border)",
                backgroundColor: reviewInProgress ? "#fafafa" : "#fcfcfc",
                // Hide (but keep mounted) when there are no changes and we've shown the banner
                display:
                  reviewInProgress && note.accessRole === "OWNER" && !hasChanges
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
                  resize: "none",
                  cursor: reviewInProgress ? "default" : "text",
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
