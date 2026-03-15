"use client";

import { apiFetch } from "@/src/lib/api";
import { NoteVersion } from "@/src/types";
import Delta from "quill-delta";
import { useEffect, useState } from "react";
import { saveAs } from "file-saver";
import * as quillToWord from "quill-to-word";
import { useRouter } from "next/navigation";

interface RevisionHistorySectionProps {
  noteId: string;
  title: string;
}

export default function RevisionHistorySection({
  noteId,
  title,
}: RevisionHistorySectionProps) {
  const router = useRouter();
  const [noteVersions, setNoteVersions] = useState<NoteVersion[] | null>(null);

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
  }, []);

  async function downloadNoteAsWord(masterDelta: Delta, title: string) {
    try {
      const docx = await quillToWord.generateWord(masterDelta, {
        exportAs: "blob",
      });
      saveAs(docx as Blob, `${title}.docx`);
    } catch (error) {
      console.log("Failed to generate word doc: ", error);
    }
  }

  if (!noteVersions)
    return <div className="container-wide">Note version not found.</div>;

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
          overflow: "hidden",
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
              <th style={{ padding: "12px 16px" }}>Download</th>
            </tr>
          </thead>
          <tbody>
            {noteVersions
              .filter((v) => v.versionNumber > 0)
              .map((v: NoteVersion) => (
                <tr
                  key={v.id}
                  style={{
                    borderBottom: "1px solid #E2E8F0",
                    fontSize: "0.95rem",
                    cursor: "pointer",
                    transition: "background 0.2s",
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
                    <div style={{ color: "#2D3748", fontWeight: "500" }}>
                      {v.comment || "No description"}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#718096" }}>
                      Revision: {v.revision}
                    </div>
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
                    onClick={() => router.push(`/notes/${noteId}`)}
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
                  <td>
                    <button
                      className="btn-secondary"
                      onClick={() => downloadNoteAsWord(v.masterDelta, `${title}-${v.versionNumber}`)}
                    >
                      Export Docx
                    </button>
                  </td>
                </tr>
              ))}
            {noteVersions.length < 2 && (
              <tr>
                <td
                  colSpan={4}
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
            Manually creating a version saves a permanent snapshot of the
            current state.
          </p>
        </div>
      </div>
    </section>
  );
}
