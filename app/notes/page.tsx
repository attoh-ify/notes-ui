"use client";

import CreateNoteModal from "@/components/CreateNoteModal";
import { AppTopbar, Badge, Button, EmptyState, ErrorBanner, LoadingState, PageHeader, PageShell } from "@/components/ui";
import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/api";
import { Note, NoteAccessRole } from "@/src/types";
import { FileText, LogOut, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

const roleTone: Record<NoteAccessRole, "emerald" | "blue" | "purple" | "red" | "slate"> = {
  OWNER: "purple",
  SUPER: "blue",
  EDITOR: "emerald",
  VIEWER: "slate",
  RESTRICTED: "red",
};

function NotesContent() {
  const router = useRouter();
  const { user, loadingUser } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsloading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showCreateNoteModal, setShowCreateNoteModal] = useState(false);

  useEffect(() => {
    async function fetchNotes() {
      try {
        setErrorMessage(null);
        const data = await apiFetch<Note[]>("notes", { method: "GET" });
        setNotes(data);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to fetch notes");
      } finally {
        setIsloading(false);
      }
    }
    if (user) fetchNotes();
  }, [user]);

  const filteredNotes = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return notes;
    return notes.filter((note) => note.title.toLowerCase().includes(cleanQuery));
  }, [notes, query]);

  async function handleLogout() {
    try {
      await apiFetch(`users/logout`, { method: "POST" });
      document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC; SameSite=None; Secure";
      router.push("/login");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to logout");
    }
  }

  if (loadingUser) return <LoadingState title="Checking session" message="Confirming your account access." />;

  if (!user) {
    router.push("/login");
    return null;
  }

  if (isLoading) return <LoadingState title="Loading notes" message="Fetching your workspace." />;

  return (
    <>
      <AppTopbar>
        <Button variant="secondary" onClick={handleLogout} className="hidden sm:inline-flex">
          <LogOut size={16} /> Logout
        </Button>
      </AppTopbar>

      <PageShell>
        <PageHeader
          eyebrow="Dashboard"
          title="Your notes"
          description={`Signed in as ${user.email}. Create, review, and manage collaborative notes from one workspace.`}
          actions={
            <>
              <Button variant="secondary" onClick={handleLogout} className="sm:hidden">
                <LogOut size={16} /> Logout
              </Button>
              <Button onClick={() => setShowCreateNoteModal(true)}>
                <Plus size={16} /> New note
              </Button>
            </>
          }
        />

        <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search notes by title..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
            />
          </div>
          <p className="text-sm font-semibold text-slate-500">{filteredNotes.length} of {notes.length} notes</p>
        </div>

        <ErrorBanner message={errorMessage} />

        <div className="mt-5">
          {notes.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title="No notes yet"
              message="Create your first note, import a document, and start collaborating with your team."
              action={<Button onClick={() => setShowCreateNoteModal(true)}><Plus size={16} /> Create note</Button>}
            />
          ) : filteredNotes.length === 0 ? (
            <EmptyState icon="🔎" title="No matching notes" message="Try another title or clear your search to see every note." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filteredNotes.map((note) => (
                <button
                  key={note.id}
                  onClick={() => router.push(note.accessRole === "VIEWER" ? `/notes/${note.id}` : `/notes/${note.id}/edit`)}
                  className="group flex min-h-48 w-full flex-col justify-between rounded-[1.5rem] border border-slate-200 bg-white p-5 text-left shadow-sm shadow-slate-900/5 transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-xl hover:shadow-emerald-900/10 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                >
                  <div>
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                        <FileText size={22} />
                      </div>
                      <Badge tone={roleTone[note.accessRole]}>{note.accessRole}</Badge>
                    </div>
                    <h3 className="line-clamp-2 text-lg font-black leading-6 text-slate-950">{note.title || "Untitled note"}</h3>
                    <p className="mt-2 text-sm text-slate-500">{note.visibility.toLowerCase()}</p>
                  </div>
                  <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
                    <span className="font-semibold text-slate-500">{new Date(note.createdAt).toLocaleDateString()}</span>
                    <span className="font-black text-emerald-700 transition group-hover:translate-x-1">Open →</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {showCreateNoteModal && (
          <CreateNoteModal open={showCreateNoteModal} email={user.email} userId={user.userId} onClose={() => setShowCreateNoteModal(false)} />
        )}
      </PageShell>
    </>
  );
}

export default function NotesPage() {
  return (
    <Suspense fallback={<LoadingState title="Loading dashboard" />}>
      <NotesContent />
    </Suspense>
  );
}
