"use client";

import CreateNoteModal from "@/components/CreateNoteModal";
import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/api";
import { Note } from "@/src/types";
import { useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

function NotesContent() {
  const router = useRouter();
  const { user, loadingUser } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsloading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCreateNoteModal, setShowCreateNoteModal] = useState(false);

  useEffect(() => {
    async function fetchNotes() {
      try {
        const data = await apiFetch<Note[]>("notes", {
          method: "GET",
        });
        setNotes(data);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to fetch notes");
      } finally {
        setIsloading(false);
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
      setErrorMessage(err.message || "Failed to logout");
    }
  }

  if (loadingUser)
    return <div className="container-wide">Checking session...</div>;

  if (!user) {
    router.push("login");
    return null;
  }

  if (isLoading) return <div className="container-wide">Loading notes...</div>;
  if (errorMessage)
    return (
      <div className="container-wide" style={{ color: "red" }}>
        {errorMessage}
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
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "16px",
            marginTop: "24px",
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
                background: "#fff",
                border: "1px solid #E5E7EB",
                borderRadius: 16,
                padding: "18px",
                cursor: "pointer",
                transition: "all 0.2s ease",
                textAlign: "left",
                minHeight: 160,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-4px)";
                e.currentTarget.style.boxShadow =
                  "0 12px 24px rgba(0,0,0,0.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow =
                  "0 1px 2px rgba(0,0,0,0.04)";
              }}
            >
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 12,
                      background: "#EEF2FF",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                    }}
                  >
                    📄
                  </div>

                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "4px 8px",
                      borderRadius: 999,
                      background:
                        note.accessRole === "OWNER"
                          ? "#EDE9FE"
                          : note.accessRole === "SUPER"
                          ? "#DBEAFE"
                          : note.accessRole === "EDITOR"
                          ? "#D1FAE5"
                          : "#F3F4F6",
                      color:
                        note.accessRole === "OWNER"
                          ? "#6D28D9"
                          : note.accessRole === "SUPER"
                          ? "#1D4ED8"
                          : note.accessRole === "EDITOR"
                          ? "#047857"
                          : "#4B5563",
                    }}
                  >
                    {note.accessRole}
                  </span>
                </div>

                <h3
                  style={{
                    margin: 0,
                    fontSize: "1.05rem",
                    fontWeight: 700,
                    color: "#111827",
                  }}
                >
                  {note.title}
                </h3>
              </div>

              <div
                style={{
                  marginTop: 20,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 13,
                  color: "#6B7280",
                }}
              >
                <span>
                  {new Date(note.createdAt).toLocaleDateString()}
                </span>

                <span style={{ color: "#111827", fontWeight: 600 }}>
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
