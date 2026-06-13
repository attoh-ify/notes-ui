"use client";

import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense, useRef } from "react";
import { useAuth } from "@/src/context/AuthContext";
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import { Note, NoteVersion } from "@/src/types";
import { Badge, Button, EmptyState, ErrorBanner, LoadingState } from "@/components/ui";

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function ViewNoteContent() {
  const { id: noteId } = useParams();
  const searchParams = useSearchParams();
  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(null);
  const [noteVersion, setNoteVersion] = useState<NoteVersion | null>(null);
  const requestedVersionNumber = Number(searchParams.get("version") ?? 0);

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [isRestricted, setIsRestricted] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);

  useEffect(() => {
    async function fetchNote() {
      try {
        setIsLoading(true);

        const noteData = await apiFetch<Note>(`notes/${noteId}`, {
          method: "GET",
        });

        if (
          noteData.accessRole === "RESTRICTED" &&
          noteData.visibility === "PRIVATE"
        ) {
          setIsRestricted(true);
          setIsLoading(false);
          return;
        }

        setNote(noteData);

        const versionToFetch =
          requestedVersionNumber > 0
            ? requestedVersionNumber : 0;

        const noteVersionData = await apiFetch<NoteVersion>(
          `notes/${noteData.noteId}/versions/${versionToFetch}`,
          { method: "GET" },
        );

        setNoteVersion(noteVersionData);
      } catch (err: unknown) {
        setErrorMessage(getErrorMessage(err, "Failed to load note"));
      } finally {
        setIsLoading(false);
      }
    }

    if (noteId && user) {
      fetchNote();
    }
  }, [noteId, user, requestedVersionNumber]);

  useEffect(() => {
    if (!isLoading && noteVersion && editorRef.current && !quillRef.current) {
      const initQuill = async () => {
        const { default: QuillModule } = await import("quill");

        quillRef.current = new QuillModule(editorRef.current!, {
          theme: "snow",
          readOnly: true,
          modules: {
            toolbar: false,
            cursors: false,
          },
          placeholder: "",
        });

        quillRef.current.setContents(noteVersion.masterDelta, "api");
      };

      initQuill();
    }
  }, [isLoading, noteVersion]);

  useEffect(() => {
    if (quillRef.current && noteVersion?.masterDelta) {
      quillRef.current.setContents(noteVersion.masterDelta, "api");
    }
  }, [noteVersion]);

  if (loadingUser) {
    return <LoadingState title="Checking session" message="Confirming your account before opening this note." />;
  }

  if (!user) {
    router.replace("/login");
    return null;
  }

  if (isLoading) {
    return <LoadingState title="Loading note" message="Fetching the latest saved version." />;
  }

  if (errorMessage) {
    return (
      <main className="app-page-shell">
        <ErrorBanner message={errorMessage} />
      </main>
    );
  }

  if (isRestricted) {
    return (
      <main className="app-page-shell">
        <EmptyState
          icon="🔒"
          title="Private note"
          message="You don’t have permission to view this note. Go back to your notes list or ask the owner for access."
          action={<Button variant="secondary" onClick={() => router.push("/notes")}>Go back to notes</Button>}
        />
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

  const canEdit = note.accessRole !== "VIEWER";

  return (
    <main className="app-page-shell">
      <header className="app-page-header">
        <div className="min-w-0">
          <p className="app-page-eyebrow">Read-only preview</p>
          <h1 className="app-page-title">{note.title}</h1>

          <div className="app-badge-row">
            <Badge tone="emerald">Role: {note.accessRole}</Badge>
            <Badge tone={note.visibility === "PRIVATE" ? "amber" : "blue"}>
              Visibility: {note.visibility}
            </Badge>
            {noteVersion && <Badge tone="slate">Version {noteVersion.versionNumber}</Badge>}
          </div>
        </div>

        <div className="app-page-actions">
          <Button variant="secondary" onClick={() => router.push("/notes")}>Back</Button>
          {canEdit && <Button onClick={() => router.push(`/notes/${noteId}/edit`)}>Edit Note</Button>}
        </div>
      </header>

      <section className="app-panel overflow-hidden">
        <div className="app-panel-header">
          <span>📄 Read-only document</span>
          <span>Version {noteVersion?.versionNumber ?? "—"}</span>
        </div>

        <div ref={editorRef} className="editor-surface-content bg-white" />
      </section>

      <footer className="app-footer-meta">
        <span>Created at: {new Date(note.createdAt).toLocaleString()}</span>
        {note.updatedAt && <span>Updated at: {new Date(note.updatedAt).toLocaleString()}</span>}
      </footer>
    </main>
  );
}

export default function ViewNotePage() {
  return (
    <Suspense fallback={<LoadingState title="Loading note" message="Preparing note preview." />}>
      <ViewNoteContent />
    </Suspense>
  );
}
