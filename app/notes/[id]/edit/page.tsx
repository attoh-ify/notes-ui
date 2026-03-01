"use client";

import { API_BASE_URL, apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef, Suspense } from "react";
import { Note } from "../../page";
import { Stomp, CompatClient } from "@stomp/stompjs";
import SockJS from "sockjs-client";

import { DocState, OTLogEntry } from "@/src/lib/docState";
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

enum messageType {
  COLLABORATOR_JOIN = "COLLABORATOR_JOIN",
  OPERATION = "OPERATION",
  COLLABORATOR_CURSOR = "COLLABORATOR_CURSOR",
}

// ─── Log Table ───────────────────────────────────────────────────────────────

const COL_HEADERS = [
  "#",
  "Time",
  "Event",
  "sentOp (before)",
  "pending (before)",
  "rev (before)",
  "incomingDelta",
  "incomingRev",
  "isAck",
  "transformed→Quill",
  "sentOp (after)",
  "pending (after)",
  "rev (after)",
  "nextSend",
];

function eventColor(event: OTLogEntry["event"]) {
  if (event === "QUEUE") return "#1976d2";
  if (event === "ACK") return "#388e3c";
  return "#e65100";
}

function Cell({ v, mono = true }: { v: string | number | boolean; mono?: boolean }) {
  const s = String(v);
  return (
    <td
      style={{
        padding: "3px 8px",
        borderBottom: "1px solid #e0e0e0",
        fontSize: "11px",
        fontFamily: mono ? "'JetBrains Mono', 'Fira Code', monospace" : "inherit",
        whiteSpace: "pre",
        maxWidth: 200,
        overflow: "hidden",
        textOverflow: "ellipsis",
        color: s === "∅" || s === "—" ? "#bbb" : "#222",
      }}
      title={s}
    >
      {s}
    </td>
  );
}

