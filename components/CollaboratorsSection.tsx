"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/src/lib/api";
import { NoteAccess, NoteAccessRole } from "@/src/types";

interface Props {
  open: boolean;
  onClose: () => void;
  noteId: string;
  email: string;
  accessRole: NoteAccessRole;
}

const roleStyles: Record<NoteAccessRole, React.CSSProperties> = {
  OWNER: { background: "#7C3AED", color: "white" },
  SUPER: { background: "#2563EB", color: "white" },
  EDITOR: { background: "#059669", color: "white" },
  VIEWER: { background: "#6B7280", color: "white" },
  RESTRICTED: { background: "#f50b0bff", color: "white" },
};

export default function CollaboratorsModal({
  open,
  onClose,
  noteId,
  email,
  accessRole,
}: Props) {
  const [noteAccesses, setNoteAccesses] = useState<NoteAccess[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<NoteAccessRole>("VIEWER");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;

    async function fetchAccesses() {
      try {
        const data = await apiFetch<NoteAccess[]>(
          `notes/${noteId}/access`,
          { method: "GET" }
        );
        setNoteAccesses(data);
      } catch {
        console.log("Failed to fetch note accesses");
      }
    }

    fetchAccesses();
  }, [open, noteId]);

  async function handleAdd() {
    if (!newEmail.trim()) return;

    setLoading(true);
    try {
      const data = await apiFetch<NoteAccess>(`notes/${noteId}/access`, {
        method: "POST",
        body: JSON.stringify({ email: newEmail, role: newRole }),
      });

      setNoteAccesses((prev) => [...prev, data]);
      setNewEmail("");
      setNewRole("VIEWER");
    } finally {
      setLoading(false);
    }
  }

  async function updateRole(access: NoteAccess, role: NoteAccessRole) {
    const updated = await apiFetch<NoteAccess>(
      `notes/${noteId}/access/${access.id}`,
      {
        method: "PUT",
        body: JSON.stringify({ email: access.email, role }),
      }
    );

    setNoteAccesses((prev) =>
      prev.map((a) => (a.id === access.id ? updated : a))
    );
  }

  async function removeAccess(id: string) {
    await apiFetch(`notes/${noteId}/access/${id}`, { method: "DELETE" });
    setNoteAccesses((prev) => prev.filter((a) => a.id !== id));
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 520 }}>

        {/* Header */}
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>Collaborators</h2>
          <button onClick={onClose} className="icon-btn">✕</button>
        </div>

        {/* List */}
        <div className="modal-body" style={{ paddingTop: 10 }}>
          {noteAccesses.map((access) => (
            <div
              key={access.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 12px",
                border: "1px solid #eee",
                borderRadius: 10,
                marginBottom: 10,
                background: "#fafafa",
              }}
            >
              {/* Left */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ fontWeight: 600, color: "#111827" }}>
                  {access.email}
                  {access.email === email && (
                    <span style={{ marginLeft: 6, fontSize: 12, color: "#9CA3AF" }}>
                      (You)
                    </span>
                  )}
                </span>

                <span
                  style={{
                    marginTop: 4,
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 12,
                    width: "fit-content",
                    ...roleStyles[access.role],
                  }}
                >
                  {access.role}
                </span>
              </div>

              {/* Right actions */}
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {access.email !== email &&
                (accessRole === "OWNER" || accessRole === "SUPER") ? (
                  <>
                    <select
                      value={access.role}
                      onChange={(e) =>
                        updateRole(access, e.target.value as NoteAccessRole)
                      }
                      style={{
                        padding: "4px 6px",
                        borderRadius: 6,
                        border: "1px solid #ddd",
                      }}
                    >
                      <option value="SUPER">Super</option>
                      <option value="EDITOR">Editor</option>
                      <option value="VIEWER">Viewer</option>
                    </select>

                    <button
                      onClick={() => removeAccess(access.id)}
                      style={{
                        color: "#DC2626",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      Remove
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {/* Invite */}
        {(accessRole === "OWNER" || accessRole === "SUPER") && (
          <div
            style={{
              display: "flex",
              gap: 8,
              paddingTop: 12,
              borderTop: "1px solid #eee",
            }}
          >
            <input
              placeholder="Invite email..."
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              style={{
                flex: 1,
                padding: 10,
                borderRadius: 8,
                border: "1px solid #ddd",
              }}
            />

            <select
              value={newRole}
              onChange={(e) =>
                setNewRole(e.target.value as NoteAccessRole)
              }
              style={{
                padding: 10,
                borderRadius: 8,
                border: "1px solid #ddd",
              }}
            >
              <option value="VIEWER">Viewer</option>
              <option value="EDITOR">Editor</option>
              <option value="SUPER">Super</option>
            </select>

            <button
              onClick={handleAdd}
              disabled={loading}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "#111827",
                color: "white",
                border: "none",
                cursor: "pointer",
              }}
            >
              Invite
            </button>
          </div>
        )}
      </div>
    </div>
  );
}