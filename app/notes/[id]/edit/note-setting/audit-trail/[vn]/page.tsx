"use client";

import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, Suspense, useRef } from "react";
import { useAuth } from "@/src/context/AuthContext";
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import { Note, NoteVersion } from "@/src/types";
import { TextOperation } from "@/src/lib/textOperation";
import { registerFormats } from "@/src/lib/quillformats";
import { ReviewProjection } from "@/src/lib/attribution";
import { Delta } from "quill";

function AuditNoteContent() {
  const { id: noteId, vn: versionNumberParam } = useParams();
  const versionNumber = Number(versionNumberParam);

  if (isNaN(versionNumber)) {
    throw new Error("Invalid version number");
  }

  const { user, loadingUser } = useAuth();
  const [note, setNote] = useState<Note | null>(null);
  const [noteVersion, setNoteVersion] = useState<NoteVersion | null>(null);
  const [isLoading, setIsloading] = useState(true);
  const [quillReady, setQuillReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const router = useRouter();
  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);

  useEffect(() => {
    async function fetchNote() {
      try {
        const noteData = await apiFetch<Note>(`notes/${noteId}`, {
          method: "GET",
        });
        setNote(noteData);

        const noteVersionData = await apiFetch<NoteVersion>(
          `notes/${noteData.id}/versions/${versionNumber}`,
          { method: "GET" },
        );
        setNoteVersion(noteVersionData);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to load note");
      } finally {
        setIsloading(false);
      }
    }

    if (noteId) fetchNote();
  }, [noteId, user]);

  useEffect(() => {
    if (!isLoading && editorRef.current && !quillRef.current) {
      const initQuill = async () => {
        const { default: QuillModule } = await import("quill");
        registerFormats(QuillModule);

        quillRef.current = new QuillModule(editorRef.current!, {
          theme: "snow",
          readOnly: true,
          modules: {
            toolbar: false,
            cursors: false,
          },
          placeholder: "",
        });
        setQuillReady(true);
      };

      initQuill();
    }
  }, [isLoading]);

  useEffect(() => {
    async function initAudit() {
      const quill = quillRef.current;
      if (!quill) return;
      
      try {
        let committedOps: TextOperation[] | null;
        let pendingOps: TextOperation[];

        const logData = await apiFetch<TextOperation[]>(
          `notes/${noteId}/revision-log`,
          { method: "GET" },
        );

        if (versionNumber > 1) {
          const prevNoteVersionData = await apiFetch<NoteVersion>(
            `notes/${noteId}/versions/${versionNumber - 1}`,
            { method: "GET" },
          );

          committedOps = logData.filter(
            (op) => op.revision <= prevNoteVersionData.revision,
          );
          pendingOps = logData.filter(
            (op) =>
              op.revision > prevNoteVersionData.revision &&
              op.revision <= noteVersion!.revision,
          );
        } else {
          committedOps = [];
          pendingOps = logData;
        }
        console.log(committedOps, pendingOps)

        const projection = await apiFetch<ReviewProjection>(`notes/${noteId}/build-attribution`, {
          method: "GET",
        });

        if (projection.visualDelta.ops.length !== 0) {
          quill.setContents(new Delta(projection.visualDelta.ops), "api");
        }
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to load note");
      }
    }

    if (noteId && noteVersion && !isLoading && quillReady) initAudit();
  }, [noteId, noteVersion, isLoading, quillReady]);

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
    <Suspense fallback={<nav>Global Loading...</nav>}>
      <main className="container-wide" style={{ maxWidth: "1000px" }}>
        <header
          style={{
            borderBottom: "1px solid var(--border)",
            paddingBottom: "1rem",
            marginBottom: "1.5rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div>
            <span
              style={{
                fontSize: "0.75rem",
                color: "var(--primary)",
                fontWeight: "bold",
                textTransform: "uppercase",
              }}
            >
              Audit Note
            </span>
            <h1 style={{ fontSize: "1.75rem", margin: 0 }}>{note.title}</h1>
          </div>
        </header>

        <div
          style={{
            minHeight: "500px",
            fontFamily: "monospace",
            fontSize: "1rem",
            lineHeight: "1.6",
            padding: "2rem",
            backgroundColor: "#fcfcfc",
            resize: "none",
            border: "1px solid var(--border)",
            overflowY: "auto",
          }}
          ref={editorRef}
        />

        <footer
          style={{
            marginTop: "1rem",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
          }}
        >
          Created at: {new Date(note.createdAt).toLocaleString()}
        </footer>
      </main>
    </Suspense>
  );
}

export default function ViewNotePage() {
  return (
    <Suspense fallback={<p>Loading Note...</p>}>
      <AuditNoteContent />
    </Suspense>
  );
}
