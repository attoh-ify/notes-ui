"use client";

import CreateNoteModal from "@/components/CreateNoteModal";
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

export interface NoteAccess {
  id: string;
  email: string;
  role: NoteAccessRole;
}

function NotesContent() {
  const router = useRouter();
  const { user, loadingUser } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateNoteModal, setShowCreateNoteModal] = useState(false);

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

  async function handleLogout() {
    try {
      await apiFetch(`users/logout`, {
        method: "POST",
      });

      document.cookie =
        "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=None; Secure";

      router.push("/login");
    } catch (err: any) {
      setError(err.message || "Failed to logout");
    }
  }

  if (loadingUser)
    return <div className="container-wide">Checking session...</div>;

  if (!user) {
    router.push("login");
    return null;
  }

  if (loading) return <div className="container-wide">Loading notes...</div>;
  if (error)
    return (
      <div className="container-wide" style={{ color: "red" }}>
        {error}
      </div>
    );

  return (
    <Suspense fallback={<nav>Global Loading...</nav>}>
      <main className="container-wide">
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "2rem",
          }}
        >
          <div>
            <div className="text-xl font-bold tracking-tighter text-[#2F855A]">
              NOTES
            </div>
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "1.5rem",
                fontWeight: "600",
              }}
            >
              {user.email}
            </p>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button className="btn-secondary" onClick={handleLogout}>
              logout
            </button>
          </div>
        </header>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            marginBottom: "12px",
          }}
        >
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() =>
                router.push(
                  note.accessRole === "VIEWER"
                    ? `/notes/${note.id}`
                    : `/notes/${note.id}/edit`,
                )
              }
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "1rem",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                backgroundColor: "transparent",
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.1s ease-in-out",
                width: "100%",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor =
                  "var(--hover-bg, #f9f9f9)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.transform = "translateY(0px)";
              }}
            >
              <div>
                <span
                  style={{
                    fontWeight: "600",
                    display: "block",
                    fontSize: "1.2rem",
                    color: "var(--text)",
                  }}
                >
                  {note.title}
                </span>
                <span
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                  }}
                >
                  {note.accessRole}
                </span>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  color: "var(--primary)",
                }}
              >
                <span style={{ fontSize: "0.9rem", fontWeight: "500" }}>
                  Open →
                </span>
              </div>
            </button>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn-primary"
            onClick={() => setShowCreateNoteModal(true)}
          >
            + New Note
          </button>
        </div>

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
  );
}
