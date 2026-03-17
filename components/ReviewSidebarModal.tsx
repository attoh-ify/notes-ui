"use client";

import { useState } from "react";

interface ReviewSidebarModalProps {
  open: boolean;
  hasPendingSuggestions: boolean;
  onClose: () => void;
  onSave: (comment: string) => void;
}

export default function ReviewSidebarModal({
  open,
  hasPendingSuggestions,
  onClose,
  onSave,
}: ReviewSidebarModalProps) {
  const [reviewComment, setReviewComment] = useState<string>("");

  if (!open) return null;

  return (
    <div
      style={{
        width: "200px",
        flexShrink: 0,
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "0.875rem",
        backgroundColor: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: "0.625rem",
        position: "sticky",
        top: "1rem",
      }}
    >
      <span
        style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text)" }}
      >
        Review Note
      </span>
      <textarea
        value={reviewComment}
        onChange={(e) => setReviewComment(e.target.value)}
        placeholder="Optional summary..."
        rows={4}
        style={{
          width: "100%",
          padding: "0.5rem",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          fontSize: "0.8rem",
          resize: "vertical",
          fontFamily: "inherit",
          color: "var(--text)",
          backgroundColor: "#fafafa",
          boxSizing: "border-box",
        }}
      />
      {hasPendingSuggestions && (
        <button
          className="btn-primary"
          onClick={() => onSave(reviewComment)}
          style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
        >
          Create Version
        </button>
      )}
      <button
        className="btn-secondary"
        onClick={onClose}
        style={{ fontSize: "0.8rem", padding: "0.4rem 0.75rem" }}
      >
        Exit Review
      </button>
    </div>
  );
}
