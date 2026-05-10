"use client";

import { apiFetch } from "@/src/lib/api";
import { NoteAccessRole, NoteVisibility } from "@/src/types";
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
  const [currentVisibility, setCurrentVisibility] =
    useState<NoteVisibility>("PRIVATE");

  async function handleChangeVisibility(value: NoteVisibility) {
    try {
      await apiFetch(
        `notes/${noteId}/visibility?visibility=${value}`,
        { method: "PUT" }
      );

      setCurrentVisibility(value);
    } catch (err: any) {
      alert(err.message || "Failed to update visibility");
    }
  }

  useEffect(() => {
    setCurrentVisibility(visibility);
  }, [visibility]);

  const canEdit =
    accessRole === "OWNER" || accessRole === "SUPER";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        border: "1px solid #E5E7EB",
        borderRadius: 999,
        padding: 3,
        background: "white",
        gap: 4,
        marginTop: 8,
      }}
    >
      <span
        style={{
          fontSize: "0.72rem",
          fontWeight: 700,
          color: "#111827",
          padding: "0 6px",
          whiteSpace: "nowrap",
        }}
      >
        Visibility:
      </span>

      <button
        onClick={() => handleChangeVisibility("PRIVATE")}
        disabled={!canEdit}
        style={{
          border: "none",
          borderRadius: 999,
          padding: "4px 10px",
          fontSize: "0.72rem",
          fontWeight: 600,
          cursor: canEdit ? "pointer" : "not-allowed",
          background:
            currentVisibility === "PRIVATE"
              ? "#111827"
              : "transparent",
          color:
            currentVisibility === "PRIVATE"
              ? "white"
              : "#6B7280",
        }}
      >
        Private
      </button>

      <button
        onClick={() => handleChangeVisibility("PUBLIC")}
        disabled={!canEdit}
        style={{
          border: "none",
          borderRadius: 999,
          padding: "4px 10px",
          fontSize: "0.72rem",
          fontWeight: 600,
          cursor: canEdit ? "pointer" : "not-allowed",
          background:
            currentVisibility === "PUBLIC"
              ? "#111827"
              : "transparent",
          color:
            currentVisibility === "PUBLIC"
              ? "white"
              : "#6B7280",
        }}
      >
        Public
      </button>
    </div>
  );
}