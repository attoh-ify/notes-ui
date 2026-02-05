"use client";

import CreateNoteModal from "@/components/CreateNoteModal";
import NoteAccessModal, { NoteAccess } from "@/components/NoteAccessModal";
import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/api";
import { useRouter } from "next/navigation";
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
  const { user, loadingUser } = useAuth();
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
  }, [user]);

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
      setError(err.message || "Failed to logout")
    }
  }

  async function handleDeleteNote(noteId: string) {
    setNotes((prev) => prev.filter((note) => note.id !== noteId));
  }

  if (loadingUser) return <p>Checking session...</p>;

  if (!user) return <p>Please log in</p>;

  if (loading) return <p>Loading notes...</p>;
  
  if (error) return <p style={{ color: "red" }}>{error}</p>;

  return (
    <Suspense fallback={<nav>Global Loading...</nav>}>
    <main className="container-wide">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <div>
          <div className="text-xl font-bold tracking-tighter text-[#2F855A]">NOTES</div>
          <p style={{ color: "var(--text-muted)", fontSize: "1.5rem", fontWeight: "600" }}>{user.email}</p>
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn-secondary" onClick={handleLogout}>logout</button>
        </div>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "12px" }}>
        {notes.map((note) => (
          <div key={note.id}
            style={{ 
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "1rem",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              transition: "transform 0.1s"
            }}
          >
            <div>
              <span style={{ fontWeight: "600", display: "block", fontSize: "1.2rem" }}>
                {note.title}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                {note.accessRole}
              </span>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button className="btn-secondary" onClick={() => router.push(`/notes/${note.id}`)}>Open</button>
              {note.accessRole !== "VIEWER" && (
                <button className="btn-secondary" onClick={() => openAccessPanel(note)}>control</button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end"}}>
        <button className="btn-primary" onClick={() => setShowCreateNoteModal(true)}>+ New Note</button>
      </div>

      {selectedNote && (
        <NoteAccessModal
          open={showAccessModal}
          onClose={() => setShowAccessModal(false)}
          onDelete={() => handleDeleteNote(selectedNote.id)}
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
          email={user.email}
          userId={user.userId}
          onClose={() => setShowCreateNoteModal(false)}
        />
      )}
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