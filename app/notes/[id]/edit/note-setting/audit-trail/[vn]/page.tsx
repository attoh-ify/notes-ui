"use client";

import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  Suspense,
} from "react";
import { useAuth } from "@/src/context/AuthContext";
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import Delta from "quill-delta";

import {
  FormatSuggestionItem,
  Note,
  NoteVersion,
  ReviewProjection,
  TooltipState,
} from "@/src/types";

import { registerFormats } from "@/src/lib/quillformats";
import {
  buildFormatOverlayClearDelta,
  buildFormatOverlayDelta,
  getSuggestionSelector,
} from "@/src/lib/attribution";

import AuditSidebarModal from "@/components/AuditSidebarModal";
import { ReviewTooltip } from "@/components/ReviewTooltip";

function AuditMetadataTooltip({
  tooltip,
  onClose,
}: {
  tooltip: TooltipState;
  onClose: () => void;
}) {
  const typeLabel =
    tooltip.type === "insert"
      ? "Inserted text"
      : tooltip.type === "delete"
        ? "Deleted text"
        : "Formatting change";

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        width: 340,
        zIndex: 1000,
        background: "white",
        border: "1px solid #E5E7EB",
        borderRadius: "16px",
        boxShadow: "0 16px 40px rgba(0,0,0,0.14)",
        padding: "1rem",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: "0.75rem",
          alignItems: "flex-start",
          marginBottom: "0.75rem",
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
            {typeLabel}
          </span>

          <h3
            style={{
              margin: "4px 0 0",
              fontSize: "1rem",
              color: "#111827",
            }}
          >
            Change metadata
          </h3>
        </div>

        <button
          onClick={onClose}
          style={{
            width: 30,
            height: 30,
            borderRadius: 10,
            border: "1px solid #E5E7EB",
            background: "white",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.55rem",
          fontSize: "0.82rem",
          color: "#374151",
        }}
      >
        <div>
          <strong>Group:</strong> {tooltip.groupId}
        </div>

        <div>
          <strong>Actor:</strong> {tooltip.actorEmail}
        </div>

        <div>
          <strong>Created:</strong>{" "}
          {new Date(tooltip.createdAt).toLocaleString()}
        </div>

        <div>
          <strong>Operation refs:</strong> {tooltip.references.length}
        </div>
      </div>
    </div>
  );
}

