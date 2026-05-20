"use client";

import { Badge, Button, EmptyState, ErrorBanner, Input, Modal, Select } from "@/components/ui";
import { apiFetch } from "@/src/lib/api";
import { NoteAccess, NoteAccessRole } from "@/src/types";
import { Users } from "lucide-react";
import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  noteId: string;
  email: string;
  accessRole: NoteAccessRole;
}

const roleTone: Record<NoteAccessRole, "emerald" | "blue" | "purple" | "red" | "slate"> = {
  OWNER: "purple",
  SUPER: "blue",
  EDITOR: "emerald",
  VIEWER: "slate",
  RESTRICTED: "red",
};

export default function CollaboratorsModal({ open, onClose, noteId, email, accessRole }: Props) {
  const [noteAccesses, setNoteAccesses] = useState<NoteAccess[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<NoteAccessRole>("VIEWER");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canManage = accessRole === "OWNER" || accessRole === "SUPER";

  useEffect(() => {
    if (!open) return;

    async function fetchAccesses() {
      try {
        setErrorMessage(null);
        const data = await apiFetch<NoteAccess[]>(`notes/${noteId}/access`, { method: "GET" });
        setNoteAccesses(data);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to fetch collaborators.");
      }
    }

    fetchAccesses();
  }, [open, noteId]);

  async function handleAdd() {
    if (!newEmail.trim()) return;

    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await apiFetch<NoteAccess>(`notes/${noteId}/access`, {
        method: "POST",
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });

      setNoteAccesses((prev) => [...prev, data]);
      setNewEmail("");
      setNewRole("VIEWER");
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to invite collaborator.");
    } finally {
      setLoading(false);
    }
  }

  async function updateRole(access: NoteAccess, role: NoteAccessRole) {
    setErrorMessage(null);
    try {
      const updated = await apiFetch<NoteAccess>(`notes/${noteId}/access/${access.id}`, {
        method: "PUT",
        body: JSON.stringify({ email: access.email, role }),
      });

      setNoteAccesses((prev) => prev.map((a) => (a.id === access.id ? updated : a)));
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to update role.");
    }
  }

  async function removeAccess(id: string) {
    setErrorMessage(null);
    try {
      await apiFetch(`notes/${noteId}/access/${id}`, { method: "DELETE" });
      setNoteAccesses((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to remove collaborator.");
    }
  }

  if (!open) return null;

  return (
    <Modal title="Collaborators" eyebrow="Access control" onClose={onClose} widthClass="max-w-2xl">
      <div className="space-y-4">
        <ErrorBanner message={errorMessage} />

        {noteAccesses.length === 0 ? (
          <EmptyState icon={<Users />} title="No collaborators yet" message="People with access to this note will appear here." />
        ) : (
          <div className="space-y-3">
            {noteAccesses.map((access) => {
              const isYou = access.email === email;
              const editable = !isYou && canManage;

              return (
                <div key={access.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-slate-950">
                      {access.email} {isYou && <span className="font-semibold text-slate-400">(You)</span>}
                    </p>
                    <div className="mt-2"><Badge tone={roleTone[access.role]}>{access.role}</Badge></div>
                  </div>

                  {editable && (
                    <div className="flex flex-wrap gap-2">
                      <Select value={access.role} onChange={(e) => updateRole(access, e.target.value as NoteAccessRole)}>
                        <option value="SUPER">Super</option>
                        <option value="EDITOR">Editor</option>
                        <option value="VIEWER">Viewer</option>
                      </Select>
                      <Button variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => removeAccess(access.id)}>
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canManage && (
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-sm font-black text-slate-950">Invite someone</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <Input placeholder="Invite email..." value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              <Select value={newRole} onChange={(e) => setNewRole(e.target.value as NoteAccessRole)}>
                <option value="VIEWER">Viewer</option>
                <option value="EDITOR">Editor</option>
                <option value="SUPER">Super</option>
              </Select>
              <Button onClick={handleAdd} disabled={loading || !newEmail.trim()}>{loading ? "Inviting..." : "Invite"}</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
