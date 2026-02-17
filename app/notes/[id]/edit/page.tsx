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
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import Delta from "quill-delta";

interface JoinResponse {
  collaborators: string[];
  delta: Delta;
  revision: number;
}

function EditContent() {
  const { id: noteId } = useParams();
  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [collaboratorText, setCollaboratorText] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const docStateRef = useRef<DocState | null>(null);
  const stompClientRef = useRef<CompatClient | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);

  if (!docStateRef.current) {
    docStateRef.current = new DocState((newDoc: Delta) => {
      console.log("newDoc: " + newDoc);
    });
  }

  useEffect(() => {
    if (!loading && editorRef.current && !quillRef.current) {
      const initQuill = async () => {
        const { default: QuillModule } = await import("quill");

        quillRef.current = new QuillModule(editorRef.current!, {
          theme: "snow",
          modules: {
            toolbar: [],
          },
          placeholder: "Start typing...",
        });

        if (docStateRef.current?.document) {
          quillRef.current.setContents(docStateRef.current.document, "api");
        }

        quillRef.current.on("text-change", (delta, oldDelta, source) => {
          if (source !== "user") return;

          const textOperation = new TextOperation(
            delta,
            user!.userId,
            docStateRef.current!.lastSyncedRevision,
          );

          docStateRef.current?.queueOperation(
            textOperation,

            (currDoc: Delta) => currDoc.compose(delta),

            async (operation: TextOperation, revision: number) => {
              await sendOperationToServer(operation, revision);
            },
          );
        });
      };

      initQuill();
    }
  }, [loading]);

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

        docStateRef.current!.lastSyncedRevision = joinData.revision;
        docStateRef.current!.setDocument(joinData.delta || "");

        updateCollaboratorCount(joinData.collaborators);
      } catch (err: any) {
        setError(err.message || "Failed to load note");
      } finally {
        setLoading(false);
      }
    }

    if (noteId && user) {
      loadNoteAndJoin();
    }
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
        if (type === "OPERATION") {
          handleRemoteOperation(payload);
        }
        if (type === "COLLABORATOR_COUNT")
          updateCollaboratorCount(payload.count);
      });
    });

    return () => {
      if (client.active) client.disconnect();
    };
  }, [noteId, loading]);

  function handleRemoteOperation(payload: TextOperation) {
    const { delta, actorId, revision } = payload;
    const docState = docStateRef.current!;

    if (actorId === user!.userId) {
      if (docState.lastSyncedRevision < revision) {
        docState.acknowledgeOperation(
          revision,
          (pendingOperation: TextOperation | null) => {
            if (pendingOperation) {
              sendOperationToServer(
                pendingOperation,
                docState.lastSyncedRevision,
              );
            }
          },
        );
      }
    } else {
      docState.transformPendingOperations(payload);
      docState.lastSyncedRevision = revision;
      const transformed =
        docState.transformOperationAgainstLocalChanges(payload);

      applyRemoteChangeToQuill(transformed!);
      docState.setDocument(transformed!.delta);
    }
  }

  function applyRemoteChangeToQuill(op: TextOperation) {
    if (!quillRef.current) return;

    quillRef.current.updateContents(op.delta, "api");
  }

  async function sendOperationToServer(
    operation: TextOperation,
    revision: number,
  ): Promise<void> {
    await apiFetch(`notes/enqueue/${noteId}`, {
      method: "POST",
      body: JSON.stringify({ delta: operation.delta, revision, actorId: user!.userId }),
    });
  }

  function updateCollaboratorCount(collaborators: string[]) {
    if (collaborators.length === 1) {
      setCollaboratorText("You +1 collaborator");
    } else if (collaborators.length > 1) {
      let text = "";
      for (let i = 0; i < collaborators.length; i++) {
        if (collaborators[i] === user!.email) continue;
        text += collaborators[i] + " ";
      }
      setCollaboratorText(`Collaborators ${text}`);
    } else {
      setCollaboratorText("");
    }
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

      <div
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
        ref={editorRef}
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
