"use client";

import {
  Note,
  NoteAccess,
  NoteAccessRole,
  NoteVisibility,
} from "@/app/notes/page";
import { useAuth } from "@/src/context/AuthContext";
import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { NoteVersion } from "../../page";
import DeleteNoteModal from "@/components/DeleteNoteModal";

function NoteSettingsContent() {
  const { id: noteId } = useParams();
  const router = useRouter();
  const { user, loadingUser } = useAuth();
  const [note, setNote] = useState<Note | null>(null);
  const [noteVersions, setNoteVersions] = useState<NoteVersion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noteAccesses, setNoteAccesses] = useState<NoteAccess[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<NoteAccessRole>("VIEWER");
  const [currentVisibility, setCurrentVisibility] = useState<NoteVisibility>();
  const [showDeleteNoteModal, setShowDeleteNoteModal] = useState(false);

  useEffect(() => {
    async function fetchNotes() {
      try {
        const noteData = await apiFetch<Note>(`notes/${noteId}`, {
          method: "GET",
        });
        setNote(noteData);
        setCurrentVisibility(noteData.visibility);
        const noteVersionsData = await apiFetch<NoteVersion[]>(
          `notes/${noteId}/versions`,
          {
            method: "GET",
          },
        );
        setNoteVersions(noteVersionsData);
        const noteAccessData = await apiFetch<NoteAccess[]>(
          `notes/${noteId}/access`,
          {
            method: "GET",
          },
        );
        setNoteAccesses(noteAccessData);
      } catch (err: any) {
        setError(err.message || "Failed to fetch note metadata");
      } finally {
        setLoading(false);
      }
    }
    fetchNotes();
  }, [user]);

  async function handleDeleteNote() {
    try {
      await apiFetch(`notes/${noteId}`, {
        method: "DELETE",
      });
      setShowDeleteNoteModal(false);
      router.push("/notes");
    } catch (err: any) {
      throw err.message || "Failed to delete note";
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
      setNoteAccesses((prev) =>
        prev.map((access) =>
          access.id === noteAccess.id ? { ...access, role: data.role } : access,
        ),
      );
    } catch (err: any) {
      alert(err.message || "Failed to change access role for user");
    }
  }

  async function handleDeleteNoteAccess(noteAccessId: string) {
    try {
      await apiFetch<NoteAccess>(`notes/${noteId}/access/${noteAccessId}`, {
        method: "DELETE",
      });
      setNoteAccesses((prev) =>
        prev.filter((access) => access.id !== noteAccessId),
      );
    } catch (err: any) {
      alert(err.message || "Failed to change access role for user");
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
      setNoteAccesses((prev) => [...prev, data]);
    } catch (err: any) {
      alert(err.message || "Failed to add note access");
    }
  }

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

  async function handleCreateNewVersion() {}

  if (loadingUser)
    return <div className="container-wide">Checking session...</div>;

  if (!user) {
    router.push("login");
    return null;
  }

  if (loading) return <div className="container-wide">Loading note...</div>;
  if (error)
    return (
      <div className="container-wide" style={{ color: "red" }}>
        {error}
      </div>
    );
  if (!note) return <div className="container-wide">Note not found.</div>;
  if (!noteVersions)
    return <div className="container-wide">Note versions not found.</div>;

  return (
    <Suspense fallback={<div>Note Settings...</div>}>
      <main
        className="container-center"
        style={{ padding: "40px 20px", maxWidth: "800px", margin: "0 auto" }}
      >
        <header
          style={{
            marginBottom: "32px",
            borderBottom: "1px solid #E2E8F0",
            paddingBottom: "16px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontWeight: "700",
              fontSize: "1.8rem",
              color: "#1A202C",
            }}
          >
            "{note.title}" Settings
          </h1>
          <p style={{ margin: "8px 0 0", fontSize: "1rem", color: "#718096" }}>
            Manage versions, collaborations, and privacy.
          </p>
        </header>

        <section style={{ marginBottom: "40px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <h3
              style={{
                fontSize: "1.2rem",
                fontWeight: "600",
                color: "#2D3748",
                margin: 0,
              }}
            >
              Revision History
            </h3>
            <button
              onClick={handleCreateNewVersion}
              style={{
                padding: "8px 16px",
                backgroundColor: "#3182CE",
                color: "white",
                border: "none",
                borderRadius: "6px",
                fontSize: "0.85rem",
                fontWeight: "600",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "#2B6CB0")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "#3182CE")
              }
            >
              + Save New Version
            </button>
          </div>
          <div
            style={{
              backgroundColor: "#F7FAFC",
              borderRadius: 12,
              border: "1px solid #E2E8F0",
              overflow: "hidden",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
              }}
            >
              <thead
                style={{
                  backgroundColor: "#EDF2F7",
                  fontSize: "0.85rem",
                  color: "#4A5568",
                }}
              >
                <tr>
                  <th style={{ padding: "12px 16px" }}>v#</th>
                  <th style={{ padding: "12px 16px" }}>Details</th>
                  <th style={{ padding: "12px 16px" }}>Created At</th>
                  <th style={{ padding: "12px 16px" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {noteVersions
                  .filter((v) => v.versionNumber > 0)
                  .map((v: NoteVersion) => (
                    <tr
                      key={v.id}
                      onClick={() =>
                        (window.location.href = `/notes/${noteId}/history/${v.id}`)
                      }
                      style={{
                        borderBottom: "1px solid #E2E8F0",
                        fontSize: "0.95rem",
                        cursor: "pointer",
                        transition: "background 0.2s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = "#EDF2F7")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = "transparent")
                      }
                    >
                      <td
                        style={{
                          padding: "12px 16px",
                          fontWeight: "600",
                          color: "#4A5568",
                        }}
                      >
                        {v.versionNumber}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div style={{ color: "#2D3748", fontWeight: "500" }}>
                          {v.comment || "No description"}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#718096" }}>
                          Revision: {v.revision}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          color: "#718096",
                          fontSize: "0.85rem",
                        }}
                      >
                        {new Date(v.createdAt).toLocaleString()}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <button
                          style={{
                            color: "#3182CE",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: "600",
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                {noteVersions.length < 2 && (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        padding: "24px",
                        textAlign: "center",
                        color: "#A0AEC0",
                      }}
                    >
                      No previous versions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div
              style={{
                padding: "12px",
                borderTop: "1px solid #E2E8F0",
                textAlign: "center",
                backgroundColor: "#EDF2F7",
              }}
            >
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "#718096",
                  margin: "0 0 8px 0",
                }}
              >
                Manually creating a version saves a permanent snapshot of the
                current state.
              </p>
            </div>
          </div>
        </section>

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
              {noteAccesses.map((access) => (
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
                    {access.email !== user.email &&
                    (note.accessRole === "OWNER" || note.accessRole === "SUPER") ? (
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
                            padding: "6px 10px",
                            borderRadius: 6,
                            border: "1px solid #CBD5E0",
                          }}
                        >
                          <option value="SUPER">Super</option>
                          <option value="EDITOR">Editor</option>
                          <option value="VIEWER">Viewer</option>
                        </select>
                        <button
                          onClick={() => handleDeleteNoteAccess(access.id)}
                          style={{
                            color: "#E53E3E",
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "0.9rem",
                          }}
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <span style={{ color: "#A0AEC0", fontSize: "0.9rem" }}>
                        {access.role}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {(note.accessRole === "OWNER" || note.accessRole === "SUPER") && (
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
                  }}
                />
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as NoteAccessRole)}
                  style={{
                    padding: "10px",
                    borderRadius: 8,
                    border: "1px solid #CBD5E0",
                  }}
                >
                  <option value="VIEWER">Viewer</option>
                  <option value="EDITOR">Editor</option>
                  <option value="SUPER">Super</option>
                </select>
                <button
                  onClick={handleAddAccess}
                  style={{
                    padding: "10px 20px",
                    borderRadius: 8,
                    backgroundColor: "#2F855A",
                    color: "white",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: "600",
                  }}
                >
                  Add
                </button>
              </div>
            )}
          </div>
        </section>

        <section style={{ marginBottom: "40px" }}>
          <h3
            style={{
              fontSize: "1.2rem",
              fontWeight: "600",
              marginBottom: "16px",
              color: "#2D3748",
            }}
          >
            Privacy & Visibility
          </h3>
          <div
            style={{
              backgroundColor: "#F7FAFC",
              borderRadius: 12,
              padding: "20px",
              border: "1px solid #E2E8F0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: "500", color: "#2D3748" }}>
                Note Visibility
              </p>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: "0.85rem",
                  color: "#718096",
                }}
              >
                Control who can find this note via search or link.
              </p>
            </div>
            {note.accessRole === "OWNER" || note.accessRole === "SUPER" ? (
              <select
                defaultValue={currentVisibility}
                onChange={(e) =>
                  handleChangeVisibility(e.target.value as NoteVisibility)
                }
                style={{
                  padding: "10px",
                  borderRadius: 8,
                  border: "1px solid #CBD5E0",
                  minWidth: "120px",
                }}
              >
                <option value="PRIVATE">Private</option>
                <option value="PUBLIC">Public</option>
              </select>
            ) : (
              <span style={{ fontWeight: "600", color: "#4A5568" }}>
                {currentVisibility}
              </span>
            )}
          </div>
        </section>

        {note.accessRole === "OWNER" && (
          <section
            style={{
              marginTop: "60px",
              paddingTop: "30px",
              borderTop: "2px solid #FED7D7",
            }}
          >
            <h3
              style={{
                fontSize: "1.2rem",
                fontWeight: "600",
                marginBottom: "16px",
                color: "#C53030",
              }}
            >
              Danger Zone
            </h3>
            <div
              style={{
                border: "1px solid #FEB2B2",
                borderRadius: 12,
                padding: "20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "#FFF5F5",
              }}
            >
              <div>
                <p style={{ margin: 0, fontWeight: "600", color: "#2D3748" }}>
                  Delete this note
                </p>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: "0.85rem",
                    color: "#718096",
                  }}
                >
                  Once deleted, it cannot be recovered. All history will be
                  lost.
                </p>
              </div>
              <button
                onClick={() => setShowDeleteNoteModal(true)}
                className="btn-delete"
                style={{
                  padding: "10px 24px",
                  backgroundColor: "#E53E3E",
                  color: "white",
                  borderRadius: 8,
                  border: "none",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Delete Permanently
              </button>
            </div>
          </section>
        )}

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
    <Suspense fallback={<p>Loading notes settings page...</p>}>
      <NoteSettingsContent />
    </Suspense>
  );
}
