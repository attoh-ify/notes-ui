"use client";

import { apiFetch } from "@/src/lib/api";
import { NoteVersion } from "@/src/types";
import Delta from "quill-delta";
import { useEffect, useState } from "react";
import { saveAs } from "file-saver";
import * as quillToWord from "quill-to-word";
import { useRouter } from "next/navigation";
import { jsPDF } from "jspdf";

interface RevisionHistorySectionProps {
  noteId: string;
  title: string;
}

type ExportFormat = "pdf" | "docx" | "txt";

export default function RevisionHistorySection({
  noteId,
  title,
}: RevisionHistorySectionProps) {
  const router = useRouter();

  const [noteVersions, setNoteVersions] = useState<NoteVersion[] | null>(null);
  const [openExportMenuId, setOpenExportMenuId] = useState<string | null>(null);

  useEffect(() => {
    async function initNoteVersions() {
      try {
        const noteVersionsData = await apiFetch<NoteVersion[]>(
          `notes/${noteId}/versions`,
          {
            method: "GET",
          },
        );

        setNoteVersions(noteVersionsData);
      } catch (error) {
        console.log("Failed to load note versions");
      }
    }

    initNoteVersions();
  }, [noteId]);

  function normalizeDelta(masterDelta: Delta): Delta {
    return new Delta((masterDelta as any)?.ops ?? []);
  }

  function safeFileName(name: string): string {
    return name
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 120);
  }

  function deltaToPlainText(masterDelta: Delta): string {
    const delta = normalizeDelta(masterDelta);

    return (delta.ops ?? [])
      .map((op: any) => {
        if (typeof op.insert === "string") return op.insert;
        if (op.insert?.image) return "[Image]";
        return "";
      })
      .join("");
  }

  async function downloadNoteAsWord(masterDelta: Delta, fileName: string) {
    try {
      const delta = normalizeDelta(masterDelta);

      const docx = await quillToWord.generateWord(delta, {
        exportAs: "blob",
      });

      saveAs(docx as Blob, `${safeFileName(fileName)}.docx`);
    } catch (error) {
      console.log("Failed to generate word doc: ", error);
    }
  }

  function downloadNoteAsTxt(masterDelta: Delta, fileName: string) {
    try {
      const text = deltaToPlainText(masterDelta);

      const blob = new Blob([text || ""], {
        type: "text/plain;charset=utf-8",
      });

      saveAs(blob, `${safeFileName(fileName)}.txt`);
    } catch (error) {
      console.log("Failed to generate txt file: ", error);
    }
  }

  function downloadNoteAsPdf(masterDelta: Delta, fileName: string) {
    try {
      const text = deltaToPlainText(masterDelta);
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4",
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const marginX = 48;
      const marginTop = 56;
      const marginBottom = 48;
      const maxWidth = pageWidth - marginX * 2;

      let y = marginTop;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text(fileName, marginX, y);

      y += 28;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);

      const lines = pdf.splitTextToSize(text || "", maxWidth);

      for (const line of lines) {
        if (y > pageHeight - marginBottom) {
          pdf.addPage();
          y = marginTop;
        }

        pdf.text(line, marginX, y);
        y += 16;
      }

      pdf.save(`${safeFileName(fileName)}.pdf`);
    } catch (error) {
      console.log("Failed to generate pdf file: ", error);
    }
  }

  async function handleExport(
    format: ExportFormat,
    version: NoteVersion,
  ) {
    const fileName = `${title}-v${version.versionNumber}`;

    setOpenExportMenuId(null);

    if (format === "docx") {
      await downloadNoteAsWord(version.masterDelta, fileName);
      return;
    }

    if (format === "txt") {
      downloadNoteAsTxt(version.masterDelta, fileName);
      return;
    }

    downloadNoteAsPdf(version.masterDelta, fileName);
  }

  if (!noteVersions) {
    return <div className="container-wide">Note version not found.</div>;
  }

  const visibleVersions = noteVersions.filter((v) => v.versionNumber > 0);

  return (
    <section style={{ marginBottom: "40px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h3
          style={{
            fontSize: "1.2rem",
            fontWeight: "600",
            color: "#2D3748",
            margin: 0,
          }}
        >
          Revision History
        </h3>
      </div>

      <div
        style={{
          backgroundColor: "#F7FAFC",
          borderRadius: 12,
          border: "1px solid #E2E8F0",
          overflow: "visible",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            textAlign: "left",
          }}
        >
          <thead
            style={{
              backgroundColor: "#EDF2F7",
              fontSize: "0.85rem",
              color: "#4A5568",
            }}
          >
            <tr>
              <th style={{ padding: "12px 16px" }}>v#</th>
              <th style={{ padding: "12px 16px" }}>Details</th>
              <th style={{ padding: "12px 16px" }}>Created At</th>
              <th style={{ padding: "12px 16px" }}>Action</th>
              <th style={{ padding: "12px 16px" }}>Audit</th>
              <th style={{ padding: "12px 16px" }}>Export</th>
            </tr>
          </thead>

          <tbody>
            {visibleVersions.map((v: NoteVersion) => {
              const hasUserComment = Boolean(v.comment?.trim());
              const isExportMenuOpen = openExportMenuId === v.id;

              return (
                <tr
                  key={v.id}
                  style={{
                    borderBottom: "1px solid #E2E8F0",
                    fontSize: "0.95rem",
                    cursor: "default",
                    transition: "background 0.2s",
                    position: "relative",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "#EDF2F7")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  <td
                    style={{
                      padding: "12px 16px",
                      fontWeight: "600",
                      color: "#4A5568",
                    }}
                  >
                    {v.versionNumber}
                  </td>

                  <td style={{ padding: "12px 16px" }}>
                    {hasUserComment ? (
                      <div
                        style={{
                          color: "#2D3748",
                          fontWeight: 500,
                        }}
                      >
                        {v.comment}
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "5px 9px",
                          borderRadius: 999,
                          background: "#F1F5F9",
                          border: "1px dashed #CBD5E1",
                          color: "#64748B",
                          fontSize: "0.78rem",
                          fontStyle: "italic",
                          fontWeight: 600,
                        }}
                        title="This version was saved without a user comment."
                      >
                        <span aria-hidden="true">ℹ️</span>
                        <span>No comment added</span>
                      </div>
                    )}
                  </td>

                  <td
                    style={{
                      padding: "12px 16px",
                      color: "#718096",
                      fontSize: "0.85rem",
                    }}
                  >
                    {new Date(v.createdAt).toLocaleString()}
                  </td>

                  <td style={{ padding: "12px 16px" }}>
                    <button
                      onClick={() => router.push(`/notes/${noteId}?version=${v.versionNumber}`)}
                      style={{
                        color: "#3182CE",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: "600",
                      }}
                    >
                      View
                    </button>
                  </td>

                  <td style={{ padding: "12px 16px" }}>
                    <button
                      onClick={() =>
                        router.push(
                          `/notes/${noteId}/edit/note-setting/audit-trail/${v.versionNumber}`,
                        )
                      }
                      style={{
                        color: "#3182CE",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: "600",
                      }}
                    >
                      Audit
                    </button>
                  </td>

                  <td style={{ padding: "12px 16px", position: "relative" }}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenExportMenuId((current) =>
                          current === v.id ? null : v.id,
                        )
                      }
                      style={{
                        padding: "8px 12px",
                        borderRadius: 10,
                        border: "1px solid #CBD5E1",
                        background: "white",
                        color: "#334155",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: "0.82rem",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      Export
                      <span style={{ fontSize: "0.72rem" }}>▾</span>
                    </button>

                    {isExportMenuOpen && (
                      <div
                        style={{
                          position: "absolute",
                          right: 16,
                          top: "calc(100% - 6px)",
                          width: 170,
                          background: "white",
                          border: "1px solid #E2E8F0",
                          borderRadius: 12,
                          boxShadow: "0 12px 30px rgba(15,23,42,0.14)",
                          padding: 6,
                          zIndex: 20,
                        }}
                      >
                        <ExportMenuButton
                          label="Export as PDF"
                          description="Portable document"
                          onClick={() => handleExport("pdf", v)}
                        />

                        <ExportMenuButton
                          label="Export as DOCX"
                          description="Word document"
                          onClick={() => handleExport("docx", v)}
                        />

                        <ExportMenuButton
                          label="Export as TXT"
                          description="Plain text"
                          onClick={() => handleExport("txt", v)}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}

            {visibleVersions.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    padding: "24px",
                    textAlign: "center",
                    color: "#A0AEC0",
                  }}
                >
                  No versions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div
          style={{
            padding: "12px",
            borderTop: "1px solid #E2E8F0",
            textAlign: "center",
            backgroundColor: "#EDF2F7",
          }}
        >
          <p
            style={{
              fontSize: "0.75rem",
              color: "#718096",
              margin: "0 0 8px 0",
            }}
          >
            Creating a version saves a permanent snapshot of the
            current state.
          </p>
        </div>
      </div>
    </section>
  );
}

function ExportMenuButton({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        border: "none",
        background: "transparent",
        borderRadius: 8,
        padding: "9px 10px",
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#F8FAFC";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          fontSize: "0.82rem",
          fontWeight: 700,
          color: "#1E293B",
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: "0.72rem",
          color: "#64748B",
          marginTop: 2,
        }}
      >
        {description}
      </div>
    </button>
  );
}