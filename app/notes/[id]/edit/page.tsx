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

// interface ReconnectState {
//   rebasedPending: Delta;
//   cursorPosition: number | null;
//   serverDelta: Delta;
//   savedDocument: Delta;
// }

enum MessageType {
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
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const pendingDeltaRef = useRef<Delta>(new Delta());
  // const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  // const connectionLostRef = useRef(false);
  // const reconnectStateRef = useRef<ReconnectState | null>(null);

  // const HEARTBEAT_INTERVAL = 5000;

  if (!docStateRef.current) {
    docStateRef.current = new DocState(user!.userId);
  }

  useEffect(() => {
    const handleBeforeUnload = () => {
      navigator.sendBeacon(`${API_BASE_URL}/notes/${noteId}/save`);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [noteId]);

  useEffect(() => {
    if (!loading && editorRef.current && !quillRef.current) {
      const initQuill = async () => {
        const { default: QuillModule } = await import("quill");
        const { default: QuillCursors } = await import("quill-cursors");

        QuillModule.register("modules/cursors", QuillCursors);

        quillRef.current = new QuillModule(editorRef.current!, {
          theme: "snow",
          modules: {
            toolbar: ["italic", "bold"],
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

        // const reconnect = reconnectStateRef.current;
        // if (reconnect) {
        //   reconnectStateRef.current = null;

        //   if (reconnect.cursorPosition != null) {
        //     const emptyDoc = new Delta();
        //     const serverDiff = reconnect.savedDocument
        //       .invert(emptyDoc)
        //       .compose(reconnect.serverDelta);
        //     const newCursor = serverDiff.transformPosition(
        //       reconnect.cursorPosition,
        //     );
        //     quillRef.current.setSelection(newCursor, 0, "api");
        //   }

        //   if (reconnect.rebasedPending.ops.length > 0) {
        //     pendingDeltaRef.current = reconnect.rebasedPending;
        //     docStateRef.current?.queueOperation(
        //       reconnect.rebasedPending,
        //       async (operation: TextOperation) => {
        //         await sendOperationToServer(operation);
        //         pendingDeltaRef.current = new Delta();
        //       },
        //     );
        //   }
        // }

        quillRef.current.on("text-change", (delta, _oldDelta, source) => {
          if (source !== "user") return;

          pendingDeltaRef.current = pendingDeltaRef.current.compose(delta);

          // localStorage.setItem(
          //   `note-${noteId}`,
          //   JSON.stringify({
          //     pendingDelta: pendingDeltaRef.current,
          //     lastSyncedRevision: docStateRef.current?.lastSyncedRevision,
          //     document: docStateRef.current?.document,
          //     cursorPosition: quillRef.current?.getSelection()?.index ?? null,
          //   }),
          // );

          if (debounceRef.current) clearTimeout(debounceRef.current);

          debounceRef.current = setTimeout(() => {
            // if (!stompClientRef.current?.connected) return;

            const accumulatedDelta = pendingDeltaRef.current;
            const range = quillRef.current?.getSelection();
            sendCursorChange(range ? range.index : -1);

            docStateRef.current?.queueOperation(
              accumulatedDelta,
              async (operation: TextOperation) => {
                await sendOperationToServer(operation);
                pendingDeltaRef.current = new Delta();
              },
            );
          }, 300);
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

        const serverDelta = new Delta(joinData.delta.ops || []);
        docStateRef.current!.lastSyncedRevision = joinData.revision;
        setCollaborators(joinData.collaborators);

        // const rawData = localStorage.getItem(`note-${noteId}`);
        // const saved = rawData ? JSON.parse(rawData) : null;

        // if (saved?.pendingDelta?.ops?.length > 0) {
        //   const savedDocument = new Delta(saved.document?.ops || []);
        //   const savedPending = new Delta(saved.pendingDelta.ops);

        //   const rebasedPending = rebaseAgainstServerUpdate(
        //     savedDocument,
        //     savedPending,
        //     serverDelta,
        //   );

        //   docStateRef.current!.setDocument(serverDelta);

        //   reconnectStateRef.current = {
        //     rebasedPending,
        //     cursorPosition: saved.cursorPosition ?? null,
        //     serverDelta,
        //     savedDocument
        //   };

        //   localStorage.removeItem(`note-${noteId}`);
        // } else {
          docStateRef.current!.setDocument(serverDelta);
        // }
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
    // client.heartbeatIncoming = 4000;
    // client.heartbeatOutgoing = 4000;

    stompClientRef.current = client;

    client.connect({}, () => {
      client.subscribe(`/topic/note/${noteId}`, (message) => {
        const { type, payload } = JSON.parse(message.body);

        if (type === MessageType.OPERATION) {
          handleRemoteOperation(payload);
        }
        if (type === MessageType.COLLABORATOR_JOIN) {
          setCollaborators(payload.collaborators);
        }
        if (type === MessageType.COLLABORATOR_CURSOR) {
          handleCursorChange(payload);
        }
      });

      // startHeartbeat();
    });

    // client.onDisconnect = () => handleConnectionLost();
    // client.onWebSocketClose = () => handleConnectionLost();

    return () => {
      // clearInterval(heartbeatTimerRef.current!);
      if (client.active) client.disconnect();
    };
  }, [noteId, loading]);

  function rebaseAgainstServerUpdate(
    savedDocument: Delta,
    savedPending: Delta,
    serverCurrentDelta: Delta,
  ): Delta {
    const emptyDoc = new Delta();
    const serverDiff = savedDocument
      .invert(emptyDoc)
      .compose(serverCurrentDelta);

    return serverDiff.transform(savedPending, false);
  }

  // function startHeartbeat() {
  //   clearInterval(heartbeatTimerRef.current!);
  //   heartbeatTimerRef.current = setInterval(() => {
  //     if (!stompClientRef.current?.connected) {
  //       handleConnectionLost();
  //     }
  //   }, HEARTBEAT_INTERVAL);
  // }

  // async function handleConnectionLost() {
  //   if (connectionLostRef.current) return;
  //   connectionLostRef.current = true;

  //   clearInterval(heartbeatTimerRef.current!);
  //   await saveNote();
  // }

  async function sendCursorChange(position: number): Promise<void> {
    await apiFetch(`notes/${noteId}/cursor`, {
      method: "POST",
      body: JSON.stringify({ position }),
    });
  }

  function handleCursorChange(payload: CursorPayload): void {
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
    console.log("operation received: ", payload)
    const { actorId, revision } = payload;
    const docState = docStateRef.current!;

    if (actorId === user!.userId) {
      docState.acknowledgeOperation(
        revision,
        (pendingOperation: TextOperation | null) => {
          if (pendingOperation) {
            sendOperationToServer(pendingOperation);
          }
        },
      );
    } else {
      const rehydratedPayload: TextOperation = {
        delta: new Delta(payload.delta.ops || []),
        actorId,
        revision,
      };

      const deltaForQuill = docState.applyRemoteOperation(rehydratedPayload);
      quillRef.current?.updateContents(deltaForQuill, "api");
    }
  }

  async function sendOperationToServer(
    operation: TextOperation,
  ): Promise<void> {
    await apiFetch(`notes/${noteId}/enqueue`, {
      method: "POST",
      body: JSON.stringify({
        delta: operation.delta,
        revision: operation.revision,
        actorId: user!.userId,
      }),
    });
    console.log("operation sent: ", {
        delta: operation.delta,
        revision: operation.revision,
        actorId: user!.userId,
      })
  }

  async function saveNote() {
    try {
      await apiFetch(`notes/${noteId}/save`, { method: "POST" });
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
            style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}
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
  );
}

export default function EditPage() {
  return (
    <Suspense fallback={<p>Initializing Editor...</p>}>
      <EditContent />
    </Suspense>
  );
}
