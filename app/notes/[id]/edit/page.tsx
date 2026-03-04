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
import { saveAs } from "file-saver";
import * as quillToWord from "quill-to-word";

interface CursorModule {
  createCursor: (id: string, label: string, color: string) => void;
  moveCursor: (id: string, range: { index: number; length: number }) => void;
  removeCursor: (id: string) => void;
  toggleCursor: (id: string, value: boolean) => void;
}

interface JoinResponse {
  collaborators: { [email: string]: string };
  delta: Delta;
  revision: number;
}

interface CursorPayload {
  actorEmail: string;
  position: number;
}

enum messageType {
  COLLABORATOR_JOIN = "COLLABORATOR_JOIN",
  OPERATION = "OPERATION",
  COLLABORATOR_CURSOR = "COLLABORATOR_CURSOR",
}

function EditContent() {
  const { id: noteId } = useParams();
  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [collaborators, setCollaborators] = useState<{
    [email: string]: string;
  }>({});
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const docStateRef = useRef<DocState | null>(null);
  const stompClientRef = useRef<CompatClient | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const sentOperationFlushed = useRef<boolean>(false);

  if (!docStateRef.current) {
    docStateRef.current = new DocState(user!.userId);
  }

  useEffect(() => {
    if (!loading && editorRef.current && !quillRef.current) {
      const initQuill = async () => {
        const { default: QuillModule } = await import("quill");
        const { default: QuillCursors } = await import("quill-cursors");

        QuillModule.register("modules/cursors", QuillCursors);

        quillRef.current = new QuillModule(editorRef.current!, {
          theme: "snow",
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

        const cursorsModule = quillRef.current.getModule("cursors");
        if (!cursorsModule) {
          console.error("Cursors module failed to load!");
          return;
        }

        if (docStateRef.current?.document) {
          quillRef.current.setContents(docStateRef.current.document, "api");
        }

        quillRef.current.on("text-change", (delta, _oldDelta, source) => {
          if (source !== "user") return;

          sendCursorChange(quillRef.current?.getSelection()?.index ?? -1);

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
            sendCursorChange(range ? range.index : -1);
          },
        );
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
      });

      const docState = docStateRef.current!;
      if (docState.sentOperation && !sentOperationFlushed.current) {
        sendOperationToServer(docState.sentOperation);
        sentOperationFlushed.current = true;
      }
    });

    return () => {
      if (client.active) client.disconnect();
    };
  }, [noteId, loading]);

  async function sendCursorChange(position: number) {
    await apiFetch(`notes/${noteId}/cursor`, {
      method: "POST",
      body: JSON.stringify({ position }),
    });
  }

  function handleCursorChange(payload: CursorPayload) {
    if (payload.actorEmail === user!.email) return;
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
    const { actorId, revision } = payload;
    const docState = docStateRef.current!;

    if (actorId === user!.userId) {
      docState.acknowledgeOperation(revision, (pendingOperation) => {
        sentOperationFlushed.current = false;
        if (pendingOperation) sendOperationToServer(pendingOperation);
      });
    } else {
      const rehydrated: TextOperation = {
        delta: new Delta(payload.delta.ops || []),
        actorId,
        revision,
      };
      const deltaForQuill = docState.applyRemoteOperation(rehydrated);
      quillRef.current?.updateContents(deltaForQuill, "api");
    }
  }

  async function sendOperationToServer(operation: TextOperation) {
    await apiFetch(`notes/${noteId}/enqueue`, {
      method: "POST",
      body: JSON.stringify({
        delta: operation.delta,
        revision: operation.revision,
        actorId: user!.userId,
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

  async function downloadNoteAsWord() {
    const masterDelta = quillRef.current!.getContents();
    const quillToWordConfig = {
      exportAs: "doc" as const,
    };

    try {
      const docx = await quillToWord.generateWord(
        masterDelta,
        quillToWordConfig,
      );
      saveAs(docx as Blob, `${note?.title}.docx`);
    } catch (error) {
      console.log("Failed to generate word doc: ", error);
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
    <>
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
                    Collaborators:
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
              style={{
                display: "flex",
                gap: "8px",
                justifyContent: "flex-end",
              }}
            >
              <button
                className="btn-secondary"
                onClick={() => router.push(`/notes/${noteId}`)}
              >
                Preview
              </button>
              <button className="btn-primary" onClick={saveNote}>
                Save
              </button>
              <button className="btn-primary" onClick={downloadNoteAsWord}>
                download
              </button>
            </div>
          </div>
        </header>

        <div
          ref={editorRef}
          style={{
            minHeight: "500px",
            fontFamily: "monospace",
            fontSize: "1rem",
            lineHeight: "1.6",
            padding: "2rem",
            backgroundColor: "#fcfcfc",
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
    </>
  );
}

export default function EditPage() {
  return (
    <Suspense fallback={<p>Initializing Editor...</p>}>
      <EditContent />
    </Suspense>
  );
}
