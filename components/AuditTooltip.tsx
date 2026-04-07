import { OpReference } from "@/src/lib/attribution";
import { TooltipState, TYPE_CONFIG } from "@/src/types";

interface AuditTooltipProps {
  tooltip: TooltipState;
  onAccept: (groupId: string, type: "insert" | "delete" | "format", opIds: OpReference[]) => void;
  onReject: (groupId: string, type: "insert" | "delete" | "format") => void;
  onClose: () => void;
}

export function AuditTooltip({ tooltip, onAccept, onReject, onClose }: AuditTooltipProps) {
  const config = TYPE_CONFIG[tooltip.type];

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        top: "50%",
        transform: "translateY(-50%)",
        background: "#fff",
        border: "1px solid #e0e0e0",
        borderRadius: "10px",
        padding: "20px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.14)",
        zIndex: 9999,
        fontSize: "0.85rem",
        width: "220px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: config.color,
            flexShrink: 0,
          }} />
          <strong style={{ fontSize: "0.9rem", color: "#111" }}>{config.label}</strong>
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: "1rem", lineHeight: 1, padding: "0 2px" }}
        >
          ×
        </button>
      </div>

      <div style={{ background: "#f8f8f8", borderRadius: "6px", padding: "10px 12px", marginBottom: "12px" }}>
        <div style={{ fontSize: "0.7rem", color: "#999", marginBottom: "2px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Made by
        </div>
        <div style={{ fontWeight: 600, color: "#222", wordBreak: "break-all" }}>
          {tooltip.actorEmail || "Unknown"}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#888", marginTop: "4px" }}>
          {tooltip.createdAt ? new Date(tooltip.createdAt).toLocaleString() : "Unknown time"}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#888", marginTop: "4px" }}>
          Group ID: {tooltip.groupId || "Unknown group"}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <button
          onClick={() => onAccept(tooltip.groupId, tooltip.type, tooltip.references)}
          style={{ background: config.color, color: "#fff", border: "none", borderRadius: "6px", padding: "9px 0", cursor: "pointer", fontWeight: 600, fontSize: "0.82rem", width: "100%" }}
        >
          ✓ Accept change
        </button>
        <button
          onClick={() => onReject(tooltip.groupId, tooltip.type)}
          style={{ background: "#fff", color: "#C62828", border: "1.5px solid #C62828", borderRadius: "6px", padding: "9px 0", cursor: "pointer", fontWeight: 600, fontSize: "0.82rem", width: "100%" }}
        >
          ✕ Reject change
        </button>
      </div>
    </div>
  );
}