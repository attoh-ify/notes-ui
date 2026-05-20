"use client";

import { Button, ErrorBanner, FormField, Input, Modal } from "@/components/ui";
import { apiFetch } from "@/src/lib/api";
import { convertDocumentToDelta } from "@/src/lib/documentToDelta";
import { Note } from "@/src/types";
import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface CreateNoteModalProps {
  open: boolean;
  email: string;
  userId: string;
  onClose: () => void;
}

export default function CreateNoteModal({ open, onClose }: CreateNoteModalProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  if (!open) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    const extractedName = selected.name.replace(/\.[^/.]+$/, "");
    if (!title.trim()) setTitle(extractedName);
  }

  async function onCreate() {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);

    try {
      let initialDelta = null;

      if (file) {
        try {
          initialDelta = await convertDocumentToDelta(file);
        } catch {
          setError("Failed to convert document. Please check the file format.");
          setIsLoading(false);
          return;
        }
      }

      const data = await apiFetch<Note>("notes", {
        method: "POST",
        body: JSON.stringify({ title, initialDelta }),
        headers: { "Content-Type": "application/json" },
      });

      router.push(`/notes/${data.id}/edit`);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create note.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Modal
      title="Create a new note"
      eyebrow="New note"
      onClose={isLoading ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>Cancel</Button>
          <Button onClick={onCreate} disabled={isLoading || !title.trim()}>{isLoading ? "Creating..." : "Create note"}</Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormField label="Note title">
          <Input value={title} placeholder="Enter title..." onChange={(e) => setTitle(e.target.value)} disabled={isLoading} />
        </FormField>

        <div>
          <p className="text-sm font-bold text-slate-700">Upload document (optional)</p>
          <label className="mt-2 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center transition hover:border-emerald-300 hover:bg-emerald-50/60">
            <FileUp className="mb-2 h-7 w-7 text-emerald-600" />
            <span className="text-sm font-bold text-slate-700">Choose a PDF, Word, or TXT file</span>
            <span className="mt-1 text-xs text-slate-500">The title will auto-fill from the filename if empty.</span>
            <input className="sr-only" type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFileChange} disabled={isLoading} />
          </label>

          {file && (
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm font-semibold text-slate-700">
              📄 {file.name}
            </div>
          )}
        </div>

        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}
