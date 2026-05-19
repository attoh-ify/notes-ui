"use client";

import {
  BlockFormatSuggestionItem,
  ReviewFormatSuggestion,
} from "@/src/types";

interface FormatSuggestionCardProps {
  item: ReviewFormatSuggestion;
  active: boolean;
  disabled?: boolean;
  disabledMessage?: string;
  showKind?: boolean;
  onActivate: (groupId: string) => void;
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

export default function FormatSuggestionCard({
  item,
  active,
  disabled = false,
  disabledMessage = "Review dependent insert/delete suggestion first.",
  showKind = true,
  onActivate,
}: FormatSuggestionCardProps) {
  const isBlock = isBlockFormatSuggestion(item);

  return (
    <div
      className={[
        "format-suggestion-card",
        active ? "active" : "",
        disabled ? "disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onActivate(item.groupId)}
        className="format-suggestion-card-button"
      >
        <div className="format-suggestion-card-header">
          <span className="format-suggestion-card-title">
            {formatAttrLabel(item.attributeKey, item.attributeValue)}
          </span>

          {showKind ? (
            <span
              className={[
                "format-suggestion-kind",
                isBlock ? "block" : "inline",
              ].join(" ")}
            >
              {isBlock ? "Block" : "Inline"}
            </span>
          ) : (
            <span className="format-suggestion-time">
              {relativeTime(item.createdAt)}
            </span>
          )}
        </div>

        <div className="format-suggestion-card-meta">
          by {item.actorEmail}
        </div>

        {item.previewText && (
          <div className="format-suggestion-card-preview">
            “{item.previewText}”
          </div>
        )}

        {showKind && (
          <div className="format-suggestion-time">
            {relativeTime(item.createdAt)}
          </div>
        )}

        {disabled && (
          <div className="format-suggestion-disabled-message">
            {disabledMessage}
          </div>
        )}
      </button>
    </div>
  );
}