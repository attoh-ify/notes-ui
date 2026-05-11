import type Quill from "quill";
import type { SuggestionSlice } from "@/src/types";

let formatsRegistered = false;

type SuggestionPayload = {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  references?: SuggestionSlice[];
  baseAttributes?: Record<string, any>;
  suggestionAttributes?: Record<string, any>;
};

type FormatPayload = {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  attributes?: Record<string, any>;
  references?: SuggestionSlice[];
};

const getJsonObject = <T,>(
  node: HTMLElement,
  attrName: string,
  fallback: T,
): T => {
  const val = node.getAttribute(attrName);

  try {
    return val ? (JSON.parse(val) as T) : fallback;
  } catch {
    return fallback;
  }
};

function cloneSlice(slice: SuggestionSlice): SuggestionSlice {
  return {
    reviewStart: slice.reviewStart,
    componentStart: slice.componentStart,
    length: slice.length,
    ref: {
      opId: slice.ref.opId,
      componentIndex: slice.ref.componentIndex,
    },
  };
}

function dedupeSuggestionSlices(
  references: SuggestionSlice[] = [],
): SuggestionSlice[] {
  const seen = new Set<string>();
  const out: SuggestionSlice[] = [];

  for (const slice of references) {
    if (!slice?.ref) continue;

    const key = [
      slice.ref.opId,
      slice.ref.componentIndex,
      slice.reviewStart,
      slice.componentStart,
      slice.length,
    ].join(":");

    if (seen.has(key)) continue;

    seen.add(key);
    out.push(cloneSlice(slice));
  }

  return out;
}

function setCommonSuggestionAttrs(
  node: HTMLElement,
  data: SuggestionPayload,
  type: "insert" | "delete",
) {
  node.setAttribute("data-group-id", data.groupId ?? "");
  node.setAttribute("data-suggestion-type", type);
  node.setAttribute("data-actor-email", data.actorEmail ?? "");
  node.setAttribute("data-created-at", data.createdAt ?? "");

  node.setAttribute(
    "data-references",
    JSON.stringify(dedupeSuggestionSlices(data.references ?? [])),
  );

  node.setAttribute(
    "data-base-attributes",
    JSON.stringify(data.baseAttributes ?? {}),
  );

  node.setAttribute(
    "data-suggestion-attributes",
    JSON.stringify(data.suggestionAttributes ?? {}),
  );
}

function readCommonSuggestionAttrs(node: HTMLElement) {
  return {
    groupId: node.getAttribute("data-group-id") ?? "",
    actorEmail: node.getAttribute("data-actor-email") ?? "",
    createdAt: node.getAttribute("data-created-at") ?? "",
    references: getJsonObject<SuggestionSlice[]>(
      node,
      "data-references",
      [],
    ),
    baseAttributes: getJsonObject<Record<string, any>>(
      node,
      "data-base-attributes",
      {},
    ),
    suggestionAttributes: getJsonObject<Record<string, any>>(
      node,
      "data-suggestion-attributes",
      {},
    ),
  };
}

export function registerFormats(QuillModule: typeof Quill) {
  if (formatsRegistered) return;
  formatsRegistered = true;

  const Inline = QuillModule.import("blots/inline") as any;

  class SuggestionInsert extends Inline {
    static blotName = "suggestion-insert";
    static tagName = "span";

    static create(data: SuggestionPayload) {
      const node = super.create() as HTMLElement;

      setCommonSuggestionAttrs(node, data, "insert");
      node.classList.add("suggestion-insert");

      return node;
    }

    static formats(node: HTMLElement) {
      return readCommonSuggestionAttrs(node);
    }
  }

  class SuggestionDelete extends Inline {
    static blotName = "suggestion-delete";
    static tagName = "span";

    static create(data: SuggestionPayload) {
      const node = super.create() as HTMLElement;

      setCommonSuggestionAttrs(node, data, "delete");
      node.classList.add("suggestion-delete");

      return node;
    }

    static formats(node: HTMLElement) {
      return readCommonSuggestionAttrs(node);
    }
  }

  class SuggestionDeleteNewline extends Inline {
    static blotName = "suggestion-delete-newline";
    static tagName = "span";

    static create(data: SuggestionPayload) {
      const node = super.create() as HTMLElement;

      setCommonSuggestionAttrs(node, data, "delete");
      node.classList.add("suggestion-delete-newline");

      return node;
    }

    static formats(node: HTMLElement) {
      return readCommonSuggestionAttrs(node);
    }
  }

  class SuggestionFormat extends Inline {
    static blotName = "suggestion-format";
    static tagName = "span";

    static create(data: FormatPayload) {
      const node = super.create() as HTMLElement;

      node.setAttribute("data-group-id", data.groupId ?? "");
      node.setAttribute("data-suggestion-type", "format");
      node.setAttribute("data-actor-email", data.actorEmail ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");

      node.setAttribute(
        "data-references",
        JSON.stringify(dedupeSuggestionSlices(data.references ?? [])),
      );

      node.setAttribute(
        "data-format-attributes",
        JSON.stringify(data.attributes ?? {}),
      );

      node.classList.add("suggestion-format");

      return node;
    }

    static formats(node: HTMLElement) {
      return {
        groupId: node.getAttribute("data-group-id") ?? "",
        actorEmail: node.getAttribute("data-actor-email") ?? "",
        createdAt: node.getAttribute("data-created-at") ?? "",
        references: getJsonObject<SuggestionSlice[]>(
          node,
          "data-references",
          [],
        ),
        attributes: getJsonObject<Record<string, any>>(
          node,
          "data-format-attributes",
          {},
        ),
      };
    }
  }

  QuillModule.register(SuggestionInsert, true);
  QuillModule.register(SuggestionDelete, true);
  QuillModule.register(SuggestionDeleteNewline, true);
  QuillModule.register(SuggestionFormat, true);
}