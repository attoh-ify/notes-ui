"use client";

import {
  BlockFormatSuggestionItem,
  ReviewFormatSuggestion,
} from "@/src/types";

interface FormatSidebarModalProps {
  open: boolean;
  hasPendingSuggestions: boolean;
  formatSuggestions: ReviewFormatSuggestion[];
  activeFormatId: string | null;
  onActivateFormat: (groupId: string) => void;
  canActOnFormat: (item: ReviewFormatSuggestion) => boolean;
  onClose: () => void;
  onSave: (comment: string) => void;
}

function isBlockFormatSuggestion(
  item: ReviewFormatSuggestion,
): item is BlockFormatSuggestionItem {
  return "behavior" in item || "conflictGroup" in item;
}

function formatAttrLabel(attributeKey: string, attributeValue: any): string {
  if (
    attributeValue === null ||
    attributeValue === false ||
    attributeValue === undefined
  ) {
    return `Remove ${attributeKey}`;
  }

  if (attributeValue === true) {
    return attributeKey.charAt(0).toUpperCase() + attributeKey.slice(1);
  }

  if (attributeKey === "color" || attributeKey === "background") {
    return `${attributeKey}: ${attributeValue}`;
  }

  if (attributeKey === "header") {
    return `Heading ${attributeValue}`;
  }

  if (attributeKey === "list") {
    return `${attributeValue} list`;
  }

  if (attributeKey === "blockquote") {
    return "Blockquote";
  }

  if (attributeKey === "code-block") {
    return "Code block";
  }

  if (attributeKey === "align") {
    return `Align ${attributeValue}`;
  }

  if (attributeKey === "indent") {
    return `Indent ${attributeValue}`;
  }

  if (attributeKey === "size") {
    return `Size ${attributeValue}`;
  }

  if (attributeKey === "link") {
    return "Link added";
  }

  return `${attributeKey}: ${attributeValue}`;
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
  canActOnFormat,
  onClose,
  onSave,
}: FormatSidebarModalProps) {
  if (!open) return null;

  return (
    <div
      style={{
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
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "0.95rem",
            fontWeight: "600",
            color: "var(--text-main)",
          }}
        >
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

      {hasPendingSuggestions && (
        <p
          style={{
            margin: 0,
            fontSize: "0.8rem",
            color: "var(--text-muted)",
            lineHeight: 1.4,
          }}
        >
          Review insert/delete suggestions first. Formatting suggestions that
          depend on them will unlock afterwards.
        </p>
      )}

      {formatSuggestions.length > 0 && (
        <div>
          <p
            style={{
              margin: "0 0 0.5rem 0",
              fontSize: "0.8rem",
              fontWeight: "600",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Formatting ({formatSuggestions.length})
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {formatSuggestions.map((item) => {
              const isActive = activeFormatId === item.groupId;
              const isBlock = isBlockFormatSuggestion(item);
              const canAct = canActOnFormat(item);

              return (
                <div
                  key={item.groupId}
                  style={{
                    border: isActive
                      ? "1px solid #f97316"
                      : "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "0.6rem 0.75rem",
                    backgroundColor: !canAct
                      ? "#f8fafc"
                      : isActive
                        ? "#fff7ed"
                        : "#fafafa",
                    opacity: canAct ? 1 : 0.65,
                    transition: "all 0.15s ease",
                  }}
                >
                  <button
                    type="button"
                    disabled={!canAct}
                    onClick={() => onActivateFormat(item.groupId)}
                    style={{
                      width: "100%",
                      background: "none",
                      border: "none",
                      padding: 0,
                      cursor: canAct ? "pointer" : "not-allowed",
                      textAlign: "left",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: "0.25rem",
                        gap: "0.35rem",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: "600",
                          color: isActive ? "#9a3412" : "var(--text-main)",
                        }}
                      >
                        {formatAttrLabel(item.attributeKey, item.attributeValue)}
                      </span>

                      <span
                        style={{
                          fontSize: "0.68rem",
                          color: isBlock ? "#ea580c" : "#7c3aed",
                          background: isBlock ? "#ffedd5" : "#ede9fe",
                          borderRadius: "999px",
                          padding: "1px 6px",
                          flexShrink: 0,
                        }}
                      >
                        {isBlock ? "Block" : "Inline"}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      by {item.actorEmail}
                    </div>

                    {item.previewText && (
                      <div
                        style={{
                          fontSize: "0.73rem",
                          color: "#555",
                          marginTop: "0.25rem",
                          fontStyle: "italic",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: "220px",
                        }}
                      >
                        &quot;{item.previewText}&quot;
                      </div>
                    )}

                    {!canAct && (
                      <div
                        style={{
                          marginTop: "0.35rem",
                          fontSize: "0.7rem",
                          color: "#92400e",
                          background: "#fef3c7",
                          border: "1px solid #fcd34d",
                          borderRadius: "5px",
                          padding: "4px 6px",
                        }}
                      >
                        Review dependent insert/delete suggestion first.
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                        marginTop: "0.25rem",
                      }}
                    >
                      {relativeTime(item.createdAt)}
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!hasPendingSuggestions && formatSuggestions.length === 0 && (
        <p
          style={{
            margin: 0,
            fontSize: "0.85rem",
            color: "var(--text-muted)",
            textAlign: "center",
          }}
        >
          All changes reviewed.
        </p>
      )}

      <div
        style={{
          marginTop: "auto",
          paddingTop: "0.5rem",
          borderTop: "1px solid var(--border)",
        }}
      >
        <SaveVersionForm onSave={onSave} disabled={!hasPendingSuggestions} />
      </div>
    </div>
  );
}

function SaveVersionForm({
  onSave,
  disabled,
}: {
  onSave: (comment: string) => void;
  disabled: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();

        if (disabled) return;

        const input = e.currentTarget.elements.namedItem(
          "comment",
        ) as HTMLInputElement;

        onSave(input.value.trim() || "Reviewed version");
        input.value = "";
      }}
      style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
    >
      <label
        style={{
          fontSize: "0.8rem",
          fontWeight: "500",
          color: "var(--text-muted)",
        }}
      >
        Save as version
      </label>

      <input
        name="comment"
        className="input-field"
        placeholder={
          disabled ? "No pending changes to save…" : "Version comment…"
        }
        disabled={disabled}
        style={{
          fontSize: "0.8rem",
          padding: "6px 10px",
          opacity: disabled ? 0.55 : 1,
          cursor: disabled ? "not-allowed" : "text",
        }}
      />

      {disabled && (
        <p
          style={{
            margin: 0,
            fontSize: "0.72rem",
            color: "#92400e",
            lineHeight: 1.35,
            background: "#FEF3C7",
            border: "1px solid #FCD34D",
            borderRadius: "6px",
            padding: "6px 8px",
          }}
        >
          There are no pending changes to save as a new version.
        </p>
      )}

      <button
        type="submit"
        className="btn-primary"
        disabled={disabled}
        style={{
          fontSize: "0.8rem",
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        Save version
      </button>
    </form>
  );
}