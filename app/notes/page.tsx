"use client";

import NoteAccessModal, { NoteAccess } from "@/components/NoteAccessModal";
import { apiFetch } from "@/src/lib/api";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export type NoteVisibility = "PRIVATE" | "PUBLIC";
export type NoteAccessRole = "OWNER" | "SUPER" | "EDITOR" | "VIEWER";

export interface Note {
  id: string;
  userId: string;
  title: string;
  visibility: NoteVisibility;
  accessRole: NoteAccessRole;
  currentNoteVersion: string;
  createdAt: string;
}

export default function NotesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const userId = searchParams.get("userId");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [notesAccesses, setNotesAccesses] = useState<NoteAccess[]>([]);

  useEffect(() => {
    async function fetchNotes() {
      try {
        const data = await apiFetch<Note[]>("notes", {
          method: "GET",
        });
        setNotes(data);
      } catch (err: any) {
        setError(err.message || "Failed to fetch notes");
      } finally {
        setLoading(false);
      }
    }
    fetchNotes();
  }, []);

  async function createNote() {
    try {
      const data = await apiFetch<Note>("notes", {
        method: "POST",
      })
      if (!userId) {
        setError("User not authenticated");
        return;
      }
      router.push(`/notes/${data.id}/edit?email${email}&userId=${encodeURIComponent(userId)}`)
    } catch (err: any) {
      setError(err.message || "Failed to create Note.")
    }
  }

  async function openAccessPanel(note: Note) {
    try {
      console.log(note)
      const data = await apiFetch<NoteAccess[]>(`notes/${note.id}/access`, {
        method: "GET"
      });
      setNotesAccesses(data);
      setSelectedNote(note);
      setShowAccessModal(true);
    } catch (err: any) {
      setError(err.message || "Failed to get note accesses")
    }
  }

  if (loading) return <p>Loading notes...</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (userId === null) {
    setError("Invalid user");
    return;
  }

  return (
    <main
      style={{
        maxWidth: 600,
        margin: "50px auto",
        padding: 20,
        backgroundColor: "white",
        borderRadius: 8,
        boxShadow: "0 0 10px rgba(0,0,0,0.1)",
      }}
    >
      <h1 style={{ textAlign: "center", color: "#2F855A", marginBottom: 20 }}>
        {email}: My Notes
      </h1>

      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 15 }}>
        {notes.map((note) => {
          const path = note.accessRole === "OWNER" || note.accessRole === "EDITOR" || note.accessRole === "SUPER" ? `/notes/${note.id}/edit?email${email}&userId=${encodeURIComponent(userId)}` : `/notes/${note.id}?email${email}&userId=${encodeURIComponent(userId)}`;
          return (
            <li
              key={note.id}
              style={{
                padding: 15,
                border: "1px solid #CBD5E0",
                borderRadius: 6,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <strong>{note.title}</strong>{" "}
                {note.accessRole === "OWNER" && <span style={{ color: "#2F855A" }}>(Owner)</span>}
                {note.accessRole === "SUPER" && <span style={{ color: "#2F855A" }}>(Super)</span>}
                {note.accessRole === "EDITOR" && <span style={{ color: "#2F855A" }}>(Shared, Edit)</span>}
                {note.accessRole === "VIEWER" && <span style={{ color: "#2F855A" }}>(Read-Only)</span>}
              </div>
              <button
                onClick={() => router.push(path)}
                style={{
                  padding: "6px 12px",
                  backgroundColor: "#2F855A",
                  color: "white",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                Open
              </button>
                {
                  note.accessRole !== "VIEWER" && (
                    <button
                    onClick={() => openAccessPanel(note)}
                    style={{
                      padding: "6px 12px",
                      backgroundColor: "#2F855A",
                      color: "white",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                    >
                Access
              </button>
              )
            }
            </li>
          );
        })}
      </ul>
      {selectedNote && (
        <NoteAccessModal
          open={showAccessModal}
          onClose={() => setShowAccessModal(false)}
          noteId={selectedNote.id}
          role={selectedNote.accessRole}
          noteTitle={selectedNote.title}
          visibility={selectedNote.visibility}
          accesses={notesAccesses}
        />
      )}
      <button
        onClick={createNote}
        style={{
              marginTop: "10px",
              padding: "6px 12px",
              backgroundColor: "#2F855A",
              color: "white",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 14,
            }}
            >+ note</button>
    </main>
  );
}
