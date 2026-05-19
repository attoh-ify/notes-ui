"use client";

import { apiFetch } from "@/src/lib/api";
import { NoteAccessRole, NoteVisibility } from "@/src/types";
import { useEffect, useState } from "react";

interface VisibilityModalProps {
  open: boolean;
  onClose: () => void;
  noteId: string;
  accessRole: NoteAccessRole;
  visibility: NoteVisibility;
  onVisibilityChanged?: (visibility: NoteVisibility) => void;
}

export default function VisibilityModal({
  open,
  onClose,
  noteId,
  accessRole,
  visibility,
  onVisibilityChanged,
}: VisibilityModalProps) {
  const [currentVisibility, setCurrentVisibility] =
    useState<NoteVisibility>("PRIVATE");

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const canEdit = accessRole === "OWNER" || accessRole === "SUPER";

  useEffect(() => {
    if (!open) return;

    async function fetchLatestVisibility() {
      setLoading(true);

      try {
        const note = await apiFetch<{ visibility: NoteVisibility }>(
          `notes/${noteId}`,
          { method: "GET" },
        );

        setCurrentVisibility(note.visibility);
        onVisibilityChanged?.(note.visibility);
      } catch (err: any) {
        alert(err.message || "Failed to fetch visibility");
        setCurrentVisibility(visibility);
      } finally {
        setLoading(false);
      }
    }

    fetchLatestVisibility();
  }, [open, noteId, visibility, onVisibilityChanged]);

  async function handleChangeVisibility(value: NoteVisibility) {
    if (!canEdit || value === currentVisibility) return;

    setSaving(true);

    try {
      await apiFetch(`notes/${noteId}/visibility?visibility=${value}`, {
        method: "PUT",
      });

      setCurrentVisibility(value);
      onVisibilityChanged?.(value);
    } catch (err: any) {
      alert(err.message || "Failed to update visibility");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ width: 480 }}>
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0 }}>Visibility</h2>
            <p
              style={{
                margin: "4px 0 0",
                color: "#6B7280",
                fontSize: 13,
              }}
            >
              Control whether this note is public or private.
            </p>
          </div>

          <button onClick={onClose} className="icon-btn">
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ paddingTop: 14 }}>
          {loading ? (
            <p style={{ margin: 0, color: "#6B7280" }}>
              Fetching latest visibility...
            </p>
          ) : (
            <>
              <button
                onClick={() => handleChangeVisibility("PRIVATE")}
                disabled={!canEdit || saving}
                style={{
                  width: "100%",
                  border:
                    currentVisibility === "PRIVATE"
                      ? "2px solid #111827"
                      : "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: "14px 16px",
                  background:
                    currentVisibility === "PRIVATE" ? "#F9FAFB" : "white",
                  cursor: canEdit && !saving ? "pointer" : "not-allowed",
                  textAlign: "left",
                  opacity: canEdit ? 1 : 0.6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#111827" }}>
                      Private
                    </div>

                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 13,
                        color: "#6B7280",
                        lineHeight: 1.4,
                      }}
                    >
                      Only invited collaborators can access this note.
                    </div>
                  </div>

                  {currentVisibility === "PRIVATE" && (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "white",
                        background: "#111827",
                        borderRadius: 999,
                        padding: "4px 8px",
                      }}
                    >
                      Current
                    </span>
                  )}
                </div>
              </button>

              <button
                onClick={() => handleChangeVisibility("PUBLIC")}
                disabled={!canEdit || saving}
                style={{
                  width: "100%",
                  border:
                    currentVisibility === "PUBLIC"
                      ? "2px solid #111827"
                      : "1px solid #E5E7EB",
                  borderRadius: 12,
                  padding: "14px 16px",
                  background:
                    currentVisibility === "PUBLIC" ? "#F9FAFB" : "white",
                  cursor: canEdit && !saving ? "pointer" : "not-allowed",
                  textAlign: "left",
                  opacity: canEdit ? 1 : 0.6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#111827" }}>
                      Public
                    </div>

                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 13,
                        color: "#6B7280",
                        lineHeight: 1.4,
                      }}
                    >
                      Users may access this note depending on your app’s public
                      note rules.
                    </div>
                  </div>

                  {currentVisibility === "PUBLIC" && (
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "white",
                        background: "#111827",
                        borderRadius: 999,
                        padding: "4px 8px",
                      }}
                    >
                      Current
                    </span>
                  )}
                </div>
              </button>

              {!canEdit && (
                <p
                  style={{
                    margin: 0,
                    color: "#92400E",
                    background: "#FEF3C7",
                    border: "1px solid #FCD34D",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontSize: 13,
                  }}
                >
                  You do not have permission to change this note’s visibility.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}