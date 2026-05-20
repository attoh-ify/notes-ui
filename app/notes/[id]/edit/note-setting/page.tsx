"use client";

import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import DeleteNoteModal from "@/components/DeleteNoteModal";
import { Note } from "@/src/types";
import RevisionHistorySection from "@/components/settings/RevisionHistorySection";
import { Badge, Button, EmptyState, ErrorBanner, LoadingState } from "@/components/ui";

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function NoteSettingsContent() {
  const { id: noteId } = useParams();
  const router = useRouter();
  const { user, loadingUser } = useAuth();
  const [note, setNote] = useState<Note | null>(null);
  const [isLoading, setIsloading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showDeleteNoteModal, setShowDeleteNoteModal] = useState(false);
  const isOwner = useRef<boolean>(false);

  useEffect(() => {
    async function fetchNotes() {
      try {
        const noteData = await apiFetch<Note>(`notes/${noteId}`, {
          method: "GET",
        });
        setNote(noteData);

        if (noteData.accessRole === "OWNER") {
          isOwner.current = true;
        }
      } catch (err: unknown) {
        setErrorMessage(getErrorMessage(err, "Failed to fetch note metadata"));
      } finally {
        setIsloading(false);
      }
    }
    fetchNotes();
  }, [noteId]);

  async function handleDeleteNote() {
    try {
      await apiFetch(`notes/${noteId}`, {
        method: "DELETE",
      });
      setShowDeleteNoteModal(false);
      router.push("/notes");
    } catch (err: unknown) {
      throw getErrorMessage(err, "Failed to delete note");
    }
  }

  if (loadingUser) {
    return <LoadingState title="Checking session" message="Confirming your account before opening settings." />;
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  if (isLoading) {
    return <LoadingState title="Loading settings" message="Fetching note metadata and version history." />;
  }

  if (errorMessage) {
    return (
      <main className="app-page-shell">
        <ErrorBanner message={errorMessage} />
      </main>
    );
  }

  if (!note) {
    return (
      <main className="app-page-shell">
        <EmptyState title="Note not found" message="This note may have been deleted or you may no longer have access to it." />
      </main>
    );
  }

  return (
    <Suspense fallback={<LoadingState title="Loading settings" message="Preparing note settings." />}>
      <main className="app-page-shell">
        <header className="app-page-header">
          <div className="min-w-0">
            <p className="app-page-eyebrow">Note settings</p>
            <h1 className="app-page-title">{note.title}</h1>
            <p className="app-page-description">Manage saved versions, privacy, collaboration, and owner-only actions for this note.</p>
            <div className="app-badge-row">
              <Badge tone="emerald">{note.accessRole}</Badge>
              <Badge tone={note.visibility === "PRIVATE" ? "amber" : "blue"}>{note.visibility}</Badge>
            </div>
          </div>

          <div className="app-page-actions">
            <Button variant="secondary" onClick={() => router.push(`/notes/${noteId}`)}>View note</Button>
            <Button onClick={() => router.push(`/notes/${noteId}/edit`)}>Back to editor</Button>
          </div>
        </header>

        <div className="settings-grid">
          <section className="settings-section">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="settings-section-title">Revision history</h2>
                <p className="settings-section-description">Open previous versions and inspect what changed without editing the current note.</p>
              </div>
            </div>
            <RevisionHistorySection noteId={noteId as string} title={note.title} />
          </section>

          {isOwner.current && (
            <section className="settings-section border-red-200 bg-red-50/40">
              <p className="app-page-eyebrow text-red-700">Danger zone</p>
              <h2 className="settings-section-title text-red-700">Delete this note</h2>
              <p className="settings-section-description">Once deleted, this note and its saved history cannot be recovered.</p>

              <div className="danger-panel">
                <div>
                  <p className="m-0 font-black text-slate-900">Permanent deletion</p>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">Only use this when you are sure this note is no longer needed.</p>
                </div>
                <Button variant="danger" onClick={() => setShowDeleteNoteModal(true)}>Delete permanently</Button>
              </div>
            </section>
          )}
        </div>

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
    <Suspense fallback={<LoadingState title="Loading settings" message="Opening note settings." />}>
      <NoteSettingsContent />
    </Suspense>
  );
}
