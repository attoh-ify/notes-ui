import type Quill from "quill";
import type { Reference } from "@/src/types";

let formatsRegistered = false;

type SuggestionPayload = {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  references?: Reference[];
  baseAttributes?: Record<string, any>;
  suggestionAttributes?: Record<string, any>;
};

type FormatPayload = {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  attributes?: Record<string, any>;
  references?: Reference[];
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

function cloneReference(ref: Reference): Reference {
  return {
    reviewStart: ref.reviewStart,
    componentStart: ref.componentStart,
    length: ref.length,
    opId: ref.opId,
    componentIndex: ref.componentIndex,
  };
}

function dedupeSuggestionReferences(
  references: Reference[] = [],
): Reference[] {
  const seen = new Set<string>();
  const out: Reference[] = [];

  for (const ref of references) {
    const key = [
      ref.opId,
      ref.componentIndex,
      ref.reviewStart,
      ref.componentStart,
      ref.length,
    ].join(":");

    if (seen.has(key)) continue;

    seen.add(key);
    out.push(cloneReference(ref));
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
    JSON.stringify(dedupeSuggestionReferences(data.references ?? [])),
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
    references: getJsonObject<Reference[]>(
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

  class SuggestionDeleteSingleLine extends Inline {
    static blotName = "suggestion-delete-singleline";
    static tagName = "span";

    static create(data: SuggestionPayload) {
      const node = super.create() as HTMLElement;

      setCommonSuggestionAttrs(node, data, "delete");
      node.classList.add("suggestion-delete-singleline");

      return node;
    }

    static formats(node: HTMLElement) {
      return readCommonSuggestionAttrs(node);
    }
  }

  class SuggestionDeleteMultiLine extends Inline {
    static blotName = "suggestion-delete-multiline";
    static tagName = "span";

    static create(data: SuggestionPayload) {
      const node = super.create() as HTMLElement;

      setCommonSuggestionAttrs(node, data, "delete");
      node.classList.add("suggestion-delete-multiline");

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
        JSON.stringify(dedupeSuggestionReferences(data.references ?? [])),
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
        references: getJsonObject<Reference[]>(
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

  class AuditFormatActive extends Inline {
    static blotName = "audit-format-active";
    static tagName = "span";
    static className = "audit-format-active";

    static create(value: boolean) {
      const node = super.create();
      if (value) {
        node.classList.add("audit-format-active");
      }
      return node;
    }

    static formats(node: HTMLElement) {
      return node.classList.contains("audit-format-active");
    }
  }

  QuillModule.register(SuggestionInsert, true);
  QuillModule.register(SuggestionDelete, true);
  QuillModule.register(SuggestionDeleteSingleLine, true);
  QuillModule.register(SuggestionDeleteMultiLine, true);
  QuillModule.register(SuggestionFormat, true);
  QuillModule.register(AuditFormatActive, true);
}