"use client";

import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { Note } from "../page";

export interface NoteVersion {
  id: string;
  content: string;
  revision: number;
  createdBy: string;
  versionNumber: number;
  createdAt: string;
}

function ViewNoteContent() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const userId = searchParams.get("userId");
  const [note, setNote] = useState<Note | null>(null);
  const [noteVersion, setNoteVersion] = useState<NoteVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function fetchNotes() {
      try {
        const noteData = await apiFetch<Note>(`notes/${id}`, { method: "GET" });
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

    if (id) fetchNotes();
  }, [id]);

  async function editNote() {
    try {
      if (userId === null) {
        setError("Invalid user");
        return;
      }
      router.push(
        `/notes/${note?.id}/edit?email${email}&userId=${encodeURIComponent(userId)}`,
      );
    } catch (err: any) {
      setError(err.message || "Something went wrong!");
    }
  }

  if (loading) return <p>Loading note...</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (!note) return <p>Note not found.</p>;

  return (
    <Suspense fallback={<nav>Global Loading...</nav>}>
      <main  className="container-wide" style={{ maxWidth: "1000px" }}>
        <header style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1rem", marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--primary)", fontWeight: "bold", textTransform: "uppercase" }}>Preview Note</span>
            <h1 style={{ fontSize: "1.75rem", margin: 0 }}>{note.title}</h1>
          </div>
          {note.accessRole !== "VIEWER" && (
            <button className="btn-primary" onClick={editNote}>
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