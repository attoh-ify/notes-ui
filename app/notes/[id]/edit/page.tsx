"use client";

import { API_BASE_URL, apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, Suspense } from "react";
import { Note } from "../../page";
import { Stomp, CompatClient } from "@stomp/stompjs";
import SockJS from "sockjs-client";

import { DocState } from "@/src/lib/docState";
import { TextOperation } from "@/src/lib/textOperation";
import { useAuth } from "@/src/context/AuthContext";

interface JoinResponse {
  collaboratorCount: number;
  text: string;
  revision: number;
}

interface OperationQueueOutPayload {
  acknowledgeTo: string;
  operation: TextOperation;
  revision: number;
}

function EditContent() {
  const { id: noteId } = useParams();
  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [content, setContent] = useState<string>("");
  const [collaboratorText, setCollaboratorText] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const docStateRef = useRef<DocState | null>(null);
  const stompClientRef = useRef<CompatClient | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!docStateRef.current) {
    docStateRef.current = new DocState((newDoc: string) => {
      setContent(newDoc);
      console.log(newDoc);
    });
  }

  useEffect(() => {
    async function loadNoteAndJoin() {
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

        docStateRef.current!.lastSyncedRevision = joinData.revision;
        console.log(joinData);
        docStateRef.current!.setDocumentText(joinData.text || "");

        setContent(docStateRef.current!.document);
        updateCollaboratorCount(joinData.collaboratorCount);
      } catch (err: any) {
        setError(err.message || "Failed to load note");
      } finally {
        setLoading(false);
      }
    }

    if (noteId && user!.userId) loadNoteAndJoin();
  }, [noteId, user]);

  useEffect(() => {
    if (!noteId || loading) return;

    const client = Stomp.over(
      () => new SockJS(`${API_BASE_URL}/relay?noteId=${noteId}`),
    );
    stompClientRef.current = client;

    client.connect({}, () => {
      client.subscribe(`/topic/note/${noteId}`, (message) => {
        const { type, payload } = JSON.parse(message.body);
        if (type === "OPERATION") handleRemoteOperation(payload);
        if (type === "COLLABORATOR_COUNT")
          updateCollaboratorCount(payload.count);
      });
    });

    return () => {
      if (client.active) client.disconnect();
    };
  }, [noteId, loading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [content]);

  function handleRemoteOperation(payload: OperationQueueOutPayload) {
    const { operation, revision, acknowledgeTo } = payload;
    console.log({ operation, revision, acknowledgeTo });
    const docState = docStateRef.current!;

    if (acknowledgeTo === user!.userId) {
      if (docState.lastSyncedRevision < revision) {
        docState.acknowledgeOperation(revision, (pendingOperation: TextOperation | null) => {
          if (pendingOperation) {
            sendOperationToServer(pendingOperation, docState.lastSyncedRevision);
          }
        });
      }
    } else {
      docState.transformPendingOperations(operation);
      docState.lastSyncedRevision = revision;
      const transformed =
        docState.transformOperationAgainstLocalChanges(operation);

      if (transformed === null) {
        // Operation canceled - do nothing
        console.log("[REMOTE] Operation canceled out by local changes");
      } else if (Array.isArray(transformed)) {
        // Operation split into multiple ops (from transformDI)
        let newDoc = docState.document;
        for (const op of transformed) {
          newDoc = applyOp(newDoc, op);
        }
        docState.setDocumentText(newDoc);
        setContent(newDoc);
      } else {
        // Single operation - normal case
        const newDoc = applyOp(docState.document, transformed);
        docState.setDocumentText(newDoc);
        setContent(newDoc);
      }
    }
  }

  function applyOp(doc: string, op: TextOperation): string {
    if (op.opName === "INS")
      return doc.slice(0, op.position) + op.operand + doc.slice(op.position);
    if (op.opName === "DEL")
      return (
        doc.slice(0, op.position) + doc.slice(op.position + op.operand.length)
      );
    return doc;
  }

  async function sendOperationToServer(operation: TextOperation, revision: number): Promise<void> {
    await apiFetch(`notes/enqueue/${noteId}`, {
      method: "POST",
      body: JSON.stringify({ operation, revision, from: user!.userId }),
    });
  }

  function updateCollaboratorCount(count: number) {
    const others = count - 1;
    if (others === 1) {
      setCollaboratorText("You +1 collaborator");
    } else if (others > 1) {
      setCollaboratorText(`You +${others} collaborators`);
    } else {
      setCollaboratorText("");
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    e.preventDefault();

    const start = e.currentTarget.selectionStart;
    const end = e.currentTarget.selectionEnd;
    const pastedText = e.clipboardData.getData("text");

    if (start != end) {
      const substr = docStateRef.current!.document.substring(start, end);
      sendDeleteOperation(start, substr);
    }
    sendInsertOperation(start, pastedText);
  }

  function sendInsertOperation(start: number, substring: string) {
    docStateRef.current!.queueOperation(
      new TextOperation(
        "INS",
        substring,
        start,
        docStateRef.current!.lastSyncedRevision,
        user!.userId,
      ),

      (currDoc: string) =>
        currDoc.slice(0, start - 1) + substring + currDoc.slice(start - 1),

      async (operation: TextOperation, revision: number) => {
        await sendOperationToServer(operation, revision);
      },
    );
  }

  function sendDeleteOperation(start: number, substring: string) {
    docStateRef.current!.queueOperation(
      new TextOperation(
        "DEL",
        substring,
        start,
        docStateRef.current!.lastSyncedRevision,
        user!.userId,
      ),

      (currDoc: string) =>
        currDoc.slice(0, start) + currDoc.slice(start + substring.length),

      async (operation: TextOperation, revision: number) => {
        await sendOperationToServer(operation, revision);
      },
    );
  }

  function handleLocalChange(e: React.FormEvent<HTMLTextAreaElement>) {
    const inputType = (e.nativeEvent as InputEvent).inputType;
    const editor = e.currentTarget;
    const currText = editor.value;
    const prevText = docStateRef.current!.document;
    const pos = editor.selectionStart;

    if (
      inputType === "insertText" ||
      inputType === "insertCompositionText" ||
      inputType === "insertLineBreak"
    ) {
      if (
        currText.length <= prevText.length &&
        inputType !== "insertLineBreak"
      ) {
        const charsToDelete = prevText.length - currText.length;
        const substr = prevText.substring(pos - 1, pos + charsToDelete);
        sendDeleteOperation(pos - 1, substr);
      }
      sendInsertOperation(pos, currText.substring(pos - 1, pos));
    } else if (inputType?.startsWith("delete")) {
      const charsDeleted = prevText.length - currText.length;
      const deletedStr = prevText.substring(pos, pos + charsDeleted);
      sendDeleteOperation(pos, deletedStr);
    }

    setContent(currText);
  }

  async function saveNote() {
    try {
      await apiFetch(`notes/${noteId}/save`, {
        method: "POST",
      });
    } catch (err: any) {
      setError(err.message || "Failed to save note");
    }
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
    <main className="container-wide" style={{ maxWidth: "1000px" }}>
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
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--textmuted)",
              marginBottom: "8px",
            }}
          >
            {collaboratorText || "Working alone"}
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="btn-secondary"
              onClick={() => router.push(`/notes/${noteId}`)}
            >
              Preview
            </button>
            <button className="btn-primary" onClick={saveNote}>
              Save
            </button>
          </div>
        </div>
      </header>

      <textarea
        className="input-field"
        ref={textareaRef}
        value={content}
        onInput={handleLocalChange}
        onPaste={handlePaste}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Start typing..."
        style={{
          minHeight: "500px",
          fontFamily: "monospace",
          fontSize: "1rem",
          lineHeight: "1.6",
          padding: "2rem",
          backgroundColor: "fcfcfc",
          resize: "none",
          border: "1px solid var(--border)",
        }}
      />

      <footer
        style={{
          marginTop: "1rem",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
        }}
      >
        Created at: {new Date(note.createdAt).toLocaleString()}
      </footer>
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
