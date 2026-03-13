"use client";

interface ExitReviewModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  exitReview: () => void;
}

export default function ExitReviewModal({
  open,
  onClose,
  onSave,
  exitReview,
}: ExitReviewModalProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#fff",
          borderRadius: "10px",
          padding: "1.5rem",
          maxWidth: "380px",
          width: "90%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--text)" }}>
          Exit Review
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: "0.875rem",
            color: "var(--text-muted)",
          }}
        >
          What would you like to do with the changes you've reviewed so far?
        </p>
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
        >
          <button
            className="btn-primary"
            onClick={() => {
              onClose;
              onSave;
            }}
          >
            Save changes &amp; exit
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              onClose;
              exitReview;
            }}
          >
            Exit without saving
          </button>
          <button
            className="btn-outline"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
