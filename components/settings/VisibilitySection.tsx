"use client";

import { apiFetch } from "@/src/lib/api";
import { NoteAccess, NoteAccessRole, NoteVisibility } from "@/src/types";
import { useEffect, useState } from "react";

interface VisibilitySectionProps {
  noteId: string;
  accessRole: NoteAccessRole;
  visibility: NoteVisibility;
}

export default function VisibilitySection({
  noteId,
  accessRole,
  visibility,
}: VisibilitySectionProps) {
  const [currentVisibility, setCurrentVisibility] = useState<NoteVisibility>();

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

  useEffect(() => {
    if (visibility) {
      setCurrentVisibility(visibility);
    }
  }, [visibility]);

  if (!visibility)
    return <div className="container-wide">Note visibility not found.</div>;

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
        {accessRole === "OWNER" || accessRole === "SUPER" ? (
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
  );
}
