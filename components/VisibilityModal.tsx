"use client";

import { Badge, Button, ErrorBanner, Modal } from "@/components/ui";
import { apiFetch } from "@/src/lib/api";
import { NoteAccessRole, NoteVisibility } from "@/src/types";
import { Globe2, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

interface VisibilityModalProps {
  open: boolean;
  onClose: () => void;
  noteId: string;
  accessRole: NoteAccessRole;
  visibility: NoteVisibility;
  onVisibilityChanged?: (visibility: NoteVisibility) => void;
}

export default function VisibilityModal({ open, onClose, noteId, accessRole, visibility, onVisibilityChanged }: VisibilityModalProps) {
  const [currentVisibility, setCurrentVisibility] = useState<NoteVisibility>(visibility);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canEdit = accessRole === "OWNER" || accessRole === "SUPER";

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function fetchLatestVisibility() {
      setLoading(true);
      setErrorMessage(null);

      try {
        const note = await apiFetch<{ visibility: NoteVisibility }>(`notes/${noteId}`, { method: "GET" });
        if (cancelled) return;
        setCurrentVisibility(note.visibility);
        onVisibilityChanged?.(note.visibility);
      } catch (err: any) {
        if (cancelled) return;
        setErrorMessage(err.message || "Failed to fetch visibility.");
        setCurrentVisibility(visibility);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLatestVisibility();

    return () => {
      cancelled = true;
    };
  }, [open, noteId]);

  async function handleChangeVisibility(value: NoteVisibility) {
    if (!canEdit || value === currentVisibility) return;

    setSaving(true);
    setErrorMessage(null);

    try {
      await apiFetch(`notes/${noteId}/visibility?visibility=${value}`, { method: "PUT" });
      setCurrentVisibility(value);
      onVisibilityChanged?.(value);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to update visibility.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <Modal title="Visibility" eyebrow="Sharing" onClose={saving ? () => undefined : onClose} widthClass="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm leading-6 text-slate-500">Control whether this note is public or private. The latest visibility is fetched every time this modal opens.</p>
        <ErrorBanner message={errorMessage} />

        {loading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-600">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-100 border-t-emerald-600" />
            Fetching latest visibility...
          </div>
        ) : (
          <div className="space-y-3">
            <VisibilityChoice
              icon={<Lock size={20} />}
              title="Private"
              description="Only invited collaborators can access this note."
              active={currentVisibility === "PRIVATE"}
              disabled={!canEdit || saving}
              onClick={() => handleChangeVisibility("PRIVATE")}
            />
            <VisibilityChoice
              icon={<Globe2 size={20} />}
              title="Public"
              description="Users may access this note depending on your app’s public note rules."
              active={currentVisibility === "PUBLIC"}
              disabled={!canEdit || saving}
              onClick={() => handleChangeVisibility("PUBLIC")}
            />
          </div>
        )}

        {!canEdit && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold leading-6 text-amber-800">
            You do not have permission to change this note’s visibility.
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

function VisibilityChoice({ icon, title, description, active, disabled, onClick }: { icon: ReactNode; title: string; description: string; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-emerald-500 bg-emerald-50 ring-4 ring-emerald-100" : "border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40"}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 ring-1 ring-slate-200">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-3">
          <span className="font-black text-slate-950">{title}</span>
          {active && <Badge tone="emerald">Current</Badge>}
        </span>
        <span className="mt-1 block text-sm leading-6 text-slate-500">{description}</span>
      </span>
    </button>
  );
}
