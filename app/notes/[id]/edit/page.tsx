"use client";

import { API_BASE_URL, apiFetch } from "@/src/lib/api";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useRef, Suspense } from "react";
import { Note } from "../../page";
import { NoteVersion } from "../page";
import { Stomp, CompatClient } from "@stomp/stompjs";
import SockJS from "sockjs-client";

import { DocState } from "@/src/lib/docState";
import { TextOperation } from "@/src/lib/textOperation";

interface JoinResponse {
  collaboratorCount: number;
  text: string;
  revision: number;
}

export default function EditPage() {
  const { id: noteId } = useParams();
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const userId = searchParams.get("userId");
  const router = useRouter();

  const [content, setContent] = useState<string>("");
  const [collaboratorText, setCollaboratorText] = useState("");
  const [note, setNote] = useState<Note | null>(null);
  const [noteVersion, setNoteVersion] = useState<NoteVersion | null>(null);
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
          router.push(`/notes/${noteData.id}?email=${email}&userId=${userId}`);
          return;
        }

        const noteVersionData = await apiFetch<NoteVersion>(
          `notes/${noteData.id}/versions/${noteData.currentNoteVersion}`,
          { method: "GET" },
        );
        setNoteVersion(noteVersionData);

        const joinData = await apiFetch<JoinResponse>(
          `notes/${noteId}/join/${userId}`,
          { method: "GET" },
        );

        docStateRef.current!.lastSyncedRevision = joinData.revision;
        docStateRef.current!.setDocumentText(joinData.text || "");

        if (joinData.collaboratorCount < 2) {
          docStateRef.current!.setDocumentText(noteVersionData.content);
        }

        setContent(docStateRef.current!.document);
        updateCollaboratorCount(joinData.collaboratorCount);
      } catch (err: any) {
        setError(err.message || "Failed to load note");
      } finally {
        setLoading(false);
      }
    }

    if (noteId && userId) loadNoteAndJoin();
  }, [noteId, userId]);

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

  function handleRemoteOperation(payload: any) {
    const { operation, revision, acknowledgeTo } = payload;
    const docState = docStateRef.current!;

    if (acknowledgeTo === userId) {
      if (docState.lastSyncedRevision < revision) {
        docState.acknowledgeOperation(revision, (pendingOperation: any) => {
          sendOperationToServer(pendingOperation, docState.lastSyncedRevision);
        });
      }
    } else {
      docState.transformPendingOperations(operation);
      docState.lastSyncedRevision = revision;
      const transformed =
        docState.transformOperationAgainstLocalChanges(operation);

      if (transformed) {
        const newDoc = applyOp(docState.document, transformed);
        docState.setDocumentText(newDoc);
        setContent(newDoc);
      }
    }
  }

  function applyOp(doc: string, op: any) {
    if (op.opName === "INS")
      return doc.slice(0, op.position) + op.operand + doc.slice(op.position);
    if (op.opName === "DEL")
      return (
        doc.slice(0, op.position) + doc.slice(op.position + op.operand.length)
      );
    return doc;
  }

  async function sendOperationToServer(operation: any, revision: number) {
    await apiFetch(`notes/enqueue/${noteId}`, {
      method: "POST",
      body: JSON.stringify({ operation, revision, from: userId }),
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
    const start = e.currentTarget.selectionStart;
    const end = e.currentTarget.selectionEnd;
    const pastedText = e.clipboardData.getData("text");

    if (start != end) {
      const substr = docStateRef.current!.document.substring(start, end);
      sendDeleteOperation(start, substr);
    }
    sendInsertOperation(start + 1, pastedText);
  }

  function sendInsertOperation(start: number, substring: string) {
    docStateRef.current!.queueOperation(
      new TextOperation(
        "INS",
        substring,
        start - 1,
        docStateRef.current!.lastSyncedRevision,
      ),

      (currDoc: string) =>
        currDoc.slice(0, start - 1) + substring + currDoc.slice(start - 1),

      async (operation: any, revision: number) => {
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
      ),

      (currDoc: string) =>
        currDoc.slice(0, start) + currDoc.slice(start + substring.length),

      async (operation: any, revision: number) => {
        await sendOperationToServer(operation, revision);
      },
    );
  }

  function handleLocalChange(e: React.InputEvent<HTMLTextAreaElement>) {
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

  if (loading) return <p>Loading note...</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;

  if (!note) return <p>Note not found.</p>;

  return (
    <Suspense fallback={<nav>Global Loading...</nav>}>
      <main
        style={{
          maxWidth: 700,
          margin: "50px auto",
          padding: 25,
          backgroundColor: "white",
          borderRadius: 10,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 28, color: "#2F855A" }}>
            EDITING: {note.title}
          </h1>
          <div style={{ textAlign: "right" }}>
            <p
              id="collaborator_count"
              style={{ fontSize: 12, color: "#718096", margin: 0 }}
            >
              {collaboratorText}
            </p>
            <button
              style={{
                padding: "8px 16px",
                marginRight: 5,
                backgroundColor: "#2F855A",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 500,
                marginTop: 5,
              }}
              onClick={() =>
                router.push(`/notes/${noteId}?email=${email}&userId=${userId}`)
              }
            >
              Preview Note
            </button>
            <button
              style={{
                padding: "8px 16px",
                backgroundColor: "#2F855A",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 500,
                marginTop: 5,
              }}
              onClick={saveNote}
            >
              Save
            </button>
          </div>
        </header>

        <textarea
          ref={textareaRef}
          value={content}
          onInput={handleLocalChange}
          onPaste={handlePaste}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Start typing..."
          style={{
            width: "100%",
            padding: 15,
            border: "1px solid #CBD5E0",
            borderRadius: 6,
            backgroundColor: "#F7FAFC",
            fontSize: 14,
            lineHeight: 1.5,
            overflow: "hidden",
            resize: "none",
            minHeight: 300,
            color: "black",
          }}
          rows={1}
        />

        <footer style={{ fontSize: 12, color: "#718096" }}>
          Created at: {new Date(note.createdAt).toLocaleString()}
        </footer>
      </main>
    </Suspense>
  );
}
