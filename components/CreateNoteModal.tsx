"use client";

import { apiFetch } from "@/src/lib/api";
import { Note } from "@/src/types";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface CreateNoteModalProps {
  open: boolean;
  email: string;
  userId: string;
  onClose: () => void;
}

export default function CreateNoteModal({
  open,
  email,
  userId,
  onClose,
}: CreateNoteModalProps) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function onCreate() {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      if (!userId || !email) {
        throw new Error("User not authenticated");
      }

      const data = await apiFetch<Note>("notes", {
        method: "POST",
        body: JSON.stringify({ title }),
      });

      router.push(
        `/notes/${data.id}/edit?email=${encodeURIComponent(email)}&userId=${encodeURIComponent(userId)}`
      );

      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create Note.");
    } finally {
      setIsLoading(false);
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
          }}
        >
          <p style={{ fontSize: 13, color: "#718096" }}>
            Create new note
          </p>

          <button
            onClick={onClose}
            disabled={isLoading}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 18,
              color: "#4A5568",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.6 : 1,
              pointerEvents: isLoading ? "none" : "auto",
            }}
          >
            ✕
          </button>
        </div>

        <input
          value={title}
          placeholder="Title..."
          className="input-field"
          onChange={(e) => setTitle(e.target.value)}
          disabled={isLoading}
        />

        {error && (
          <p style={{ color: "red", fontSize: 12 }}>
            {error}
          </p>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onCreate}
            disabled={isLoading || !title.trim()}
            className="btn-primary"
            style={{
              opacity: isLoading ? 0.7 : 1,
              cursor:
                isLoading || !title.trim()
                  ? "not-allowed"
                  : "pointer",
              pointerEvents:
                isLoading || !title.trim()
                  ? "none"
                  : "auto",
            }}
          >
            {isLoading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}