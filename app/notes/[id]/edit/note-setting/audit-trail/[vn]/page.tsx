"use client";

import { apiFetch } from "@/src/lib/api";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useAuth } from "@/src/context/AuthContext";
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import Delta from "quill-delta";

import {
  BlockFormatChangeItem,
  FormatChangeItem,
  Note,
  NoteVersion,
  FormatChange,
  AuditProjection,
  TooltipState,
  Segment,
} from "@/src/types";

import { registerFormats } from "@/src/lib/quillformats";
import {
  deltaToSegments,
  getChangeSelector,
  isBlockFormatChange,
  rangesFromReferences,
  referenceIndexToVisualIndex,
} from "@/src/lib/attribution";

import AuditSidebarModal from "@/components/AuditSidebarModal";
import { Tooltip } from "@/components/Tooltip";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  LoadingState,
} from "@/components/ui";

function AuditNoteContent() {
  const { id: noteId, vn: versionNumberParam } = useParams();
  const versionNumber = Number(versionNumberParam);

  const { user, loadingUser } = useAuth();
  const router = useRouter();

  const [note, setNote] = useState<Note | null>(null);
  const [noteVersion, setNoteVersion] = useState<NoteVersion | null>(null);

  const [formatChanges, setFormatChanges] = useState<FormatChangeItem[]>([]);
  const [blockFormatChanges, setBlockFormatChanges] = useState<BlockFormatChangeItem[]>([]);

  const [activeFormatId, setActiveFormatId] = useState<string | null>(null);
  const [activeChange, setActiveChange] = useState<TooltipState | null>(null);

  const [hasInlineChanges, sethasInlineChanges] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [quillReady, setQuillReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const editorRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<Quill | null>(null);

  const formatChangesRef = useRef<FormatChangeItem[]>([]);
  const blockFormatChangesRef = useRef<BlockFormatChangeItem[]>([]);
  const segmentsRef = useRef<Segment[]>([]);
  const runtimeSegCtrRef = useRef(0);

  const activeFormatIdRef = useRef<string | null>(null);
  const activeChangeRef = useRef<TooltipState | null>(null);
  const suspendedInlineGroupIdsRef = useRef<string[]>([]);

  useEffect(() => { formatChangesRef.current = formatChanges; }, [formatChanges]);
  useEffect(() => { blockFormatChangesRef.current = blockFormatChanges; }, [blockFormatChanges]);
  useEffect(() => { activeFormatIdRef.current = activeFormatId; }, [activeFormatId]);
  useEffect(() => { activeChangeRef.current = activeChange; }, [activeChange]);

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
        activeChangeRef.current = null;

        setActiveChange(null);
        setActiveFormatId(null);

        const projection = await apiFetch<AuditProjection>(
          `notes/${noteId}/versions/${noteVersion.id}/audit`,
          { method: "GET" },
        );

        if (cancelled) return;

        const baseDelta = new Delta(projection.baseDelta?.ops ?? []);
        const visualDelta = new Delta(projection.visualDelta?.ops ?? []);

        quill.setContents(baseDelta, "api");
        quill.updateContents(visualDelta, "api");

        const runtimeReviewDelta = baseDelta.compose(visualDelta);

        runtimeSegCtrRef.current = 0;
        segmentsRef.current = deltaToSegments(
          runtimeReviewDelta,
          nextRuntimeSegmentId,
        );

        const inlineFormatItems = projection.formatChanges ?? [];
        const blockFormatItems = projection.blockFormatChanges ?? [];

        formatChangesRef.current = inlineFormatItems;
        blockFormatChangesRef.current = blockFormatItems;

        setFormatChanges(inlineFormatItems);
        setBlockFormatChanges(blockFormatItems);

        const inlineExists =
          !!quill.root.querySelector('[data-change-type="insert"]') ||
          !!quill.root.querySelector('[data-change-type="delete"]');

        sethasInlineChanges(inlineExists);
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

  function nextRuntimeSegmentId(): string {
    runtimeSegCtrRef.current += 1;
    return `audit_seg_${runtimeSegCtrRef.current}`;
  }

  function getAllFormatChanges(): FormatChange[] {
    return [...formatChangesRef.current, ...blockFormatChangesRef.current];
  }

  function findFormatChangeByGroupId(groupId: string): FormatChange | null {
    return (
      formatChangesRef.current.find((fmt) => fmt.groupId === groupId) ??
      blockFormatChangesRef.current.find((fmt) => fmt.groupId === groupId) ??
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
    segmentsRef.current = [];
    runtimeSegCtrRef.current = 0;
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

    quill.root.querySelectorAll(".format-block-active").forEach((el) => {
      el.classList.remove("format-block-active");
      el.removeAttribute("data-active-format-block-group-id");
    });
  }

  function getInlineGroupIdsInFormatRange(item: FormatChange): string[] {
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
            '[data-change-type="insert"][data-group-id]',
            '[data-change-type="delete"][data-group-id]',
          ].join(", "),
        ) as HTMLElement | null;

        const groupId = host?.getAttribute("data-group-id");
        if (groupId) ids.add(groupId);
      }
    }

    return [...ids];
  }

  function setInlineGroupsSuspended(groupIds: string[], suspended: boolean) {
    const quill = quillRef.current;
    if (!quill) return;

    for (const groupId of groupIds) {
      quill.root
        .querySelectorAll(
          [
            `[data-group-id="${groupId}"][data-change-type="insert"]`,
            `[data-group-id="${groupId}"][data-change-type="delete"]`,
          ].join(", "),
        )
        .forEach((el) => {
          if (suspended) el.classList.add("format-inline-suspended");
          else el.classList.remove("format-inline-suspended");
        });
    }
  }

  function suspendInlineGroupsForFormat(item: FormatChange) {
    const groupIds = getInlineGroupIdsInFormatRange(item);
    suspendedInlineGroupIdsRef.current = groupIds;
    setInlineGroupsSuspended(groupIds, true);
  }

  function restoreSuspendedInlineGroups() {
    setInlineGroupsSuspended(suspendedInlineGroupIdsRef.current, false);
    suspendedInlineGroupIdsRef.current = [];
  }

  function applyAuditInlineFormatOverlay(item: FormatChangeItem) {
    const quill = quillRef.current;
    if (!quill) return;

    const ranges = rangesFromReferences(item.references ?? []);

    for (const range of ranges) {
      if (range.length <= 0) continue;

      const visualStart = referenceIndexToVisualIndex(
        segmentsRef.current,
        range.start,
      );

      const visualEnd = referenceIndexToVisualIndex(
        segmentsRef.current,
        range.start + range.length,
      );

      const visualLength = Math.max(0, visualEnd - visualStart);

      if (visualLength <= 0) continue;

      quill.formatText(
        visualStart,
        visualLength,
        "format-inline-active",
        true,
        "api",
      );
    }

    suspendInlineGroupsForFormat(item);
  }

  function applyAuditBlockFormatOverlay(item: BlockFormatChangeItem) {
    const quill = quillRef.current;
    if (!quill) return;

    clearAuditBlockFormatOverlay();

    const seen = new Set<HTMLElement>();
    const inlineIds = new Set<string>();

    for (const ref of item.references ?? []) {
      const visualIndex = referenceIndexToVisualIndex(
        segmentsRef.current,
        ref.reviewStart,
      );

      const lineResult = quill.getLine(visualIndex) as any;

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

  function applyAuditFormatOverlay(item: FormatChange) {
    if (isBlockFormatChange(item)) {
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
    activeChangeRef.current = null;
    setActiveChange(null);
  }

  const activateFormatChange = useCallback((groupId: string) => {
    const previousId = activeFormatIdRef.current;

    clearAuditFormatOverlay();
    restoreSuspendedInlineGroups();

    if (previousId === groupId) {
      activeFormatIdRef.current = null;
      activeChangeRef.current = null;

      setActiveFormatId(null);
      setActiveChange(null);
      return;
    }

    const item = findFormatChangeByGroupId(groupId);
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
    activeChangeRef.current = next;

    setActiveFormatId(groupId);
    setActiveChange(next);
  }, []);

  const handleInlineChangeClick = useCallback((e: Event) => {
    const target = (e as MouseEvent).target as HTMLElement;

    const node = target.closest(
      "[data-change-type][data-group-id]",
    ) as HTMLElement | null;

    if (!node) {
      deactivateAuditSelection();
      return;
    }

    const rawType = node.getAttribute("data-change-type");

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
      activeChangeRef.current?.groupId === groupId &&
      activeChangeRef.current?.type === type
        ? null
        : {
            groupId,
            type,
            actorEmail,
            createdAt,
            references,
          };

    activeChangeRef.current = next;
    setActiveChange(next);
  }, []);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill || !quillReady) return;

    quill.root.removeEventListener("click", handleInlineChangeClick);
    quill.root.addEventListener("click", handleInlineChangeClick);

    return () => {
      quill.root.removeEventListener("click", handleInlineChangeClick);
    };
  }, [quillReady, handleInlineChangeClick]);

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

      const selector = getChangeSelector(groupId, type);

      quill.root.querySelectorAll(selector).forEach((el) => {
        if (isActive) el.classList.add("hover");
        else el.classList.remove("hover");
      });
    };

    const onMouseOver = (e: Event) => {
      const target = e.target as HTMLElement;

      const node = target.closest(
        "[data-change-type][data-group-id]",
      ) as HTMLElement | null;

      const nextGroupId = node?.getAttribute("data-group-id") ?? null;
      const rawType = node?.getAttribute("data-change-type") ?? null;

      const nextType =
        rawType === "insert" || rawType === "delete" || rawType === "format"
          ? rawType
          : null;

      if (hoveredGroupId === nextGroupId && hoveredType === nextType) return;

      if (
        hoveredGroupId &&
        hoveredType &&
        hoveredGroupId !== activeChangeRef.current?.groupId
      ) {
        setGroupHoverState(hoveredGroupId, false, hoveredType);
      }

      hoveredGroupId = nextGroupId;
      hoveredType = nextType;

      if (
        hoveredGroupId &&
        hoveredType &&
        hoveredGroupId !== activeChangeRef.current?.groupId
      ) {
        setGroupHoverState(hoveredGroupId, true, hoveredType);
      }
    };

    const onMouseLeave = () => {
      if (
        hoveredGroupId &&
        hoveredType &&
        hoveredGroupId !== activeChangeRef.current?.groupId
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

    if (activeChange?.groupId) {
      const selector = getChangeSelector(
        activeChange.groupId,
        activeChange.type,
      );

      quill.root.querySelectorAll(selector).forEach((el) => {
        el.classList.add("active");
      });
    }
  }, [activeChange]);

  if (loadingUser) {
    return (
      <LoadingState
        title="Checking session"
        message="Confirming your account before opening the audit trail."
      />
    );
  }

  if (!user) {
    router.push("/login");
    return null;
  }

  if (isLoading) {
    return (
      <LoadingState
        title="Loading audit trail"
        message="Preparing this read-only version review."
      />
    );
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
        <EmptyState
          title="Note not found"
          message="This note may have been deleted or you may no longer have access to it."
        />
      </main>
    );
  }

  return (
    <main className="app-page-shell">
      <header className="app-page-header">
        <div className="min-w-0">
          <p className="app-page-eyebrow text-amber-700">Audit trail</p>
          <h1 className="app-page-title">{note.title}</h1>
          <p className="app-page-description">
            Read-only view of the changes saved in this version.
          </p>
          <div className="app-badge-row">
            <Badge tone="amber">Version {versionNumber}</Badge>
            {noteVersion && (
              <Badge tone="slate">
                Saved {new Date(noteVersion.createdAt).toLocaleString()}
              </Badge>
            )}
          </div>
        </div>

        <div className="app-page-actions">
          <Button
            variant="secondary"
            onClick={() => router.push(`/notes/${noteId}`)}
          >
            View Note
          </Button>
        </div>
      </header>

      <div className="app-alert">
        <span className="text-lg">🧾</span>
        <span>
          <strong>Audit Mode:</strong> This page is read-only. Select
          highlighted text or formatting cards to inspect what changed.
        </span>
      </div>

      <div className="editor-workspace">
        <section className="editor-surface reviewing">
          <div
            ref={editorRef}
            className="editor-surface-content"
            style={{ cursor: "default" }}
          />
        </section>

        <AuditSidebarModal
          hasInlineChanges={hasInlineChanges}
          formatChanges={getAllFormatChanges()}
          activeFormatId={activeFormatId}
          onActivateFormat={activateFormatChange}
          onClose={() => router.push(`/notes/${noteId}`)}
        />
      </div>

      <footer className="app-footer-meta">
        <span>Created at: {new Date(note.createdAt).toLocaleString()}</span>
        {noteVersion && (
          <span>
            Version created: {new Date(noteVersion.createdAt).toLocaleString()}
          </span>
        )}
      </footer>

      {activeChange && (
        <Tooltip
          tooltip={activeChange}
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
    <Suspense
      fallback={
        <LoadingState
          title="Loading audit trail"
          message="Preparing audit view."
        />
      }
    >
      <AuditNoteContent />
    </Suspense>
  );
}
