"use client";

import { FormatSuggestionItem } from "@/src/types";

interface FormatSidebarModalProps {
  open: boolean;
  hasPendingSuggestions: boolean;
  formatSuggestions: FormatSuggestionItem[];
  activeFormatId: string | null;
  onActivateFormat: (groupId: string) => void;
  onClose: () => void;
  onSave: (comment: string) => void;
} 

function formatAttrLabel(attributes: string): string {
  try {
    const attrs = JSON.parse(attributes) as Record<string, any>;
    return Object.entries(attrs)
      .filter(([, v]) => v !== null && v !== false)
      .map(([k, v]) => {
        if (v === true) return k.charAt(0).toUpperCase() + k.slice(1);
        if (k === "color" || k === "background") return `${k}: ${v}`;
        if (k === "header") return `H${v}`;
        if (k === "size") return `Size ${v}`;
        return `${k}: ${v}`;
      })
      .join(", ") || "Formatting";
  } catch {
    return "Formatting";
  }
}

function relativeTime(createdAt: string): string {
  try {
    const diff = Date.now() - new Date(createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return "";
  }
}

export default function FormatSidebarModal({
  open,
  hasPendingSuggestions,
  formatSuggestions,
  activeFormatId,
  onActivateFormat,
  onClose,
  onSave,
}: FormatSidebarModalProps) {
  if (!open) return null;

  return (
    <div style={{
      width: "280px",
      flexShrink: 0,
      backgroundColor: "white",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      padding: "1rem",
      display: "flex",
      flexDirection: "column",
      gap: "1rem",
      maxHeight: "80vh",
      overflowY: "auto",
      boxShadow: "0 2px 8px rgba(0,0,0,0.07)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: "600", color: "var(--text-main)" }}>
          Review Changes
        </h3>
        <button
          className="btn-icon"
          onClick={onClose}
          title="Exit review"
          style={{ fontSize: "1rem", padding: "4px 8px" }}
        >
          ✕
        </button>
      </div>

      {/* Inline suggestion count */}
      {hasPendingSuggestions && (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
          Click any highlighted text in the editor to accept or reject insert and delete suggestions.
        </p>
      )}

      {/* Format suggestions */}
      {formatSuggestions.length > 0 && (
        <div>
          <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.8rem", fontWeight: "600", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Formatting ({formatSuggestions.length})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {formatSuggestions.map(item => {
              const isActive = activeFormatId === item.groupId;
              return (
                <div
                  key={item.groupId}
                  style={{
                    border: isActive ? "1px solid #f9a825" : "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "0.6rem 0.75rem",
                    backgroundColor: isActive ? "#fffde7" : "#fafafa",
                    transition: "all 0.15s ease",
                  }}
                >
                  {/* Label row */}
                  <button
                    onClick={() => onActivateFormat(item.groupId)}
                    style={{
                      width: "100%",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.25rem" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: "600", color: isActive ? "#92400e" : "var(--text-main)" }}>
                        {formatAttrLabel(item.attributes)}
                      </span>
                      <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginLeft: "4px", flexShrink: 0 }}>
                        {relativeTime(item.createdAt)}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      by {item.actorEmail}
                    </div>
                    {item.previewText && (
                      <div style={{
                        fontSize: "0.73rem",
                        color: "#555",
                        marginTop: "0.25rem",
                        fontStyle: "italic",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "220px",
                      }}>
                        "{item.previewText}"
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No suggestions at all */}
      {!hasPendingSuggestions && formatSuggestions.length === 0 && (
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--text-muted)", textAlign: "center" }}>
          All changes reviewed.
        </p>
      )}

      {/* Save version */}
      <div style={{ marginTop: "auto", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
        <SaveVersionForm onSave={onSave} />
      </div>
    </div>
  );
}

function SaveVersionForm({ onSave }: { onSave: (comment: string) => void }) {
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        const input = (e.currentTarget.elements.namedItem("comment") as HTMLInputElement);
        onSave(input.value.trim() || "Reviewed version");
        input.value = "";
      }}
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
    >
      <label style={{ fontSize: "0.8rem", fontWeight: "500", color: "var(--text-muted)" }}>
        Save as version
      </label>
      <input
        name="comment"
        className="input-field"
        placeholder="Version comment…"
        style={{ fontSize: "0.8rem", padding: "6px 10px" }}
      />
      <button type="submit" className="btn-primary" style={{ fontSize: "0.8rem" }}>
        Save version
      </button>
    </form>
  );
}