function AuditNoteContent() {
  const { id: noteId, vn: versionNumberParam } = useParams();
  const versionNumber = Number(versionNumberParam);

  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(null);
  const [noteVersion, setNoteVersion] = useState<NoteVersion | null>(null);
  const [formatSuggestions, setFormatSuggestions] = useState<
    FormatSuggestionItem[]
  >([]);
  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] =
    useState<TooltipState | null>(null);

  const [hasInlineSuggestions, setHasInlineSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [quillReady, setQuillReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);
  const formatSuggestionsRef = useRef<FormatSuggestionItem[]>([]);
  const activeFormatIdRef = useRef<string | null>(null);
  const activeSuggestionRef = useRef<TooltipState | null>(null);

  useEffect(() => {
    formatSuggestionsRef.current = formatSuggestions;
  }, [formatSuggestions]);

  useEffect(() => {
    activeFormatIdRef.current = activeFormatId;
  }, [activeFormatId]);

  useEffect(() => {
    activeSuggestionRef.current = activeSuggestion;
  }, [activeSuggestion]);

  useEffect(() => {
    if (Number.isNaN(versionNumber)) {
      setErrorMessage("Invalid version number");
    }
  }, [versionNumber]);

  useEffect(() => {
    async function fetchNote() {
      try {
        setIsLoading(true);

        const noteData = await apiFetch<Note>(`notes/${noteId}`, {
          method: "GET",
        });

        setNote(noteData);

        const noteVersionData = await apiFetch<NoteVersion>(
          `notes/${noteData.id}/versions/${versionNumber}`,
          { method: "GET" },
        );

        setNoteVersion(noteVersionData);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to load note");
      } finally {
        setIsLoading(false);
      }
    }

    if (noteId && user && !Number.isNaN(versionNumber)) {
      fetchNote();
    }
  }, [noteId, user, versionNumber]);

  useEffect(() => {
    if (!isLoading && editorRef.current && !quillRef.current) {
      const initQuill = async () => {
        const { default: QuillModule } = await import("quill");

        registerFormats(QuillModule);

        quillRef.current = new QuillModule(editorRef.current!, {
          theme: "snow",
          readOnly: true,
          modules: {
            toolbar: false,
            cursors: false,
          },
          placeholder: "",
        });

        setQuillReady(true);
      };

      initQuill();
    }
  }, [isLoading]);

  const clearActiveFormatOverlay = useCallback(() => {
    const quill = quillRef.current;
    const activeId = activeFormatIdRef.current;

    if (!quill || !activeId) return;

    const activeItem = formatSuggestionsRef.current.find(
      (item) => item.groupId === activeId,
    );

    if (activeItem) {
      quill.updateContents(buildFormatOverlayClearDelta(activeItem), "api");
    }

    setActiveFormatId(null);
  }, []);

  const activateFormatSuggestion = useCallback(
    (groupId: string) => {
      const quill = quillRef.current;
      if (!quill) return;

      const previousId = activeFormatIdRef.current;

      if (previousId) {
        const previousItem = formatSuggestionsRef.current.find(
          (item) => item.groupId === previousId,
        );

        if (previousItem) {
          quill.updateContents(
            buildFormatOverlayClearDelta(previousItem),
            "api",
          );
        }
      }

      if (previousId === groupId) {
        setActiveFormatId(null);
        setActiveSuggestion(null);
        return;
      }

      const item = formatSuggestionsRef.current.find(
        (fmt) => fmt.groupId === groupId,
      );

      if (!item) return;

      quill.updateContents(buildFormatOverlayDelta(item), "api");

      setActiveFormatId(groupId);
      setActiveSuggestion({
        groupId: item.groupId,
        type: "format",
        actorEmail: item.actorEmail,
        createdAt: item.createdAt,
        references: item.references,
      });
    },
    [],
  );

  const handleInlineSuggestionClick = useCallback((e: Event) => {
    const target = (e as MouseEvent).target as HTMLElement;

    const node = target.closest(
      "[data-suggestion-type][data-group-id]",
    ) as HTMLElement | null;

    if (!node) {
      setActiveSuggestion(null);
      return;
    }

    const rawType = node.getAttribute("data-suggestion-type");

    if (rawType !== "insert" && rawType !== "delete") {
      return;
    }

    clearActiveFormatOverlay();

    const groupId = node.getAttribute("data-group-id") ?? "";
    const actorEmail = node.getAttribute("data-actor-email") ?? "";
    const createdAt = node.getAttribute("data-created-at") ?? "";

    let references = [];

    try {
      references = JSON.parse(node.getAttribute("data-references") ?? "[]");
    } catch {
      references = [];
    }

    setActiveSuggestion((prev) =>
      prev?.groupId === groupId
        ? null
        : {
            groupId,
            type: rawType,
            actorEmail,
            createdAt,
            references,
          },
    );
  }, [clearActiveFormatOverlay]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill || !quillReady) return;

    quill.root.removeEventListener("click", handleInlineSuggestionClick);
    quill.root.addEventListener("click", handleInlineSuggestionClick);

    return () => {
      quill.root.removeEventListener("click", handleInlineSuggestionClick);
    };
  }, [quillReady, handleInlineSuggestionClick]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill || !quillReady) return;

    let hoveredGroupId: string | null = null;
    let hoveredType: TooltipState["type"] | null = null;

    const setGroupHoverState = (
      groupId: string | null,
      isActive: boolean,
      type: TooltipState["type"] | null,
    ) => {
      if (!groupId || !type) return;

      const selector = getSuggestionSelector(groupId, type);

      quill.root.querySelectorAll(selector).forEach((el) => {
        if (isActive) el.classList.add("hover");
        else el.classList.remove("hover");
      });
    };

    const onMouseOver = (e: Event) => {
      const target = e.target as HTMLElement;

      const node = target.closest(
        "[data-suggestion-type][data-group-id]",
      ) as HTMLElement | null;

      const nextGroupId = node?.getAttribute("data-group-id") ?? null;
      const rawType = node?.getAttribute("data-suggestion-type") ?? null;

      const nextType =
        rawType === "insert" || rawType === "delete" || rawType === "format"
          ? rawType
          : null;

      if (hoveredGroupId === nextGroupId && hoveredType === nextType) return;

      if (
        hoveredGroupId &&
        hoveredType &&
        hoveredGroupId !== activeSuggestionRef.current?.groupId
      ) {
        setGroupHoverState(hoveredGroupId, false, hoveredType);
      }

      hoveredGroupId = nextGroupId;
      hoveredType = nextType;

      if (
        hoveredGroupId &&
        hoveredType &&
        hoveredGroupId !== activeSuggestionRef.current?.groupId
      ) {
        setGroupHoverState(hoveredGroupId, true, hoveredType);
      }
    };

    const onMouseLeave = () => {
      if (
        hoveredGroupId &&
        hoveredType &&
        hoveredGroupId !== activeSuggestionRef.current?.groupId
      ) {
        setGroupHoverState(hoveredGroupId, false, hoveredType);
      }

      hoveredGroupId = null;
      hoveredType = null;
    };

    quill.root.addEventListener("mouseover", onMouseOver);
    quill.root.addEventListener("mouseleave", onMouseLeave);

    return () => {
      quill.root.removeEventListener("mouseover", onMouseOver);
      quill.root.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [quillReady]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;

    quill.root
      .querySelectorAll(".active")
      .forEach((el) => el.classList.remove("active"));

    if (activeSuggestion?.groupId) {
      const selector = getSuggestionSelector(
        activeSuggestion.groupId,
        activeSuggestion.type,
      );

      quill.root.querySelectorAll(selector).forEach((el) => {
        el.classList.add("active");
      });
    }
  }, [activeSuggestion]);

  useEffect(() => {
    async function initAudit() {
      const quill = quillRef.current;
      if (!quill || !noteVersion) return;

      try {
        clearActiveFormatOverlay();
        setActiveSuggestion(null);
        setActiveFormatId(null);

        const projection = await apiFetch<ReviewProjection>(
          `notes/${noteId}/versions/${noteVersion.id}/audit`,
          { method: "GET" },
        );

        quill.setContents(new Delta(), "api");

        if (projection.baseDelta?.ops?.length) {
          quill.setContents(new Delta(projection.baseDelta.ops), "api");
        }

        if (projection.visualDelta?.ops?.length) {
          quill.updateContents(new Delta(projection.visualDelta.ops), "api");
        }

        setFormatSuggestions(projection.formatSuggestions ?? []);

        const inlineExists =
          !!quill.root.querySelector('[data-suggestion-type="insert"]') ||
          !!quill.root.querySelector('[data-suggestion-type="delete"]');

        setHasInlineSuggestions(inlineExists);
      } catch (err: any) {
        setErrorMessage(err.message || "Failed to load audit trail");
      }
    }

    if (noteId && noteVersion && !isLoading && quillReady) {
      initAudit();
    }
  }, [
    noteId,
    noteVersion,
    isLoading,
    quillReady,
    clearActiveFormatOverlay,
  ]);

  if (loadingUser) {
    return <div className="container-wide">Checking session...</div>;
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  if (isLoading) {
    return <div className="container-wide">Loading note...</div>;
  }

  if (errorMessage) {
    return (
      <div className="container-wide" style={{ color: "red" }}>
        {errorMessage}
      </div>
    );
  }

  if (!note) {
    return <div className="container-wide">Note not found.</div>;
  }

  return (
    <main
      className="container-wide"
      style={{
        maxWidth: "1150px",
        paddingBottom: 60,
      }}
    >
      <header style={{ marginBottom: "1.5rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <div>
            <span
              style={{
                fontSize: "0.72rem",
                color: "#D97706",
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Audit Trail
            </span>

            <h1
              style={{
                fontSize: "2rem",
                margin: "8px 0 10px",
                color: "#111827",
                lineHeight: 1.1,
              }}
            >
              {note.title}
            </h1>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "#F3F4F6",
                  border: "1px solid #E5E7EB",
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                <span style={{ color: "#6B7280" }}>Version:</span>
                <span>{versionNumber}</span>
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={() => router.push(`/notes/${noteId}`)}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: "1px solid #E5E7EB",
                background: "white",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              View Note
            </button>
          </div>
        </div>
      </header>

      <div
        style={{
          backgroundColor: "#FEF3C7",
          border: "1px solid #FCD34D",
          color: "#92400E",
          padding: "0.9rem 1rem",
          borderRadius: "12px",
          marginBottom: "1rem",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          fontSize: "0.9rem",
          fontWeight: 500,
        }}
      >
        <span style={{ fontSize: "1.2rem" }}>🧾</span>

        <span>
          <strong>Audit Mode:</strong> This is a read-only view of what changed
          in this version compared with the previous version.
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "flex-start",
        }}
      >
        <section
          style={{
            flex: 1,
            minWidth: 0,
            position: "relative",
            minHeight: "500px",
            borderRadius: "18px",
            overflow: "hidden",
            border: "2px solid #FCD34D",
            backgroundColor: "white",
            boxShadow: "0 4px 18px rgba(0,0,0,0.04)",
          }}
        >
          <div
            ref={editorRef}
            style={{
              fontFamily: "monospace",
              fontSize: "1rem",
              lineHeight: "1.7",
              padding: "2rem",
              border: "none",
              cursor: "default",
            }}
          />
        </section>

        <AuditSidebarModal
          open={true}
          hasInlineSuggestions={hasInlineSuggestions}
          formatSuggestions={formatSuggestions}
          activeFormatId={activeFormatId}
          onActivateFormat={activateFormatSuggestion}
          onClose={() => router.push(`/notes/${noteId}`)}
        />
      </div>

      <footer
        style={{
          marginTop: "1rem",
          fontSize: "0.75rem",
          color: "#9CA3AF",
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <span>Created at: {new Date(note.createdAt).toLocaleString()}</span>

        {noteVersion && (
          <span>
            Version created: {new Date(noteVersion.createdAt).toLocaleString()}
          </span>
        )}
      </footer>

      {activeSuggestion && (
      <ReviewTooltip
        tooltip={activeSuggestion}
        readOnly
        onAccept={() => {}}
        onReject={() => {}}
        onClose={() => {
          clearActiveFormatOverlay();
          setActiveSuggestion(null);
        }}
      />
    )}
    </main>
  );
}

export default function AuditNotePage() {
  return (
    <Suspense fallback={<p>Loading audit trail...</p>}>
      <AuditNoteContent />
    </Suspense>
  );
}