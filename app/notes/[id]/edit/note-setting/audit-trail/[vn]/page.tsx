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
  BlockFormatSuggestionItem,
  FormatSuggestionItem,
  Note,
  NoteVersion,
  ReviewFormatSuggestion,
  ReviewProjection,
  TooltipState,
} from "@/src/types";

import { registerFormats } from "@/src/lib/quillformats";
import {
  getSuggestionSelector,
  isBlockFormatSuggestion,
  rangesFromReferences,
} from "@/src/lib/attribution";

import AuditSidebarModal from "@/components/AuditSidebarModal";
import { ReviewTooltip } from "@/components/ReviewTooltip";
import { Badge, Button, EmptyState, ErrorBanner, LoadingState } from "@/components/ui";

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

  const [blockFormatSuggestions, setBlockFormatSuggestions] = useState<
    BlockFormatSuggestionItem[]
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
  const blockFormatSuggestionsRef = useRef<BlockFormatSuggestionItem[]>([]);

  const activeFormatIdRef = useRef<string | null>(null);
  const activeSuggestionRef = useRef<TooltipState | null>(null);
  const suspendedInlineGroupIdsRef = useRef<string[]>([]);

  useEffect(() => {
    formatSuggestionsRef.current = formatSuggestions;
  }, [formatSuggestions]);

  useEffect(() => {
    blockFormatSuggestionsRef.current = blockFormatSuggestions;
  }, [blockFormatSuggestions]);

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

  useEffect(() => {
    let cancelled = false;

    async function initAudit() {
      const quill = quillRef.current;
      if (!quill || !noteVersion) return;

      try {
        clearAllAuditState();

        activeFormatIdRef.current = null;
        activeSuggestionRef.current = null;

        setActiveSuggestion(null);
        setActiveFormatId(null);

        const projection = await apiFetch<ReviewProjection>(
          `notes/${noteId}/versions/${noteVersion.id}/audit`,
          { method: "GET" },
        );

        if (cancelled) return;

        const baseDelta = new Delta(projection.baseDelta?.ops ?? []);
        const visualDelta = new Delta(projection.visualDelta?.ops ?? []);

        quill.setContents(baseDelta, "api");
        quill.updateContents(visualDelta, "api");

        const inlineFormatItems = projection.formatSuggestions ?? [];
        const blockFormatItems = projection.blockFormatSuggestions ?? [];

        formatSuggestionsRef.current = inlineFormatItems;
        blockFormatSuggestionsRef.current = blockFormatItems;

        setFormatSuggestions(inlineFormatItems);
        setBlockFormatSuggestions(blockFormatItems);

        const inlineExists =
          !!quill.root.querySelector('[data-suggestion-type="insert"]') ||
          !!quill.root.querySelector('[data-suggestion-type="delete"]');

        setHasInlineSuggestions(inlineExists);
      } catch (err: any) {
        if (!cancelled) {
          setErrorMessage(err.message || "Failed to load audit trail");
        }
      }
    }

    if (noteId && noteVersion?.id && !isLoading && quillReady) {
      initAudit();
    }

    return () => {
      cancelled = true;
    };
  }, [noteId, noteVersion?.id, isLoading, quillReady]);

  function getAllFormatSuggestions(): ReviewFormatSuggestion[] {
    return [
      ...formatSuggestionsRef.current,
      ...blockFormatSuggestionsRef.current,
    ];
  }

  function findFormatSuggestionByGroupId(
    groupId: string,
  ): ReviewFormatSuggestion | null {
    return (
      formatSuggestionsRef.current.find((fmt) => fmt.groupId === groupId) ??
      blockFormatSuggestionsRef.current.find(
        (fmt) => fmt.groupId === groupId,
      ) ??
      null
    );
  }

  function clearAllAuditState() {
    const quill = quillRef.current;
    if (!quill) return;

    clearAuditFormatOverlay();

    quill.root
      .querySelectorAll(
        ".active, .hover, .format-inline-suspended, .format-block-active",
      )
      .forEach((el) => {
        el.classList.remove(
          "active",
          "hover",
          "format-inline-suspended",
          "format-block-active",
        );
      });

    suspendedInlineGroupIdsRef.current = [];
  }

  function clearAuditFormatOverlay() {
    const quill = quillRef.current;
    if (!quill) return;

    const length = quill.getLength();

    if (length > 0) {
      quill.formatText(0, length, "format-inline-active", false, "api");
    }

    clearAuditBlockFormatOverlay();
  }

  function clearAuditBlockFormatOverlay() {
    const quill = quillRef.current;
    if (!quill) return;

    quill.root
      .querySelectorAll(".format-block-active")
      .forEach((el) => {
        el.classList.remove("format-block-active");
        el.removeAttribute("data-active-format-block-group-id");
      });
  }

  function getInlineGroupIdsInFormatRange(
    item: ReviewFormatSuggestion,
  ): string[] {
    const quill = quillRef.current;
    if (!quill) return [];

    const ranges = rangesFromReferences(item.references ?? []);
    const ids = new Set<string>();

    for (const range of ranges) {
      for (let i = range.start; i < range.start + range.length; i++) {
        const [leaf] = quill.getLeaf(i) as any[];
        const domNode = leaf?.domNode as HTMLElement | Text | undefined;
        if (!domNode) continue;

        const element =
          domNode.nodeType === Node.TEXT_NODE
            ? domNode.parentElement
            : (domNode as HTMLElement);

        const host = element?.closest(
          [
            '[data-suggestion-type="insert"][data-group-id]',
            '[data-suggestion-type="delete"][data-group-id]',
            '[data-suggestion-type="delete-singleline"][data-group-id]',
            '[data-suggestion-type="delete-multiline"][data-group-id]',
            '[data-suggestion-type="delete-newline"][data-group-id]',
          ].join(", "),
        ) as HTMLElement | null;

        const groupId = host?.getAttribute("data-group-id");
        if (groupId) ids.add(groupId);
      }
    }

    return [...ids];
  }

  function setInlineGroupsSuspended(
    groupIds: string[],
    suspended: boolean,
  ) {
    const quill = quillRef.current;
    if (!quill) return;

    for (const groupId of groupIds) {
      quill.root
        .querySelectorAll(
          [
            `[data-group-id="${groupId}"][data-suggestion-type="insert"]`,
            `[data-group-id="${groupId}"][data-suggestion-type="delete"]`,
            `[data-group-id="${groupId}"][data-suggestion-type="delete-singleline"]`,
            `[data-group-id="${groupId}"][data-suggestion-type="delete-multiline"]`,
            `[data-group-id="${groupId}"][data-suggestion-type="delete-newline"]`,
          ].join(", "),
        )
        .forEach((el) => {
          if (suspended) el.classList.add("format-inline-suspended");
          else el.classList.remove("format-inline-suspended");
        });
    }
  }

  function suspendInlineGroupsForFormat(item: ReviewFormatSuggestion) {
    const groupIds = getInlineGroupIdsInFormatRange(item);
    suspendedInlineGroupIdsRef.current = groupIds;
    setInlineGroupsSuspended(groupIds, true);
  }

  function restoreSuspendedInlineGroups() {
    setInlineGroupsSuspended(suspendedInlineGroupIdsRef.current, false);
    suspendedInlineGroupIdsRef.current = [];
  }

  function applyAuditInlineFormatOverlay(item: FormatSuggestionItem) {
    const quill = quillRef.current;
    if (!quill) return;

    const ranges = rangesFromReferences(item.references ?? []);

    for (const range of ranges) {
      if (range.length <= 0) continue;

      quill.formatText(
        range.start,
        range.length,
         "format-inline-active",
        true,
        "api",
      );
    }

    suspendInlineGroupsForFormat(item);
  }

  function applyAuditBlockFormatOverlay(item: BlockFormatSuggestionItem) {
    const quill = quillRef.current;
    if (!quill) return;

    clearAuditBlockFormatOverlay();

    const seen = new Set<HTMLElement>();
    const inlineIds = new Set<string>();

    for (const ref of item.references ?? []) {
      const lineResult = quill.getLine(ref.reviewStart) as any;

      if (!lineResult) continue;

      const [line] = lineResult;
      const lineNode = line?.domNode as HTMLElement | undefined;

      if (lineNode && !seen.has(lineNode)) {
        lineNode.classList.add("format-block-active");
        lineNode.setAttribute(
          "data-active-format-block-group-id",
          item.groupId,
        );
        seen.add(lineNode);
      }

      const groupIds = getInlineGroupIdsInFormatRange(item);
      for (const groupId of groupIds) {
        inlineIds.add(groupId);
      }
    }

    suspendedInlineGroupIdsRef.current = [...inlineIds];
    setInlineGroupsSuspended([...inlineIds], true);
  }

  function applyAuditFormatOverlay(item: ReviewFormatSuggestion) {
    if (isBlockFormatSuggestion(item)) {
      applyAuditBlockFormatOverlay(item);
      return;
    }

    applyAuditInlineFormatOverlay(item);
  }

  function clearActiveFormatOverlay() {
    clearAuditFormatOverlay();
    restoreSuspendedInlineGroups();

    activeFormatIdRef.current = null;
    setActiveFormatId(null);
  }

  function deactivateAuditSelection() {
    clearActiveFormatOverlay();
    activeSuggestionRef.current = null;
    setActiveSuggestion(null);
  }

  const activateFormatSuggestion = useCallback((groupId: string) => {
    const previousId = activeFormatIdRef.current;

    clearAuditFormatOverlay();
    restoreSuspendedInlineGroups();

    if (previousId === groupId) {
      activeFormatIdRef.current = null;
      activeSuggestionRef.current = null;

      setActiveFormatId(null);
      setActiveSuggestion(null);
      return;
    }

    const item = findFormatSuggestionByGroupId(groupId);
    if (!item) return;

    applyAuditFormatOverlay(item);

    const next: TooltipState = {
      groupId: item.groupId,
      type: "format",
      actorEmail: item.actorEmail,
      createdAt: item.createdAt,
      references: item.references,
    };

    activeFormatIdRef.current = groupId;
    activeSuggestionRef.current = next;

    setActiveFormatId(groupId);
    setActiveSuggestion(next);
  }, []);

  const handleInlineSuggestionClick = useCallback((e: Event) => {
    const target = (e as MouseEvent).target as HTMLElement;

    const node = target.closest(
      "[data-suggestion-type][data-group-id]",
    ) as HTMLElement | null;

    if (!node) {
      deactivateAuditSelection();
      return;
    }

    const rawType = node.getAttribute("data-suggestion-type");

    if (rawType === "format") {
      return;
    }

    if (rawType !== "insert" && rawType !== "delete") {
      deactivateAuditSelection();
      return;
    }

    clearActiveFormatOverlay();

    const type = rawType as "insert" | "delete";
    const groupId = node.getAttribute("data-group-id") ?? "";
    const actorEmail = node.getAttribute("data-actor-email") ?? "";
    const createdAt = node.getAttribute("data-created-at") ?? "";

    let references: TooltipState["references"] = [];

    try {
      references = JSON.parse(node.getAttribute("data-references") ?? "[]");
    } catch {
      references = [];
    }

    const next: TooltipState | null =
      activeSuggestionRef.current?.groupId === groupId &&
      activeSuggestionRef.current?.type === type
        ? null
        : {
            groupId,
            type,
            actorEmail,
            createdAt,
            references,
          };

    activeSuggestionRef.current = next;
    setActiveSuggestion(next);
  }, []);

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

  if (loadingUser) {
    return <LoadingState title="Checking session" message="Confirming your account before opening the audit trail." />;
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  if (isLoading) {
    return <LoadingState title="Loading audit trail" message="Preparing this read-only version review." />;
  }

  if (errorMessage) {
    return (
      <main className="app-page-shell">
        <ErrorBanner message={errorMessage} />
      </main>
    );
  }

  if (!note) {
    return (
      <main className="app-page-shell">
        <EmptyState title="Note not found" message="This note may have been deleted or you may no longer have access to it." />
      </main>
    );
  }

  return (
    <main className="app-page-shell">
      <header className="app-page-header">
        <div className="min-w-0">
          <p className="app-page-eyebrow text-amber-700">Audit trail</p>
          <h1 className="app-page-title">{note.title}</h1>
          <p className="app-page-description">Read-only view of the changes saved in this version.</p>
          <div className="app-badge-row">
            <Badge tone="amber">Version {versionNumber}</Badge>
            {noteVersion && <Badge tone="slate">Saved {new Date(noteVersion.createdAt).toLocaleString()}</Badge>}
          </div>
        </div>

        <div className="app-page-actions">
          <Button variant="secondary" onClick={() => router.push(`/notes/${noteId}`)}>View Note</Button>
        </div>
      </header>

      <div className="app-alert">
        <span className="text-lg">🧾</span>
        <span>
          <strong>Audit Mode:</strong> This page is read-only. Select highlighted text or formatting cards to inspect what changed.
        </span>
      </div>

      <div className="editor-workspace">
        <section className="editor-surface reviewing">
          <div ref={editorRef} className="editor-surface-content" style={{ cursor: "default" }} />
        </section>

        <AuditSidebarModal
          open={true}
          hasInlineSuggestions={hasInlineSuggestions}
          formatSuggestions={getAllFormatSuggestions()}
          activeFormatId={activeFormatId}
          onActivateFormat={activateFormatSuggestion}
          onClose={() => router.push(`/notes/${noteId}`)}
        />
      </div>

      <footer className="app-footer-meta">
        <span>Created at: {new Date(note.createdAt).toLocaleString()}</span>
        {noteVersion && <span>Version created: {new Date(noteVersion.createdAt).toLocaleString()}</span>}
      </footer>

      {activeSuggestion && (
        <ReviewTooltip
          tooltip={activeSuggestion}
          readOnly
          onAccept={() => {}}
          onReject={() => {}}
          onClose={() => {
            deactivateAuditSelection();
          }}
        />
      )}
    </main>
  );
}

export default function AuditNotePage() {
  return (
    <Suspense fallback={<LoadingState title="Loading audit trail" message="Preparing audit view." />}>
      <AuditNoteContent />
    </Suspense>
  );
}