"use client";

import { Note } from "@/app/notes/page";
import { apiFetch } from "@/src/lib/api";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface NoteAccessModalProps {
  open: boolean;
  email: string,
  userId: string;
  onClose: () => void;
}

export default function CreateNoteModal({
  open,
  email,
  userId,
  onClose,
}: NoteAccessModalProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");

  if (!open) return null;

  async function onCreate() {
    try {
      const data = await apiFetch<Note>("notes", {
        method: "POST",
        body: JSON.stringify({
            title
        })
      });
      if (!userId || !email) {
        throw("User not authenticated");
      }
      router.push(
        `/notes/${data.id}/edit?email${email}&userId=${encodeURIComponent(userId)}`,
      );
      onClose();
    } catch (err: any) {
      throw(err.message || "Failed to create Note.");
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
              Create new note
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

        <section
          style={{
            backgroundColor: "#F7FAFC",
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
            }}
          >
            <input
              value={title}
              placeholder="Title..."
              onChange={(e) => setTitle(e.target.value)}
              style={{
                flex: 1,
                padding: "6px 8px",
                borderRadius: 6,
                border: "1px solid #CBD5E0",
                color: "black",
              }}
            />
          </div>
        </section>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={onCreate}
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid #CBD5E0",
              backgroundColor: "#2F855A",
              cursor: "pointer",
            }}
          >
            create
          </button>
        </div>
      </div>
    </div>
  );
}
