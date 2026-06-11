"use client";

import { FormatChange } from "@/src/types";
import FormatChangeCard from "@/components/FormatChangeCard";

interface AuditSidebarModalProps {
  hasInlineChanges: boolean;
  formatChanges: FormatChange[];
  activeFormatId: string | null;
  onActivateFormat: (groupId: string) => void;
  onClose: () => void;
}

export default function AuditSidebarModal({
  hasInlineChanges,
  formatChanges,
  activeFormatId,
  onActivateFormat,
  onClose,
}: AuditSidebarModalProps) {
  return (
    <aside className="audit-sidebar">
      <div className="audit-sidebar-header">
        <div>
          <span className="audit-sidebar-eyebrow">Audit Trail</span>

          <h3 className="audit-sidebar-title" style={{ marginTop: 4 }}>
            Version changes
          </h3>
        </div>

        <button
          onClick={onClose}
          title="Close audit"
          className="audit-sidebar-close"
        >
          ✕
        </button>
      </div>

      <div className="audit-sidebar-warning">
        This page is read-only. Click highlighted inserts/deletes in the
        document, or click a formatting change below, to inspect metadata.
      </div>

      {formatChanges.length > 0 && (
        <section>
          <p className="audit-sidebar-section-title">Formatting</p>

          <div className="format-change-list">
            {formatChanges.map((item) => (
              <FormatChangeCard
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

      {!hasInlineChanges && formatChanges.length === 0 && (
        <p className="audit-sidebar-empty">
          No visible changes were found for this version.
        </p>
      )}
    </aside>
  );
}
