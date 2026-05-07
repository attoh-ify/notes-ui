"use client";

import { useState } from "react";

interface DeleteNoteModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onDelete: () => Promise<void>;
}

export default function DeleteNoteModal({
  open,
  title,
  onClose,
  onDelete,
}: DeleteNoteModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!open) return null;

  async function handleDelete() {
    if (isDeleting) return;

    setIsDeleting(true);

    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
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
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "#718096",
              }}
            >
              Delete Note
            </p>
          </div>

          <button
            onClick={onClose}
            disabled={isDeleting}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 18,
              color: "#4A5568",
              cursor: isDeleting ? "not-allowed" : "pointer",
              opacity: isDeleting ? 0.6 : 1,
              pointerEvents: isDeleting ? "none" : "auto",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ color: "black" }}>
          Are you sure you want to delete{" "}
          <p
            style={{
              color: "var(--text-muted)",
              textDecoration: "underline",
            }}
          >
            {title}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "1rem",
          }}
        >
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="btn-delete"
            style={{
              opacity: isDeleting ? 0.7 : 1,
              cursor: isDeleting ? "not-allowed" : "pointer",
              pointerEvents: isDeleting ? "none" : "auto",
            }}
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>

          <button
            onClick={onClose}
            disabled={isDeleting}
            className="btn-secondary"
            style={{
              opacity: isDeleting ? 0.7 : 1,
              cursor: isDeleting ? "not-allowed" : "pointer",
              pointerEvents: isDeleting ? "none" : "auto",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}