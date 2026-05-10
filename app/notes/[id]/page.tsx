"use client";

import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense, useRef } from "react";
import { useAuth } from "@/src/context/AuthContext";
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import { Note, NoteVersion } from "@/src/types";

function ViewNoteContent() {
  const { id: noteId } = useParams();
  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(null);
  const [noteVersion, setNoteVersion] = useState<NoteVersion | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isRestricted, setIsRestricted] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);

  // ----------------------------
  // FETCH NOTE
  // ----------------------------
  useEffect(() => {
    async function fetchNote() {
      try {
        setIsLoading(true);

        const noteData = await apiFetch<Note>(`notes/${noteId}`, {
          method: "GET",
        });

        // 🔒 HANDLE RESTRICTED DTO
        if ((noteData as any).accessRole === "RESTRICTED") {
          setIsRestricted(true);
          setIsLoading(false);
          return;
        }

        setNote(noteData);

        const noteVersionData = await apiFetch<NoteVersion>(
          `notes/${noteData.id}/versions/${noteData.currentNoteVersionNumber}`,
          { method: "GET" }
        );

        setNoteVersion(noteVersionData);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to load note");
      } finally {
        setIsLoading(false);
      }
    }

    if (noteId && user) {
      fetchNote();
    }
  }, [noteId, user]);

  // ----------------------------
  // INIT QUILL
  // ----------------------------
  useEffect(() => {
    if (!isLoading && noteVersion && editorRef.current && !quillRef.current) {
      const initQuill = async () => {
        const { default: QuillModule } = await import("quill");

        quillRef.current = new QuillModule(editorRef.current!, {
          theme: "snow",
          readOnly: true,
          modules: {
            toolbar: false,
            cursors: false,
          },
          placeholder: "",
        });

        quillRef.current.setContents(noteVersion.masterDelta, "api");
      };

      initQuill();
    }
  }, [isLoading, noteVersion]);

  // ----------------------------
  // UPDATE CONTENT ON VERSION CHANGE
  // ----------------------------
  useEffect(() => {
    if (quillRef.current && noteVersion?.masterDelta) {
      quillRef.current.setContents(noteVersion.masterDelta, "api");
    }
  }, [noteVersion]);

  // ----------------------------
  // AUTH GUARDS
  // ----------------------------
  if (loadingUser) {
    return <div className="container-wide">Checking session...</div>;
  }

  if (!user) {
    router.replace("/login");
    return null;
  }

  // ----------------------------
  // LOADING STATE
  // ----------------------------
  if (isLoading) {
    return <div className="container-wide">Loading note...</div>;
  }

  // ----------------------------
  // ERROR STATE
  // ----------------------------
  if (errorMessage) {
    return (
      <div className="container-wide" style={{ color: "red" }}>
        {errorMessage}
      </div>
    );
  }

  // ----------------------------
  // RESTRICTED STATE (NEW)
  // ----------------------------
  if (isRestricted) {
    return (
      <main
        className="container-wide"
        style={{
          textAlign: "center",
          padding: "4rem 1rem",
          maxWidth: "600px",
        }}
      >
        <div style={{ fontSize: "3rem" }}>🔒</div>

        <h2 style={{ marginTop: "1rem", color: "#111827" }}>
          Private Note
        </h2>

        <p style={{ color: "#6B7280", marginTop: "0.5rem" }}>
          You don’t have permission to view this note.
        </p>

        <button
          onClick={() => router.push("/notes")}
          style={{
            marginTop: "1.5rem",
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid #E5E7EB",
            background: "white",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Go back to notes
        </button>
      </main>
    );
  }

  // ----------------------------
  // EMPTY STATE
  // ----------------------------
  if (!note) {
    return <div className="container-wide">Note not found.</div>;
  }

  // ----------------------------
  // MAIN UI
  // ----------------------------
  return (
    <Suspense fallback={<nav>Loading...</nav>}>
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
              Preview Note
            </span>

            <h1 style={{ fontSize: "1.75rem", margin: 0 }}>
              {note.title}
            </h1>
          </div>

          {note.accessRole !== "VIEWER" && (
            <button
              className="btn-primary"
              onClick={() => router.push(`/notes/${noteId}/edit`)}
            >
              Edit
            </button>
          )}
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
            border: "1px solid var(--border)",
            overflowY: "auto",
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
    </Suspense>
  );
}

export default function ViewNotePage() {
  return (
    <Suspense fallback={<p>Loading Note...</p>}>
      <ViewNoteContent />
    </Suspense>
  );
}