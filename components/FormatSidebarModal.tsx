"use client";

import { ReviewFormatSuggestion } from "@/src/types";
import FormatSuggestionCard from "@/components/FormatSuggestionCard";

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
    <div className="suggestion-sidebar">
      <div className="suggestion-sidebar-header">
        <h3 className="suggestion-sidebar-title">Review Changes</h3>

        <button
          className="suggestion-sidebar-close"
          onClick={onClose}
          title="Exit review"
          style={{ fontSize: "1rem", padding: "4px 8px" }}
        >
          ✕
        </button>
      </div>

      {hasPendingSuggestions && (
        <p className="suggestion-sidebar-note">
          Review insert/delete suggestions first. Formatting suggestions that depend on
          them will unlock afterwards.
        </p>
      )}

      {formatSuggestions.length > 0 && (
        <div>
          <p className="suggestion-sidebar-section-title">
            Formatting ({formatSuggestions.length})
          </p>

          <div className="format-suggestion-list">
            {formatSuggestions.map((item) => {
              const canAct = canActOnFormat(item);

              return (
                <FormatSuggestionCard
                  key={item.groupId}
                  item={item}
                  active={activeFormatId === item.groupId}
                  disabled={!canAct}
                  onActivate={onActivateFormat}
                />
              );
            })}
          </div>
        </div>
      )}

      {!hasPendingSuggestions && formatSuggestions.length === 0 && (
        <p className="suggestion-sidebar-empty">All changes reviewed.</p>
      )}

      <div className="suggestion-sidebar-footer">
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
      className="save-version-form"
    >
      <label className="save-version-label">Save as version</label>

      <input
        name="comment"
        className="input-field save-version-input"
        placeholder={
          disabled ? "No pending changes to save…" : "Version comment…"
        }
        disabled={disabled}
      />

      {disabled && (
        <p className="save-version-disabled-message">
          There are no pending changes to save as a new version.
        </p>
      )}

      <button
        type="submit"
        className="btn-primary save-version-button"
        disabled={disabled}
      >
        Save version
      </button>
    </form>
  );
}