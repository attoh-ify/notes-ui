"use client";

import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { Note } from "../page";
import { useAuth } from "@/src/context/AuthContext";

export interface NoteVersion {
  id: string;
  content: string;
  revision: number;
  createdBy: string;
  versionNumber: number;
  createdAt: string;
}

function ViewNoteContent() {
  const { id: noteId } = useParams();
  const { user, loadingUser } = useAuth();
  const [note, setNote] = useState<Note | null>(null);
  const [noteVersion, setNoteVersion] = useState<NoteVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function fetchNote() {
      try {
        const noteData = await apiFetch<Note>(`notes/${noteId}`, { method: "GET" });
        setNote(noteData);

        const noteVersionData = await apiFetch<NoteVersion>(
          `notes/${noteData.id}/versions/${noteData.currentNoteVersion}`,
          { method: "GET" },
        );
        setNoteVersion(noteVersionData);
      } catch (err: any) {
        setError(err.message || "Failed to load note");
      } finally {
        setLoading(false);
      }
    }

    if (noteId) fetchNote();
  }, [noteId, user]);

  if (loadingUser) return <div className="container-wide">Checking session...</div>;

  if (!user) {
    router.push("login");
    return null;
  }

  if (loading) return <div className="container-wide">Loading note...</div>;
  if (error) return <div className="container-wide" style={{ color: "red" }}>{error}</div>;
  if (!note) return <div className="container-wide">Note not found.</div>;

  return (
    <Suspense fallback={<nav>Global Loading...</nav>}>
      <main  className="container-wide" style={{ maxWidth: "1000px" }}>
        <header style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1rem", marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--primary)", fontWeight: "bold", textTransform: "uppercase" }}>Preview Note</span>
            <h1 style={{ fontSize: "1.75rem", margin: 0 }}>{note.title}</h1>
          </div>
          {note.accessRole !== "VIEWER" && (
            <button className="btn-primary" onClick={() => router.push(`/notes/${noteId}`)}>
              Edit Note
            </button>
          )}
        </header>

        <section
          style={{
            minHeight: "500px",
            fontFamily: "monospace",
            fontSize: "1rem",
            lineHeight: "1.6",
            padding: "2rem",
            backgroundColor: "fcfcfc",
            resize: "none",
            border: "1px solid var(--border)"
          }}
        >
          {noteVersion?.content}
        </section>

        <footer style={{ marginTop: "1rem", fontSize: "0.75rem", color: "var(--text-muted)"}}>
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
  )
}