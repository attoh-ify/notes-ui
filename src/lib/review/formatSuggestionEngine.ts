import {
  buildFormatOverlayClearDelta,
  buildFormatOverlayDelta,
  isBlockFormatSuggestion,
  restoreFormatSuggestionToBase,
} from "../attribution";
import {
  applyBlockFormatDomOverlay,
  canActOnFormatSuggestion,
  clearBlockFormatDomOverlay,
  findRuntimeFormatSuggestion,
  refreshEditorFromRuntime,
  ReviewRuntimeContext,
} from "./runtimeHelpers";
import {
  BlockFormatSuggestionItem,
  FormatSuggestionItem,
  ReviewEntry,
  ReviewFormatSuggestion,
  TooltipState,
} from "@/src/types";
import { snapshotAndApply } from "./reviewHistory";

export function activateFormatSuggestion(
  ctx: ReviewRuntimeContext,
  groupId: string,
  setActiveFormatId: (v: string | null) => void,
  setActiveSuggestion: (v: TooltipState | null) => void,
  closeTooltip: (
    ctx: ReviewRuntimeContext,
    setActiveFormatId: (v: string | null) => void,
    setActiveSuggestion: (v: TooltipState | null) => void,
  ) => void,
) {
  const quill = ctx.quill;
  if (!quill) return;

  const prevId = ctx.activeFormatIdRef.current;

  if (prevId) {
    const prev = findRuntimeFormatSuggestion(ctx, prevId);

    if (prev) {
      if (isBlockFormatSuggestion(prev)) {
        clearBlockFormatDomOverlay(ctx);
      } else {
        quill.updateContents(buildFormatOverlayClearDelta(prev), "api");
      }
    }
  }

  if (prevId === groupId) {
    closeTooltip(ctx, setActiveFormatId, setActiveSuggestion);
    return;
  }

  const item = findRuntimeFormatSuggestion(ctx, groupId);
  if (!item) return;

  if (!canActOnFormatSuggestion(ctx, item)) {
    return;
  }

  if (isBlockFormatSuggestion(item)) {
    applyBlockFormatDomOverlay(ctx, item);
  } else {
    quill.updateContents(buildFormatOverlayDelta(item), "api");
  }

  setActiveFormatId(groupId);
  setActiveSuggestion({
    groupId: item.groupId,
    type: "format",
    actorEmail: item.actorEmail,
    createdAt: item.createdAt,
    references: item.references.map((r) => ({
      reviewStart: r.reviewStart,
      componentStart: r.componentStart,
      length: r.length,
      opId: r.opId,
      componentIndex: r.componentIndex,
    })),
  });
}

export function closeReviewTooltip(
  ctx: ReviewRuntimeContext,
  setActiveFormatId: (v: string | null) => void,
  setActiveSuggestion: (v: TooltipState | null) => void,
) {
  const quill = ctx.quill;
  const activeId = ctx.activeFormatIdRef.current;

  if (quill && ctx.activeSuggestionRef.current?.type === "format" && activeId) {
    const activeItem = findRuntimeFormatSuggestion(ctx, activeId);

    if (activeItem) {
      if (isBlockFormatSuggestion(activeItem)) {
        clearBlockFormatDomOverlay(ctx);
      } else {
        quill.updateContents(buildFormatOverlayClearDelta(activeItem), "api");
      }
    }

    setActiveFormatId(null);
  }

  setActiveSuggestion(null);
}

export function acceptFormatSuggestion(
  ctx: ReviewRuntimeContext,
  item: FormatSuggestionItem,
  deps: {
    snapshotAndApply: typeof snapshotAndApply;
    setFormatSuggestions: (
      updater: (prev: FormatSuggestionItem[]) => FormatSuggestionItem[],
    ) => void;
    setActiveFormatId: (v: string | null) => void;
    acceptedReferences: { current: any[] };
    reviewHistory: { current: ReviewEntry[] };
  },
) {
  acceptAnyFormatSuggestion(ctx, item, {
    snapshotAndApply: deps.snapshotAndApply,
    setSuggestions: deps.setFormatSuggestions,
    setActiveFormatId: deps.setActiveFormatId,
    acceptedReferences: deps.acceptedReferences,
    reviewHistory: deps.reviewHistory,
  });
}

export function acceptBlockFormatSuggestion(
  ctx: ReviewRuntimeContext,
  item: BlockFormatSuggestionItem,
  deps: {
    snapshotAndApply: typeof snapshotAndApply;
    setBlockFormatSuggestions: (
      updater: (
        prev: BlockFormatSuggestionItem[],
      ) => BlockFormatSuggestionItem[],
    ) => void;
    setActiveFormatId: (v: string | null) => void;
    acceptedReferences: { current: any[] };
    reviewHistory: { current: ReviewEntry[] };
  },
) {
  acceptAnyFormatSuggestion(ctx, item, {
    snapshotAndApply: deps.snapshotAndApply,
    setSuggestions: deps.setBlockFormatSuggestions,
    setActiveFormatId: deps.setActiveFormatId,
    acceptedReferences: deps.acceptedReferences,
    reviewHistory: deps.reviewHistory,
  });
}

