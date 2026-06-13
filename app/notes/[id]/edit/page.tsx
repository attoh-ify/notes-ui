"use client";

import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, Suspense } from "react";
import type { CompatClient } from "@stomp/stompjs";
import { DocState } from "@/src/lib/docState";
import type { TextOperation } from "@/src/lib/textOperation";
import { useAuth } from "@/src/context/AuthContext";
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import Delta from "quill-delta";
import { registerFormats } from "../../../../src/lib/quillformats";
import {
  JoinResponse,
  Note,
  ReviewInProgressResponse,
  CollaborationMode,
  CollaborationModePayload,
} from "../../../../src/types";
import CollaboratorsModal from "@/components/CollaboratorsSection";
import VisibilityModal from "@/components/VisibilityModal";
import { Badge, Button, EmptyState, ErrorBanner, LoadingState } from "@/components/ui";
import { useSoloSyncEngine } from "@/src/hooks/editor/useSoloSyncEngine";
import { useCollaborationEngine } from "@/src/hooks/editor/useCollaborationEngine";
import { useCursorPresence } from "@/src/hooks/editor/useCursorPresence";
import { useEditorSocket } from "@/src/hooks/editor/useEditorSocket";


function EditContent() {
  const { id: noteId } = useParams<{ id: string }>();
  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(null);
  const [collaborators, setCollaborators] = useState<Record<string, string>>({});
  const [isLoading, setIsloading] = useState(true);
  const [errorMessage, setErrorMessageMessage] = useState<string | null>(null);

  const [isReviewing, setIsReviewing] = useState<boolean>(false);
  const [versionComment, setVersionComment] = useState("");
  const [showCollaboratorsModal, setShowCollaboratorsModal] = useState(false);
  const [showVisibilityModal, setShowVisibilityModal] = useState(false);
  const [collaborationMode, setCollaborationMode] = useState<CollaborationMode>("SOLO");
  
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const initializingEditorRef = useRef(false);
  const docStateRef = useRef<DocState | null>(null);
  const stompClientRef = useRef<CompatClient | null>(null);
  const isOwner = useRef<boolean>(false);
  const isReviewingRef = useRef(false);
  const collaborationModeRef = useRef<CollaborationMode>("SOLO");
  const collaboratorsRef = useRef<Record<string, string>>({});
  const noteRef = useRef<Note | null>(null);
  const userRef = useRef(user);
  useEffect(() => { collaborationModeRef.current = collaborationMode; }, [collaborationMode]);
  useEffect(() => { collaboratorsRef.current = collaborators; }, [collaborators]);
  useEffect(() => { noteRef.current = note; }, [note]);
  useEffect(() => { userRef.current = user; }, [user]);
  useEffect(() => { isReviewingRef.current = isReviewing; }, [isReviewing]);

  if (!docStateRef.current && user) {
    docStateRef.current = new DocState(user.email);
  }

  const cursorPresence = useCursorPresence({
    noteId,
    quillRef,
    stompClientRef,
    userRef,
    collaboratorsRef,
    isReviewingRef,
    collaborationModeRef,
  });

  const soloSync = useSoloSyncEngine({
    noteId,
    quillRef,
    docStateRef,
    stompClientRef,
    userRef,
    noteRef,
    isReviewingRef,
    collaborationModeRef,
    setErrorMessage: setErrorMessageMessage,
  });

  const collaborationEngine = useCollaborationEngine({
    noteId,
    quillRef,
    docStateRef,
    stompClientRef,
    userRef,
    noteRef,
    isReviewingRef,
    collaborationModeRef,
    pendingSoloSyncAcksRef: soloSync.pendingSoloSyncAcksRef,
    soloSentOperationRef: soloSync.soloSentOperationRef,
    soloPendingOperationRef: soloSync.soloPendingOperationRef,
    clearSoloRetryTimer: soloSync.clearSoloRetryTimer,
    resetSoloRetryDelay: soloSync.resetSoloRetryDelay,
    scheduleSoloSync: soloSync.scheduleSoloSync,
    transformRemoteCursorAgainstDelta: cursorPresence.transformRemoteCursorAgainstDelta
  });

  useEditorSocket({
    noteId,
    user,
    router,
    stompClientRef,
    docStateRef,
    collaborationModeRef,
    isOwnerRef: isOwner,
    setNote,
    setCollaborators,
    remoteCursorRangesRef: cursorPresence.remoteCursorRangesRef,
    setIsLoading: setIsloading,
    setErrorMessage: setErrorMessageMessage,
    setCollaborationMode,
    setIsReviewing,
    clearRemoteOperationState: collaborationEngine.clearRemoteOperationState,
    onOperation: collaborationEngine.handleRemoteOperation,
    onCursorChange: cursorPresence.handleCursorChange,
    onSoloSyncAck: soloSync.handleSoloSyncAck,
    onCollaborationModeChange: handleCollaborationModeChange,
    onReviewStateChange: handleReviewInProgress,
    clearCollaboratorCursor: cursorPresence.clearCollaboratorCursor
  });

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
          readOnly: isReviewing && note?.accessRole !== "OWNER",
          modules: { toolbar: toolbarOptions, cursors: true },
          placeholder: "Start typing...",
        });

        if (docStateRef.current?.document) {
          quillRef.current.setContents(docStateRef.current.document, "api");
        }

        quillRef.current.on("text-change", (delta, _old, source) => {
          if (source !== "user") return;

          const range = quillRef.current?.getSelection();
          if (range) cursorPresence.sendCursorChange(range.index ?? -1, range.length ?? 0);

          if (collaborationModeRef.current === "SOLO") {
            soloSync.queueSoloOperation(delta);
            return;
          }

          docStateRef.current?.queueOperation(
            delta,
            async (op: TextOperation) => {
              cursorPresence.transformRemoteCursorAgainstDelta(delta, user!.email);
              await collaborationEngine.sendOrRetry(op);
            },
          );
        });

        quillRef.current.on("selection-change", async (range, _old, source) => {
          if (source !== "user" || !range) return;
          cursorPresence.sendCursorChange(range.index ?? -1, range.length ?? 0);
        });
      };

      init().finally(() => {
        initializingEditorRef.current = false;
      });
    }
  }, [isLoading, isReviewing, note?.accessRole]);

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
      await soloSync.flushSoloSync({ force: true, throwOnError: true });

      const joinData = await apiFetch<JoinResponse>(
        `notes/${noteId}/join`,
        { method: "GET" },
      );

      const cleanDelta = new Delta(joinData.delta.ops || []);

      docState.lastSyncedRevision = joinData.revision;
      docState.setDocument(cleanDelta);
      docState.resetPendingState();

      collaborationEngine.clearRemoteOperationState();

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


  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;

    const toolbar = editorRef.current?.previousSibling as HTMLElement;
    const isToolbar = toolbar?.classList.contains("ql-toolbar");

    const ownerCanEditDuringReview = isReviewing && note?.accessRole === "OWNER";

    const canEdit = !isReviewing || ownerCanEditDuringReview;

    quill.enable(canEdit);

    if (isToolbar) toolbar.style.display = canEdit ? "block" : "none";
  }, [isReviewing, isLoading, note?.accessRole]);

  async function saveNote() {
    try {
      if (collaborationModeRef.current === "SOLO") {
        await soloSync.flushSoloSync();
      }

      await apiFetch(`notes/${noteId}/save`, { method: "POST" });
    } catch (err: any) {
      setErrorMessageMessage(err.message || "Failed to save note");
    }
  }

  async function saveVersion(comment: string) {
    try {
      await saveNote();

      await apiFetch(`notes/${noteId}/versions`, {
        method: "POST",
        body: JSON.stringify({ comment }),
      });

      setVersionComment("");

      await handleExitReview();
    } catch (err: any) {
      setErrorMessageMessage(err.message || "Failed to save version");
    }
  }


  async function handleReviewNote() {
    if (collaborationModeRef.current === "SOLO") {
      await soloSync.flushSoloSync();
    }

    await saveNote();

    const quill = quillRef.current;
    if (!quill) return;

    cursorPresence.clearCollaboratorCursors();

    await apiFetch(`notes/${noteId}/review`, { method: "GET" });

    setIsReviewing(true);
    setVersionComment("");
    setNote((prev) => prev ? { ...prev, isReviewing: true } : prev);

    quill.enable(true);
    const toolbar = editorRef.current?.previousSibling as HTMLElement;
    if (toolbar?.classList.contains("ql-toolbar")) {
      toolbar.style.display = "block";
    }
  }

  function destroyQuillInstance() {
    if (!quillRef.current) return;

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

      collaborationEngine.clearRemoteOperationState();

      setCollaborators(joinData.collaborators);
      setIsReviewing(false);

      if (quillRef.current) {
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
      setNote((prev) => prev ? { ...prev, isReviewing: true } : prev);

      if (noteRef.current?.accessRole !== "OWNER") {
        destroyQuillInstance();
        return;
      }

      if (quillRef.current) {
        quillRef.current.enable(true);

        const toolbar = editorRef.current?.previousSibling as HTMLElement;
        if (toolbar?.classList.contains("ql-toolbar")) {
          toolbar.style.display = "block";
        }
      }

      return;
    }

    setNote((prev) => prev ? { ...prev, isReviewing: false } : prev);

    restoreEditorAfterReviewEnd();
  }

  async function handleExitReview() {
    try {
      await apiFetch(`notes/${noteId}/review/exit`, {
        method: "GET",
      });

    } catch (err: any) {
      setErrorMessageMessage(err.message || "Failed to exit review");
    }
  }

  async function openSettings() {
    await saveNote();
    router.push(`/notes/${noteId}/settings`);
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
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                alignItems: "stretch",
                minWidth: "240px",
              }}
            >
              <textarea
                value={versionComment}
                onChange={(e) => setVersionComment(e.target.value)}
                placeholder="Optional version comment..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  fontSize: "0.85rem",
                  fontFamily: "inherit",
                  resize: "vertical",
                  color: "var(--text)",
                  backgroundColor: "#fff",
                  boxSizing: "border-box",
                }}
              />

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <Button onClick={() => saveVersion(versionComment)}>
                  Create Version
                </Button>

                <Button variant="secondary" onClick={handleExitReview}>
                  Exit Review
                </Button>
              </div>
            </div>
          )}

          <Button variant="secondary" title="Settings" onClick={openSettings} className="px-3">⚙️</Button>
        </div>
      </header>

      {isReviewing && (
        <div className="app-alert">
          <span className="text-lg">📝</span>
          <span>
            {note.accessRole === "OWNER" ? (
              <><strong>Review Mode:</strong> You can polish this note while everyone else is locked out.</>
            ) : (
              <><strong>Review in Progress:</strong> The owner is polishing this note. Editing will reopen when review ends.</>
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
          <div className="editor-workspace">
            <section className={["editor-surface", isReviewing ? "reviewing" : ""].filter(Boolean).join(" ")}>
              <div
                ref={editorRef}
                className="editor-surface-content"
                style={{ cursor: isReviewing ? "default" : "text" }}
              />
            </section>
          </div>
        </>
      )}

      <footer className="app-footer-meta">
        <span>Created at: {new Date(note.createdAt).toLocaleString()}</span>
      </footer>

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