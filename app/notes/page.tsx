"use client";

import CreateNoteModal from "@/components/CreateNoteModal";
import NoteAccessModal, { NoteAccess } from "@/components/NoteAccessModal";
import { apiFetch } from "@/src/lib/api";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

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

function NotesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email");
  const userId = searchParams.get("userId");
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [showCreateNoteModal, setShowCreateNoteModal] = useState(false);
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
  }, [email, userId]);

  async function openAccessPanel(note: Note) {
    try {
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

  async function handleLogout() {
    try {
      await apiFetch(`users/logout`, {
        method: "POST"
      })

      document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=None; Secure";

      router.push("/login")
    } catch (err: any) {
      setError(err.message || "Failed logout")
    }
  }

  if (loading) return <p>Loading notes...</p>;
  if (error) return <p style={{ color: "red" }}>{error}</p>;
  if (userId === null || email === null) {
    setError("Invalid user");
    return;
  }

  return (
    <Suspense fallback={<nav>Global Loading...</nav>}>
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
      <button
        style={{
            padding: "8px 16px",
            marginBottom: 5,
            backgroundColor: "#2F855A",
            color: "white",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 500,
            marginTop: 5
        }}
        onClick={handleLogout}
    >
        logout
    </button>

      <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 15 }}>
        {notes.map((note) => {
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
                onClick={() => router.push(`/notes/${note.id}?email=${encodeURIComponent(email)}&userId=${encodeURIComponent(userId)}`)}
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
      {showCreateNoteModal && (
        <CreateNoteModal
          open={showCreateNoteModal}
          email={email}
          userId={userId}
          onClose={() => setShowCreateNoteModal(false)}
        />
      )}
      <button
        onClick={() => setShowCreateNoteModal(true)}
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
    </Suspense>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={<p>Loading Notes Dashboard...</p>}>
      <NotesContent />
    </Suspense>
  )
}