function acceptAnyFormatSuggestion<T extends ReviewFormatSuggestion>(
  ctx: ReviewRuntimeContext,
  item: T,
  deps: {
    snapshotAndApply: typeof snapshotAndApply;
    setSuggestions: (updater: (prev: T[]) => T[]) => void;
    setActiveFormatId: (v: string | null) => void;
    acceptedReferences: { current: any[] };
    reviewHistory: { current: ReviewEntry[] };
  },
) {
  if (!canActOnFormatSuggestion(ctx, item)) return;

  deps.snapshotAndApply(
    ctx,
    () => {
      const quill = ctx.quill!;

      if (isBlockFormatSuggestion(item)) {
        clearBlockFormatDomOverlay(ctx);
      } else {
        quill.updateContents(buildFormatOverlayClearDelta(item), "api");
      }

      deps.acceptedReferences.current.push(
        item.references.map((ref) => ({
          opId: ref.opId,
          componentIndex: ref.componentIndex,
          componentStart: ref.componentStart,
          length: ref.length,
          attributeKey: item.attributeKey,
        })),
      );

      deps.setSuggestions((prev) =>
        prev.filter((f) => f.groupId !== item.groupId),
      );

      deps.setActiveFormatId(null);
    },
    "ACCEPT",
    {
      reviewHistory: deps.reviewHistory,
    },
  );
}

export function rejectFormatSuggestion(
  ctx: ReviewRuntimeContext,
  item: FormatSuggestionItem,
  deps: {
    snapshotAndApply: typeof snapshotAndApply;
    setFormatSuggestions: (
      updater: (prev: FormatSuggestionItem[]) => FormatSuggestionItem[],
    ) => void;
    setActiveFormatId: (v: string | null) => void;
    rejectedReferences: { current: any[] };
    reviewHistory: { current: ReviewEntry[] };
  },
) {
  rejectAnyFormatSuggestion(ctx, item, {
    snapshotAndApply: deps.snapshotAndApply,
    setSuggestions: deps.setFormatSuggestions,
    setActiveFormatId: deps.setActiveFormatId,
    rejectedReferences: deps.rejectedReferences,
    reviewHistory: deps.reviewHistory,
  });
}

export function rejectBlockFormatSuggestion(
  ctx: ReviewRuntimeContext,
  item: BlockFormatSuggestionItem,
  deps: {
    snapshotAndApply: typeof snapshotAndApply;
    setBlockFormatSuggestions: (
      updater: (
        prev: BlockFormatSuggestionItem[],
      ) => BlockFormatSuggestionItem[],
    ) => void;
    setActiveFormatId: (v: string | null) => void;
    rejectedReferences: { current: any[] };
    reviewHistory: { current: ReviewEntry[] };
  },
) {
  rejectAnyFormatSuggestion(ctx, item, {
    snapshotAndApply: deps.snapshotAndApply,
    setSuggestions: deps.setBlockFormatSuggestions,
    setActiveFormatId: deps.setActiveFormatId,
    rejectedReferences: deps.rejectedReferences,
    reviewHistory: deps.reviewHistory,
  });
}

function rejectAnyFormatSuggestion<T extends ReviewFormatSuggestion>(
  ctx: ReviewRuntimeContext,
  item: T,
  deps: {
    snapshotAndApply: typeof snapshotAndApply;
    setSuggestions: (updater: (prev: T[]) => T[]) => void;
    setActiveFormatId: (v: string | null) => void;
    rejectedReferences: { current: any[] };
    reviewHistory: { current: ReviewEntry[] };
  },
) {
  if (!canActOnFormatSuggestion(ctx, item)) return;

  deps.snapshotAndApply(
    ctx,
    () => {
      const quill = ctx.quill!;

      if (isBlockFormatSuggestion(item)) {
        clearBlockFormatDomOverlay(ctx);
      } else {
        quill.updateContents(buildFormatOverlayClearDelta(item), "api");
      }

      deps.rejectedReferences.current.push(
        item.references.map((ref) => ({
          opId: ref.opId,
          componentIndex: ref.componentIndex,
          componentStart: ref.componentStart,
          length: ref.length,
          attributeKey: item.attributeKey,
        })),
      );

      ctx.reviewSegmentsRef.current = restoreFormatSuggestionToBase(
        ctx.reviewSegmentsRef.current,
        item,
      );

      refreshEditorFromRuntime(ctx);

      deps.setSuggestions((prev) =>
        prev.filter((f) => f.groupId !== item.groupId),
      );

      deps.setActiveFormatId(null);
    },
    "REJECT",
    {
      reviewHistory: deps.reviewHistory,
    },
  );
}