"use client";

import { apiFetch } from "@/src/lib/api";
import { convertDocumentToDelta } from "@/src/lib/documentToDelta";
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
  const [file, setFile] = useState<File | null>(null);

  if (!open) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);

    const extractedName = selected.name.replace(/\.[^/.]+$/, "");

    if (!title.trim()) {
      setTitle(extractedName);
    }
  }

  async function onCreate() {
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      let initialDelta = null;
      
      if (file) {
        try {
          initialDelta = await convertDocumentToDelta(file);
        } catch (convError) {
          setError("Failed to convert document. Please check the file format.");
          setIsLoading(false);
          return;
        }
      }

      const payload = {
        title: title,
        initialDelta: initialDelta
      };

      const data = await apiFetch<Note>("notes", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json"
        }
      });

      router.push(`/notes/${data.id}/edit`);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create note.");
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

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
              }}
            >
              Note title
            </label>

            <input
              value={title}
              placeholder="Enter title..."
              className="input-field"
              onChange={(e) => setTitle(e.target.value)}
              disabled={isLoading}
              style={{ marginTop: 6 }}
            />
          </div>

          <div>
            <label
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#374151",
              }}
            >
              Upload document (optional)
            </label>

            <div
              style={{
                marginTop: 6,
                border: "2px dashed #D1D5DB",
                borderRadius: 12,
                padding: 18,
                background: "#F9FAFB",
              }}
            >
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                onChange={handleFileChange}
                disabled={isLoading}
              />

              <p
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: "#6B7280",
                }}
              >
                PDF, Word or TXT files supported
              </p>

              {file && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    borderRadius: 8,
                    background: "#fff",
                    border: "1px solid #E5E7EB",
                    fontSize: 13,
                  }}
                >
                  📄 {file.name}
                </div>
              )}
            </div>
          </div>
        </div>

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