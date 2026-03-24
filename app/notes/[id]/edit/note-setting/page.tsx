"use client";

import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import DeleteNoteModal from "@/components/DeleteNoteModal";
import { Note, NoteVisibility } from "@/src/types";
import CollaboratorsSection from "@/components/settings/CollaboratorsSection";
import RevisionHistorySection from "@/components/settings/RevisionHistorySection";
import VisibilitySection from "@/components/settings/VisibilitySection";

function NoteSettingsContent() {
  const { id: noteId } = useParams();
  const router = useRouter();
  const { user, loadingUser } = useAuth();
  const [note, setNote] = useState<Note | null>(null);
  const [isLoading, setIsloading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentVisibility, setCurrentVisibility] = useState<NoteVisibility>();
  const [showDeleteNoteModal, setShowDeleteNoteModal] = useState(false);
  const isOwner = useRef<boolean>(false);

  useEffect(() => {
    async function fetchNotes() {
      try {
        const noteData = await apiFetch<Note>(`notes/${noteId}`, {
          method: "GET",
        });
        setNote(noteData);
        setCurrentVisibility(noteData.visibility);

        if (noteData.accessRole === "OWNER") {
          isOwner.current = true;
        }
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to fetch note metadata");
      } finally {
        setIsloading(false);
      }
    }
    fetchNotes();
  }, [user]);

  async function handleDeleteNote() {
    try {
      await apiFetch(`notes/${noteId}`, {
        method: "DELETE",
      });
      setShowDeleteNoteModal(false);
      router.push("/notes");
    } catch (err: any) {
      throw err.message || "Failed to delete note";
    }
  }

  if (loadingUser)
    return <div className="container-wide">Checking session...</div>;

  if (!user) {
    router.push("login");
    return null;
  }

  if (isLoading) return <div className="container-wide">Loading note...</div>;
  if (errorMessage)
    return (
      <div className="container-wide" style={{ color: "red" }}>
        {errorMessage}
      </div>
    );
  if (!note) return <div className="container-wide">Note not found.</div>;

  return (
    <Suspense fallback={<div>Note Settings...</div>}>
      <main
        className="container-center"
        style={{ padding: "40px 20px", maxWidth: "800px", margin: "0 auto" }}
      >
        <header
          style={{
            marginBottom: "32px",
            borderBottom: "1px solid #E2E8F0",
            paddingBottom: "16px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontWeight: "700",
              fontSize: "1.8rem",
              color: "#1A202C",
            }}
          >
            "{note.title}" Settings
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: "1rem", color: "#718096" }}>
            Manage versions, collaborations, and privacy.
          </p>
        </header>

        <RevisionHistorySection noteId={noteId as string} title={note.title} />

        <CollaboratorsSection
          noteId={noteId as string}
          email={user.email}
          accessRole={note.accessRole}
        />

        {currentVisibility && (
          <VisibilitySection
            noteId={noteId as string}
            accessRole={note.accessRole}
            visibility={currentVisibility}
          />
        )}

        {isOwner.current && (
          <section
            style={{
              marginTop: "60px",
              paddingTop: "30px",
              borderTop: "2px solid #FED7D7",
            }}
          >
            <h3
              style={{
                fontSize: "1.2rem",
                fontWeight: "600",
                marginBottom: "16px",
                color: "#C53030",
              }}
            >
              Danger Zone
            </h3>
            <div
              style={{
                border: "1px solid #FEB2B2",
                borderRadius: 12,
                padding: "20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "#FFF5F5",
              }}
            >
              <div>
                <p style={{ margin: 0, fontWeight: "600", color: "#2D3748" }}>
                  Delete this note
                </p>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: "0.85rem",
                    color: "#718096",
                  }}
                >
                  Once deleted, it cannot be recovered. All history will be
                  lost.
                </p>
              </div>
              <button
                onClick={() => setShowDeleteNoteModal(true)}
                className="btn-delete"
                style={{
                  padding: "10px 24px",
                  backgroundColor: "#E53E3E",
                  color: "white",
                  borderRadius: 8,
                  border: "none",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Delete Permanently
              </button>
            </div>
          </section>
        )}

        {showDeleteNoteModal && (
          <DeleteNoteModal
            open={showDeleteNoteModal}
            title={note.title}
            onClose={() => setShowDeleteNoteModal(false)}
            onDelete={() => handleDeleteNote()}
          />
        )}
      </main>
    </Suspense>
  );
}

export default function NoteSettingsPage() {
  return (
    <Suspense fallback={<p>Loading notes settings page...</p>}>
      <NoteSettingsContent />
    </Suspense>
  );
}
