"use client";

import { NoteAccessRole, NoteVisibility } from "@/app/notes/page";
import { apiFetch } from "@/src/lib/api";
import { useState } from "react";

export interface NoteAccess {
  id: string;
  email: string;
  role: NoteAccessRole;
}

interface NoteAccessModalProps {
  open: boolean;
  onClose: () => void;

  noteId: string;
  role: NoteAccessRole;
  noteTitle: string;
  visibility: NoteVisibility;

  accesses: NoteAccess[];
}

export default function NoteAccessModal({
  open,
  onClose,
  noteId,
  role,
  noteTitle,
  visibility,
  accesses,
}: NoteAccessModalProps) {
  const [noteAccesses, setNotesAccesses] = useState<NoteAccess[]>(accesses);
  const [newEmail, setNewEmail] = useState("");
  const [currentVisibility, setCurrentVisibility] =
    useState<NoteVisibility>(visibility);
  const [newRole, setNewRole] = useState<NoteAccessRole>("VIEWER");

  if (!open) return null;

  async function handleChangeVisibility(visibility: NoteVisibility) {
    try {
      apiFetch(`notes/${noteId}/visibility?visibility=${visibility}`, {
        method: "PUT",
      });
      setCurrentVisibility(visibility);
    } catch (err: any) {
      alert(err.message || "Failed to change note visibility");
    }
  }

  async function handleAddAccess() {
    try {
      const data = await apiFetch<NoteAccess>(`notes/${noteId}/access`, {
        method: "POST",
        body: JSON.stringify({
          email: newEmail,
          role: newRole,
        }),
      });

      setNewEmail("");
      setNewRole("VIEWER");
      setNotesAccesses((prev) => [...prev, data]);
    } catch (err: any) {
      alert(err.message || "Failed to add note access");
    }
  }

  async function handleDeleteNoteAccess(noteAccessId: string) {
    try {
      await apiFetch<NoteAccess>(`notes/${noteId}/access/${noteAccessId}`, {
        method: "DELETE",
      });
      setNotesAccesses((prev) =>
        prev.filter((access) => access.id !== noteAccessId),
      );
    } catch (err: any) {
      alert(err.message || "Failed to change access role for user");
    }
  }

  async function handleChangeAccessRole(
    noteAccess: NoteAccess,
    role: NoteAccessRole,
  ) {
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
      setNotesAccesses((prev) =>
        prev.map((access) =>
          access.id === noteAccess.id ? { ...access, role: data.role } : access,
        ),
      );
    } catch (err: any) {
      alert(err.message || "Failed to change access role for user");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: "#fff",
          width: 460,
          maxHeight: "85vh",
          borderRadius: 12,
          padding: 20,
          boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h2 style={{ margin: 0 }}>{noteTitle}</h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#718096",
              }}
            >
              Sharing & access control
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 18,
              cursor: "pointer",
              color: "#4A5568",
            }}
          >
            ✕
          </button>
        </div>

        {/* Visibility */}
        <section
          style={{
            backgroundColor: "#F7FAFC",
            borderRadius: 8,
            padding: 14,
            color: "black",
          }}
        >
          <h4
            style={{
              margin: "0 0 10px",
              fontSize: 14,
              fontWeight: 600,
              color: "#2D3748",
            }}
          >
            Visibility
          </h4>

          {(role === "OWNER" || role === "SUPER") ? 
            <select
            defaultValue={currentVisibility}
            onChange={(e) =>
                handleChangeVisibility(e.target.value as NoteVisibility)
              }
              style={{
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #CBD5E0",
                backgroundColor: "#fff",
              }}
            >
              <option value="PRIVATE">Private</option>
              <option value="PUBLIC">Public</option>
            </select>
            : 
            <span 
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid #CBD5E0",
              backgroundColor: "#fff",
            }}>{currentVisibility}</span>}
        </section>

        {/* Users */}
        <section
          style={{
            backgroundColor: "#F7FAFC",
            borderRadius: 8,
            padding: 14,
          }}
        >
          <h4
            style={{
              margin: "0 0 10px",
              fontSize: 14,
              fontWeight: 600,
              color: "#2D3748",
            }}
          >
            People with access
          </h4>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {noteAccesses.map((access) => (
              <li
                key={access.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    color: "#2D3748",
                  }}
                >
                  {access.email}
                </span>

                {(role === "OWNER" || role === "SUPER") && (
                  <>
                    <select
                      defaultValue={access.role}
                      onChange={(e) =>
                        handleChangeAccessRole(
                          access,
                          e.target.value as NoteAccessRole,
                        )
                      }
                      style={{
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "1px solid #CBD5E0",
                        backgroundColor: "#fff",
                        color: "black",
                      }}
                    >
                      <option value="SUPER">Super</option>
                      <option value="EDITOR">Editor</option>
                      <option value="VIEWER">Viewer</option>
                    </select>

                    <button
                      onClick={() => handleDeleteNoteAccess(access.id)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 6,
                        border: "1px solid #CBD5E0",
                        backgroundColor: "#EDF2F7",
                        cursor: "pointer",
                        color: "red",
                      }}
                    >
                      delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Add access */}
        {(role === "OWNER" || role === "SUPER") && (
          <section
            style={{
              backgroundColor: "#F7FAFC",
              borderRadius: 8,
              padding: 14,
            }}
          >
            <h4
              style={{
                margin: "0 0 10px",
                fontSize: 14,
                fontWeight: 600,
                color: "#2D3748",
              }}
            >
              Add new user
            </h4>

            <div
              style={{
                display: "flex",
                gap: 8,
              }}
            >
              <input
                value={newEmail}
                placeholder="email@example.com"
                onChange={(e) => setNewEmail(e.target.value)}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #CBD5E0",
                  color: "black",
                }}
              />

              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as NoteAccessRole)}
                style={{
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px solid #CBD5E0",
                  backgroundColor: "#fff",
                  color: "black",
                }}
              >
                <option value="SUPER">Super</option>
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </select>

              <button
                onClick={handleAddAccess}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: "#2F855A",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Add
              </button>
            </div>
          </section>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #CBD5E0",
              backgroundColor: "#EDF2F7",
              cursor: "pointer",
              color: "red",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
