"use client";

import { BlockFormatChangeItem, FormatChange } from "@/src/types";

interface FormatChangeCardProps {
  item: FormatChange;
  active: boolean;
  disabled?: boolean;
  disabledMessage?: string;
  showKind?: boolean;
  onActivate: (groupId: string) => void;
}

function isBlockFormatChange(
  item: FormatChange,
): item is BlockFormatChangeItem {
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

export default function FormatChangeCard({
  item,
  active,
  disabled = false,
  disabledMessage = "Inspect the related insert/delete change first.",
  showKind = true,
  onActivate,
}: FormatChangeCardProps) {
  const isBlock = isBlockFormatChange(item);

  return (
    <div
      className={[
        "format-change-card",
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
        className="format-change-card-button"
      >
        <div className="format-change-card-header">
          <span className="format-change-card-title">
            {formatAttrLabel(item.attributeKey, item.attributeValue)}
          </span>

          {showKind ? (
            <span
              className={[
                "format-change-kind",
                isBlock ? "block" : "inline",
              ].join(" ")}
            >
              {isBlock ? "Block" : "Inline"}
            </span>
          ) : (
            <span className="format-change-time">
              {relativeTime(item.createdAt)}
            </span>
          )}
        </div>

        <div className="format-change-card-meta">by {item.actorEmail}</div>

        {item.previewText && (
          <div className="format-change-card-preview">“{item.previewText}”</div>
        )}

        {showKind && (
          <div className="format-change-time">
            {relativeTime(item.createdAt)}
          </div>
        )}

        {disabled && (
          <div className="format-change-disabled-message">
            {disabledMessage}
          </div>
        )}
      </button>
    </div>
  );
}