function LogTable({ entries, onClear }: { entries: OTLogEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState(false);

  function downloadCSV() {
    const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [
      COL_HEADERS.map(escape).join(","),
      ...entries.map((e) =>
        [
          e.seq,
          e.timestamp,
          e.event,
          e.sentOpBefore,
          e.pendingBefore,
          e.revisionBefore,
          e.incomingDelta,
          e.incomingRevision,
          e.isAck,
          e.transformedDelta,
          e.sentOpAfter,
          e.pendingAfter,
          e.revisionAfter,
          e.nextSend,
        ]
          .map((v) => escape(String(v)))
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ot-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "#fff",
        borderTop: "2px solid #1976d2",
        boxShadow: "0 -4px 24px rgba(0,0,0,0.12)",
        display: "flex",
        flexDirection: "column",
        maxHeight: open ? "45vh" : "40px",
        transition: "max-height 0.2s ease",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {/* header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px",
          height: 40,
          flexShrink: 0,
          borderBottom: open ? "1px solid #e0e0e0" : "none",
          cursor: "pointer",
          userSelect: "none",
        }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ fontWeight: 700, fontSize: 12, color: "#1976d2", letterSpacing: 1 }}>
          OT LOG
        </span>
        <span
          style={{
            background: "#1976d2",
            color: "#fff",
            borderRadius: 10,
            padding: "1px 8px",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {entries.length}
        </span>
        <span style={{ fontSize: 11, color: "#888", marginLeft: "auto" }}>
          {open ? "▼ collapse" : "▲ expand"}
        </span>
        {open && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                downloadCSV();
              }}
              style={{
                padding: "3px 12px",
                fontSize: 11,
                fontWeight: 700,
                background: "#1976d2",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                letterSpacing: 0.5,
              }}
            >
              ↓ CSV
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              style={{
                padding: "3px 12px",
                fontSize: 11,
                fontWeight: 700,
                background: "#fff",
                color: "#c62828",
                border: "1px solid #c62828",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </>
        )}
      </div>

      {/* table */}
      {open && (
        <div style={{ overflow: "auto", flex: 1 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11 }}>
            <thead>
              <tr style={{ background: "#f5f5f5", position: "sticky", top: 0 }}>
                {COL_HEADERS.map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "4px 8px",
                      textAlign: "left",
                      fontWeight: 700,
                      fontSize: 10,
                      color: "#555",
                      borderBottom: "2px solid #e0e0e0",
                      whiteSpace: "nowrap",
                      letterSpacing: 0.3,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr
                  key={e.seq}
                  style={{
                    background: e.seq % 2 === 0 ? "#fafafa" : "#fff",
                  }}
                >
                  <Cell v={e.seq} />
                  <Cell v={e.timestamp} />
                  <td
                    style={{
                      padding: "3px 8px",
                      borderBottom: "1px solid #e0e0e0",
                      fontSize: 11,
                      fontWeight: 700,
                      color: eventColor(e.event),
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.event}
                  </td>
                  <Cell v={e.sentOpBefore} />
                  <Cell v={e.pendingBefore} />
                  <Cell v={e.revisionBefore} />
                  <Cell v={e.incomingDelta} />
                  <Cell v={e.incomingRevision} />
                  <td
                    style={{
                      padding: "3px 8px",
                      borderBottom: "1px solid #e0e0e0",
                      fontSize: 11,
                      fontWeight: 700,
                      color: e.isAck ? "#388e3c" : "#888",
                    }}
                  >
                    {e.isAck ? "✓ ACK" : "—"}
                  </td>
                  <Cell v={e.transformedDelta} />
                  <Cell v={e.sentOpAfter} />
                  <Cell v={e.pendingAfter} />
                  <Cell v={e.revisionAfter} />
                  <Cell v={e.nextSend} />
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td
                    colSpan={COL_HEADERS.length}
                    style={{
                      textAlign: "center",
                      padding: 24,
                      color: "#bbb",
                      fontSize: 12,
                    }}
                  >
                    No operations yet — start typing to generate a trace.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function EditContent() {
  const { id: noteId } = useParams();
  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [collaborators, setCollaborators] = useState<{ [email: string]: string }>({});
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logEntries, setLogEntries] = useState<OTLogEntry[]>([]);

  const docStateRef    = useRef<DocState | null>(null);
  const stompClientRef = useRef<CompatClient | null>(null);
  const editorRef      = useRef<HTMLDivElement>(null);
  const quillRef       = useRef<Quill | null>(null);
  const debounceRef    = useRef<NodeJS.Timeout | null>(null);
  const pendingDeltaRef = useRef<Delta>(new Delta());

  if (!docStateRef.current) {
    docStateRef.current = new DocState(user!.userId);
  }

  // Sync log from docState into React state after each operation
  function syncLog() {
    setLogEntries([...docStateRef.current!.log]);
  }

  // ── Quill init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!loading && editorRef.current && !quillRef.current) {
      const initQuill = async () => {
        const { default: QuillModule } = await import("quill");
        const { default: QuillCursors } = await import("quill-cursors");

        QuillModule.register("modules/cursors", QuillCursors);

        quillRef.current = new QuillModule(editorRef.current!, {
          theme: "snow",
          modules: { toolbar: ["italic", "bold"], cursors: true },
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

          pendingDeltaRef.current = pendingDeltaRef.current.compose(delta);

          if (debounceRef.current) clearTimeout(debounceRef.current);

          debounceRef.current = setTimeout(() => {
            if (!stompClientRef.current?.connected) return;

            const accumulatedDelta = pendingDeltaRef.current;
            const range = quillRef.current?.getSelection();
            sendCursorChange(range ? range.index : -1);

            docStateRef.current?.queueOperation(
              accumulatedDelta,
              async (operation: TextOperation) => {
                await sendOperationToServer(operation);
                pendingDeltaRef.current = new Delta();
                syncLog();
              },
            ).then(() => syncLog());
          }, 400);
        });

        quillRef.current.on("selection-change", async (range, _oldRange, source) => {
          if (source !== "user") return;
          sendCursorChange(range ? range.index : -1);
        });
      };

      initQuill();
    }
  }, [loading]);

  // ── Load note ───────────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadNoteAndJoin() {
      if (!noteId || !user) return;
      try {
        const noteData = await apiFetch<Note>(`notes/${noteId}`, { method: "GET" });
        setNote(noteData);

        if (noteData.accessRole === "VIEWER") {
          router.push(`/notes/${noteId}`);
          return;
        }

        const joinData = await apiFetch<JoinResponse>(`notes/${noteId}/join`, { method: "GET" });

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

  // ── WebSocket ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!noteId || loading) return;

    const client = Stomp.over(() => new SockJS(`${API_BASE_URL}/relay?noteId=${noteId}`));
    client.debug = () => {};
    stompClientRef.current = client;

    client.connect({}, () => {
      client.subscribe(`/topic/note/${noteId}`, (message) => {
        const { type, payload } = JSON.parse(message.body);
        if (type === messageType.OPERATION)       handleRemoteOperation(payload);
        if (type === messageType.COLLABORATOR_JOIN) setCollaborators(payload.collaborators);
        if (type === messageType.COLLABORATOR_CURSOR) handleCursorChange(payload);
      });
    });

    return () => { if (client.active) client.disconnect(); };
  }, [noteId, loading]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function sendCursorChange(position: number) {
    await apiFetch(`notes/${noteId}/cursor`, {
      method: "POST",
      body: JSON.stringify({ position }),
    });
  }

  function handleCursorChange(payload: CursorPayload) {
    if (payload.actorEmail === user!.email) return;
    const cursor = quillRef.current!.getModule("cursors") as CursorModule;
    cursor.createCursor(payload.actorEmail, payload.actorEmail, collaborators[payload.actorEmail]);
    cursor.moveCursor(payload.actorEmail, { index: payload.position, length: 0 });
  }

  function handleRemoteOperation(payload: TextOperation) {
    const { actorId, revision } = payload;
    const docState = docStateRef.current!;

    if (actorId === user!.userId) {
      docState.acknowledgeOperation(revision, (pendingOperation) => {
        if (pendingOperation) sendOperationToServer(pendingOperation);
      });
      syncLog();
    } else {
      const rehydrated: TextOperation = {
        delta: new Delta(payload.delta.ops || []),
        actorId,
        revision,
      };
      const deltaForQuill = docState.applyRemoteOperation(rehydrated);
      syncLog();
      quillRef.current?.updateContents(deltaForQuill, "api");
    }
  }

  async function sendOperationToServer(operation: TextOperation) {
    await apiFetch(`notes/${noteId}/enqueue`, {
      method: "POST",
      body: JSON.stringify({
        delta:    operation.delta,
        revision: operation.revision,
        actorId:  user!.userId,
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

  // ── Guards ───────────────────────────────────────────────────────────────────
  if (loadingUser) return <div className="container-wide">Checking session...</div>;
  if (!user) { router.push("login"); return null; }
  if (loading) return <div className="container-wide">Loading note...</div>;
  if (error)   return <div className="container-wide" style={{ color: "red" }}>{error}</div>;
  if (!note)   return <div className="container-wide">Note not found.</div>;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
      <main className="container-wide" style={{ maxWidth: "1000px", paddingBottom: 60 }}>
        <header
          style={{
            borderBottom:   "1px solid var(--border)",
            paddingBottom:  "1rem",
            marginBottom:   "1.5rem",
            display:        "flex",
            justifyContent: "space-between",
            alignItems:     "flex-end",
          }}
        >
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--primary)", fontWeight: "bold", textTransform: "uppercase" }}>
              Editing Note
            </span>
            <h1 style={{ fontSize: "1.75rem", margin: 0 }}>{note.title}</h1>
          </div>

          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.875rem", marginBottom: "8px", display: "flex", gap: "5px", justifyContent: "flex-end", flexWrap: "wrap" }}>
              {Object.entries(collaborators).length > 0 ? (
                <>
                  <span style={{ color: "var(--textmuted)" }}>Collaborators:</span>
                  {Object.entries(collaborators).map(([email, color], index, array) => (
                    <span key={email} style={{ color, fontWeight: "600" }}>
                      {email === user?.email ? "You" : email}
                      {index < array.length - 1 && <span style={{ color, marginLeft: "2px" }}>,</span>}
                    </span>
                  ))}
                </>
              ) : (
                <span style={{ color: "var(--textmuted)" }}>Working alone</span>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => router.push(`/notes/${noteId}`)}>
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
            minHeight:       "500px",
            fontFamily:      "monospace",
            fontSize:        "1rem",
            lineHeight:      "1.6",
            padding:         "2rem",
            backgroundColor: "#fcfcfc",
            resize:          "none",
            border:          "1px solid var(--border)",
          }}
        />

        <footer style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Created at: {new Date(note.createdAt).toLocaleString()}
        </footer>
      </main>

      <LogTable
        entries={logEntries}
        onClear={() => {
          docStateRef.current!.log = [];
          setLogEntries([]);
        }}
      />
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