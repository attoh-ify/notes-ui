"use client";

import { ReviewFormatSuggestion } from "@/src/types";
import FormatSuggestionCard from "@/components/FormatSuggestionCard";

interface AuditSidebarModalProps {
  open: boolean;
  hasInlineSuggestions: boolean;
  formatSuggestions: ReviewFormatSuggestion[];
  activeFormatId: string | null;
  onActivateFormat: (groupId: string) => void;
  onClose: () => void;
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
    <aside className="suggestion-sidebar">
      <div className="suggestion-sidebar-header">
        <div>
          <span className="suggestion-sidebar-eyebrow">Audit Trail</span>

          <h3 className="suggestion-sidebar-title" style={{ marginTop: 4 }}>
            Version changes
          </h3>
        </div>

        <button
          onClick={onClose}
          title="Close audit"
          className="suggestion-sidebar-close"
        >
          ✕
        </button>
      </div>

      <div className="suggestion-sidebar-warning">
        This page is read-only. Click highlighted inserts/deletes in the document, or
        click a formatting change below, to inspect metadata.
      </div>

      {formatSuggestions.length > 0 && (
        <section>
          <p className="suggestion-sidebar-section-title">Formatting</p>

          <div className="format-suggestion-list">
            {formatSuggestions.map((item) => (
              <FormatSuggestionCard
                key={item.groupId}
                item={item}
                active={activeFormatId === item.groupId}
                disabled={false}
                onActivate={onActivateFormat}
              />
            ))}
          </div>
        </section>
      )}

      {!hasInlineSuggestions && formatSuggestions.length === 0 && (
        <p className="suggestion-sidebar-empty">
          No visible changes were found for this version.
        </p>
      )}
    </aside>
  );
}