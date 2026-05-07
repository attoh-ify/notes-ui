"use client";

import { apiFetch } from "@/src/lib/api";
import { NoteAccess, NoteAccessRole } from "@/src/types";
import { useEffect, useState } from "react";

interface CollaboratorsSectionProps {
  noteId: string;
  email: string;
  accessRole: NoteAccessRole;
}

export default function CollaboratorsSection({
  noteId,
  email,
  accessRole,
}: CollaboratorsSectionProps) {
  const [noteAccesses, setNoteAccesses] = useState<NoteAccess[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<NoteAccessRole>("VIEWER");

  const [isAdding, setIsAdding] = useState(false);

  const [deletingIds, setDeletingIds] = useState<string[]>([]);

  const [updatingIds, setUpdatingIds] = useState<string[]>([]);

  useEffect(() => {
    async function initNoteAccesses() {
      try {
        const noteAccessData = await apiFetch<NoteAccess[]>(
          `notes/${noteId}/access`,
          {
            method: "GET",
          },
        );

        setNoteAccesses(noteAccessData);
      } catch (error) {
        console.log("Failed to fetch note access roles");
      }
    }

    initNoteAccesses();
  }, [noteId]);

  async function handleChangeAccessRole(
    noteAccess: NoteAccess,
    role: NoteAccessRole,
  ) {
    if (updatingIds.includes(noteAccess.id)) return;

    setUpdatingIds((prev) => [...prev, noteAccess.id]);

    try {
      const data = await apiFetch<NoteAccess>(
        `notes/${noteId}/access/${noteAccess.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            email: noteAccess.email,
            role,
          }),
        },
      );

      setNoteAccesses((prev) =>
        prev.map((access) =>
          access.id === noteAccess.id
            ? { ...access, role: data.role }
            : access,
        ),
      );
    } catch (err: any) {
      alert(err.message || "Failed to change access role");
    } finally {
      setUpdatingIds((prev) =>
        prev.filter((id) => id !== noteAccess.id),
      );
    }
  }

  async function handleDeleteNoteAccess(noteAccessId: string) {
    if (deletingIds.includes(noteAccessId)) return;

    setDeletingIds((prev) => [...prev, noteAccessId]);

    try {
      await apiFetch(`notes/${noteId}/access/${noteAccessId}`, {
        method: "DELETE",
      });

      setNoteAccesses((prev) =>
        prev.filter((access) => access.id !== noteAccessId),
      );
    } catch (err: any) {
      alert(err.message || "Failed to remove collaborator");
    } finally {
      setDeletingIds((prev) =>
        prev.filter((id) => id !== noteAccessId),
      );
    }
  }

  async function handleAddAccess() {
    if (isAdding) return;

    setIsAdding(true);

    try {
      const data = await apiFetch<NoteAccess>(
        `notes/${noteId}/access`,
        {
          method: "POST",
          body: JSON.stringify({
            email: newEmail,
            role: newRole,
          }),
        },
      );

      setNewEmail("");
      setNewRole("VIEWER");

      setNoteAccesses((prev) => [...prev, data]);
    } catch (err: any) {
      alert(err.message || "Failed to add note access");
    } finally {
      setIsAdding(false);
    }
  }

  if (!noteAccesses)
    return <div className="container-wide">Note accesses not found.</div>;

  return (
    <section style={{ marginBottom: "40px" }}>
      <h3
        style={{
          fontSize: "1.2rem",
          fontWeight: "600",
          marginBottom: "16px",
          color: "#2D3748",
        }}
      >
        Collaborators & Access
      </h3>

      <div
        style={{
          backgroundColor: "#F7FAFC",
          borderRadius: 12,
          padding: "20px",
          border: "1px solid #E2E8F0",
        }}
      >
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "0 0 20px 0",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          {noteAccesses.map((access) => {
            const isDeleting = deletingIds.includes(access.id);

            const isUpdating = updatingIds.includes(access.id);

            return (
              <li
                key={access.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  borderBottom: "1px solid #EDF2F7",
                }}
              >
                <span
                  style={{
                    fontSize: "1rem",
                    color: "#2D3748",
                    fontWeight: "500",
                  }}
                >
                  {access.email}
                </span>

                <div
                  style={{
                    display: "flex",
                    gap: "12px",
                    alignItems: "center",
                  }}
                >
                  {access.email !== email &&
                  (accessRole === "OWNER" ||
                    accessRole === "SUPER") ? (
                    <>
                      <select
                        value={access.role}
                        disabled={isUpdating}
                        onChange={(e) =>
                          handleChangeAccessRole(
                            access,
                            e.target.value as NoteAccessRole,
                          )
                        }
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          border: "1px solid #CBD5E0",
                          opacity: isUpdating ? 0.7 : 1,
                          cursor: isUpdating
                            ? "not-allowed"
                            : "pointer",
                          pointerEvents: isUpdating
                            ? "none"
                            : "auto",
                        }}
                      >
                        <option value="SUPER">Super</option>
                        <option value="EDITOR">Editor</option>
                        <option value="VIEWER">Viewer</option>
                      </select>

                      <button
                        onClick={() =>
                          handleDeleteNoteAccess(access.id)
                        }
                        disabled={isDeleting}
                        style={{
                          color: "#E53E3E",
                          background: "none",
                          border: "none",
                          fontSize: "0.9rem",
                          cursor: isDeleting
                            ? "not-allowed"
                            : "pointer",
                          opacity: isDeleting ? 0.6 : 1,
                          pointerEvents: isDeleting
                            ? "none"
                            : "auto",
                        }}
                      >
                        {isDeleting
                          ? "Removing..."
                          : "Remove"}
                      </button>
                    </>
                  ) : (
                    <span
                      style={{
                        color: "#A0AEC0",
                        fontSize: "0.9rem",
                      }}
                    >
                      {access.role}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {(accessRole === "OWNER" ||
          accessRole === "SUPER") && (
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: "20px",
              paddingTop: "20px",
              borderTop: "2px dashed #E2E8F0",
            }}
          >
            <input
              value={newEmail}
              placeholder="invite by email..."
              onChange={(e) => setNewEmail(e.target.value)}
              style={{
                flex: 1,
                padding: "10px",
                borderRadius: 8,
                border: "1px solid #CBD5E0",
                opacity: isAdding ? 0.7 : 1,
              }}
            />

            <select
              value={newRole}
              onChange={(e) =>
                setNewRole(
                  e.target.value as NoteAccessRole,
                )
              }
              style={{
                padding: "10px",
                borderRadius: 8,
                border: "1px solid #CBD5E0",
                opacity: isAdding ? 0.7 : 1,
                cursor: isAdding
                  ? "not-allowed"
                  : "pointer",
              }}
            >
              <option value="VIEWER">Viewer</option>
              <option value="EDITOR">Editor</option>
              <option value="SUPER">Super</option>
            </select>

            <button
              onClick={handleAddAccess}
              disabled={
                isAdding || !newEmail.trim()
              }
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                backgroundColor: "#2F855A",
                color: "white",
                border: "none",
                fontWeight: "600",
                cursor:
                  isAdding || !newEmail.trim()
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  isAdding || !newEmail.trim()
                    ? 0.7
                    : 1,
                pointerEvents:
                  isAdding || !newEmail.trim()
                    ? "none"
                    : "auto",
              }}
            >
              {isAdding ? "Adding..." : "Add"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}