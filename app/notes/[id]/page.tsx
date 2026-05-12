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

  useEffect(() => {
    async function fetchNote() {
      try {
        setIsLoading(true);

        const noteData = await apiFetch<Note>(`notes/${noteId}`, {
          method: "GET",
        });

        if (
          noteData.accessRole === "RESTRICTED" &&
          noteData.visibility === "PRIVATE"
        ) {
          setIsRestricted(true);
          setIsLoading(false);
          return;
        }

        setNote(noteData);

        const noteVersionData = await apiFetch<NoteVersion>(
          `notes/${noteData.id}/versions/${noteData.currentNoteVersionNumber}`,
          { method: "GET" },
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

  useEffect(() => {
    if (quillRef.current && noteVersion?.masterDelta) {
      quillRef.current.setContents(noteVersion.masterDelta, "api");
    }
  }, [noteVersion]);

  if (loadingUser) {
    return <div className="container-wide">Checking session...</div>;
  }

  if (!user) {
    router.replace("/login");
    return null;
  }

  if (isLoading) {
    return <div className="container-wide">Loading note...</div>;
  }

  if (errorMessage) {
    return (
      <div className="container-wide" style={{ color: "red" }}>
        {errorMessage}
      </div>
    );
  }

  if (isRestricted) {
    return (
      <main
        className="container-wide"
        style={{
          maxWidth: "720px",
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "4rem 1rem",
        }}
      >
        <section
          style={{
            width: "100%",
            textAlign: "center",
            background: "white",
            border: "1px solid #E5E7EB",
            borderRadius: "18px",
            padding: "3rem 2rem",
            boxShadow: "0 4px 18px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</div>

          <span
            style={{
              fontSize: "0.72rem",
              color: "var(--primary)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Access Restricted
          </span>

          <h2
            style={{
              margin: "8px 0 10px",
              color: "#111827",
              fontSize: "2rem",
              lineHeight: 1.1,
            }}
          >
            Private Note
          </h2>

          <p
            style={{
              color: "#6B7280",
              margin: "0 auto",
              maxWidth: "420px",
              lineHeight: 1.6,
            }}
          >
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
        </section>
      </main>
    );
  }

  if (!note) {
    return <div className="container-wide">Note not found.</div>;
  }

  const canEdit = note.accessRole !== "VIEWER";

  return (
    <main
      className="container-wide"
      style={{
        maxWidth: "1150px",
        paddingBottom: 60,
      }}
    >
      <header
        style={{
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <div>
            <span
              style={{
                fontSize: "0.72rem",
                color: "var(--primary)",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Preview Note
            </span>

            <h1
              style={{
                fontSize: "2rem",
                margin: "8px 0 10px",
                color: "#111827",
                lineHeight: 1.1,
              }}
            >
              {note.title}
            </h1>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "#F3F4F6",
                  border: "1px solid #E5E7EB",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                <span style={{ color: "#6B7280" }}>Role:</span>
                <span>{note.accessRole}</span>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "#F3F4F6",
                  border: "1px solid #E5E7EB",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                <span style={{ color: "#6B7280" }}>Visibility:</span>
                <span>{note.visibility}</span>
              </div>

              {noteVersion && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: "#F3F4F6",
                    border: "1px solid #E5E7EB",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    color: "#374151",
                  }}
                >
                  <span style={{ color: "#6B7280" }}>Version:</span>
                  <span>{note.currentNoteVersionNumber}</span>
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={() => router.push("/notes")}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #E5E7EB",
                background: "white",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              Back
            </button>

            {canEdit && (
              <button
                onClick={() => router.push(`/notes/${noteId}/edit`)}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: "#111827",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 700,
                  boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
                }}
              >
                Edit Note
              </button>
            )}
          </div>
        </div>
      </header>

      <section
        style={{
          position: "relative",
          minHeight: "500px",
          borderRadius: "18px",
          overflow: "hidden",
          border: "1px solid #E5E7EB",
          backgroundColor: "white",
          boxShadow: "0 4px 18px rgba(0,0,0,0.04)",
        }}
      >
        <div
          style={{
            padding: "0.85rem 1rem",
            borderBottom: "1px solid #E5E7EB",
            background: "#F9FAFB",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              color: "#6B7280",
              fontSize: "0.85rem",
              fontWeight: 600,
            }}
          >
            <span>📄</span>
            <span>Read-only preview</span>
          </div>

          <span
            style={{
              fontSize: "0.78rem",
              color: "#9CA3AF",
              fontWeight: 500,
            }}
          >
            Last saved version
          </span>
        </div>

        <div
          ref={editorRef}
          style={{
            minHeight: "500px",
            fontFamily: "monospace",
            fontSize: "1rem",
            lineHeight: "1.7",
            padding: "2rem",
            border: "none",
            backgroundColor: "white",
            overflowY: "auto",
          }}
        />
      </section>

      <footer
        style={{
          marginTop: "1rem",
          fontSize: "0.75rem",
          color: "#9CA3AF",
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <span>Created at: {new Date(note.createdAt).toLocaleString()}</span>

        {note.updatedAt && (
          <span>Updated at: {new Date(note.updatedAt).toLocaleString()}</span>
        )}
      </footer>
    </main>
  );
}

export default function ViewNotePage() {
  return (
    <Suspense fallback={<p>Loading Note...</p>}>
      <ViewNoteContent />
    </Suspense>
  );
}