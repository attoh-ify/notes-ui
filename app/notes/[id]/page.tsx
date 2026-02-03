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
            {note.title}
          </h1>
          {note.accessRole !== "VIEWER" && (
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
              }}
              onClick={editNote}
            >
              Edit Note
            </button>
          )}
        </header>

        <section
          style={{
            padding: 15,
            border: "1px solid #CBD5E0",
            borderRadius: 6,
            minHeight: 150,
            backgroundColor: "#F7FAFC",
            whiteSpace: "pre-wrap",
            color: "black",
          }}
        >
          {noteVersion?.content}
        </section>

        <footer style={{ fontSize: 12, color: "#718096" }}>
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