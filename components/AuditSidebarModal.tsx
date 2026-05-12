"use client";

import { FormatSuggestionItem } from "@/src/types";

interface AuditSidebarModalProps {
  open: boolean;
  hasInlineSuggestions: boolean;
  formatSuggestions: FormatSuggestionItem[];
  activeFormatId: string | null;
  onActivateFormat: (groupId: string) => void;
  onClose: () => void;
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

export default function AuditSidebarModal({
  open,
  hasInlineSuggestions,
  formatSuggestions,
  activeFormatId,
  onActivateFormat,
  onClose,
}: AuditSidebarModalProps) {
  if (!open) return null;

  return (
    <aside
      style={{
        width: "300px",
        flexShrink: 0,
        backgroundColor: "white",
        border: "1px solid #E5E7EB",
        borderRadius: "18px",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        maxHeight: "80vh",
        overflowY: "auto",
        boxShadow: "0 4px 18px rgba(0,0,0,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "0.75rem",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "0.7rem",
              color: "#D97706",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Audit Trail
          </span>

          <h3
            style={{
              margin: "4px 0 0",
              fontSize: "1rem",
              fontWeight: 700,
              color: "#111827",
            }}
          >
            Version changes
          </h3>
        </div>

        <button
          onClick={onClose}
          title="Close audit"
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            border: "1px solid #E5E7EB",
            background: "white",
            cursor: "pointer",
            fontSize: "1rem",
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          border: "1px solid #FCD34D",
          background: "#FEF3C7",
          color: "#92400E",
          borderRadius: "12px",
          padding: "0.75rem",
          fontSize: "0.82rem",
          lineHeight: 1.45,
        }}
      >
        This page is read-only. Click highlighted inserts/deletes in the
        document, or click a formatting change below, to inspect metadata.
      </div>

      {formatSuggestions.length > 0 && (
        <section>
          <p
            style={{
              margin: "0 0 0.5rem 0",
              fontSize: "0.75rem",
              fontWeight: 800,
              color: "#6B7280",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Formatting
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {formatSuggestions.map((item) => {
              const isActive = activeFormatId === item.groupId;

              return (
                <button
                  key={item.groupId}
                  onClick={() => onActivateFormat(item.groupId)}
                  style={{
                    width: "100%",
                    border: isActive
                      ? "1px solid #F59E0B"
                      : "1px solid #E5E7EB",
                    borderRadius: "12px",
                    padding: "0.75rem",
                    backgroundColor: isActive ? "#FFFBEB" : "#FAFAFA",
                    transition: "all 0.15s ease",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: "0.5rem",
                      marginBottom: "0.35rem",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        color: isActive ? "#92400E" : "#111827",
                      }}
                    >
                      {formatAttrLabel(item.attributeKey, item.attributeValue)}
                    </span>

                    <span
                      style={{
                        fontSize: "0.68rem",
                        color: "#9CA3AF",
                        flexShrink: 0,
                      }}
                    >
                      {relativeTime(item.createdAt)}
                    </span>
                  </div>

                  <div
                    style={{
                      fontSize: "0.74rem",
                      color: "#6B7280",
                      marginBottom: item.previewText ? "0.3rem" : 0,
                    }}
                  >
                    by {item.actorEmail}
                  </div>

                  {item.previewText && (
                    <div
                      style={{
                        fontSize: "0.73rem",
                        color: "#4B5563",
                        fontStyle: "italic",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      “{item.previewText}”
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {!hasInlineSuggestions && formatSuggestions.length === 0 && (
        <p
          style={{
            margin: 0,
            fontSize: "0.85rem",
            color: "#6B7280",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          No visible changes were found for this version.
        </p>
      )}
    </aside>
  );
}