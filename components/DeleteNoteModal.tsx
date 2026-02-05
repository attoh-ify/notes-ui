"use client";

import { apiFetch } from "@/src/lib/api";

interface DeleteNoteModalProps {
  open: boolean;
  noteId: string;
  title: string;
  onClose: () => void;
  onDelete: () => void;
}

export default function DeleteNoteModal({
  open,
  noteId,
  title,
  onClose,
  onDelete,
}: DeleteNoteModalProps) {

  if (!open) return null;

  async function handleDeleteNote(noteId: string) {
    try {
      await apiFetch(`notes/${noteId}`, {
        method: "DELETE"
      })
      onClose();
      onDelete();
    } catch (err: any) {
      throw(err.message || "Failed to delete note")
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

        <div
          style={{ }}
        >
          Are you sure you want to delete <p style={{}}>{title}</p>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "1rem"
          }}
        >
          <button onClick={() => handleDeleteNote(noteId)} className="btn-delete">delete</button>
          <button onClick={onClose} className="btn-secondary">cancel</button>
        </div>
      </div>
    </div>
  );
}
