import type Quill from "quill";

let formatsRegistered = false;

const getJsonObject = (node: HTMLElement, references: string, fallback: any) => {
  const val = node.getAttribute(references);
  try {
    return val ? JSON.parse(val) : fallback;
  } catch {
    return fallback;
  }
};

export function registerFormats(QuillModule: typeof Quill) {
  if (formatsRegistered) return;
  formatsRegistered = true;

  const Inline = QuillModule.import("blots/inline") as any;

  class SuggestionInsert extends Inline {
    static blotName = "suggestion-insert";
    static tagName = "span";

    static create(data: {
      groupId: string;
      actorEmail: string;
      createdAt: string;
      references: string;
      "base-attributes"?: Record<string, any>;
    }) {
      const node = super.create();

      const ids = Array.isArray(data.references) ? data.references : [];
      const uniqueIds = [...new Set(ids)];

      node.setAttribute("data-group-id", data.groupId);
      node.setAttribute("data-suggestion-type", "insert");
      node.setAttribute("data-actor-email", data.actorEmail ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");
      node.setAttribute("data-references", JSON.stringify(uniqueIds));
      node.setAttribute(
        "data-base-attributes",
        JSON.stringify(data["base-attributes"] ?? {})
      );
      node.classList.add("suggestion-insert");
      return node;
    }

    static formats(node: HTMLElement): SuggestionInsert {
      return {
        groupId: node.getAttribute("data-group-id") ?? "",
        actorEmail: node.getAttribute("data-actor-email") ?? "",
        createdAt: node.getAttribute("data-created-at") ?? "",
        references: getJsonObject(node, "data-references", []),
        baseAttributes: getJsonObject(node, "data-base-attributes", {}),
      };
    }
  }

  class SuggestionDelete extends Inline {
    static blotName = "suggestion-delete";
    static tagName = "span";

    static create(data: {
      groupId: string;
      actorEmail: string;
      createdAt: string;
      references: string;
    }) {
      const node = super.create();

      const ids = Array.isArray(data.references) ? data.references : [];
      const uniqueIds = [...new Set(ids)];

      node.setAttribute("data-group-id", data.groupId);
      node.setAttribute("data-suggestion-type", "delete");
      node.setAttribute("data-actor-email", data.actorEmail ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");
      node.setAttribute("data-references", JSON.stringify(uniqueIds));
      node.classList.add("suggestion-delete");

      return node;
    }

    static formats(node: HTMLElement): SuggestionDelete {
      return {
        groupId: node.getAttribute("data-group-id") ?? "",
        actorEmail: node.getAttribute("data-actor-email") ?? "",
        createdAt: node.getAttribute("data-created-at") ?? "",
        references: getJsonObject(node, "data-references", []),
      };
    }
  }

  class SuggestionDeleteNewline extends Inline {
    static blotName = "suggestion-delete-newline";
    static tagName = "span";

    static create(data: {
      groupId: string;
      actorEmail: string;
      createdAt: string;
      references: string;
    }) {
      const node = super.create();

      const ids = Array.isArray(data.references) ? data.references : [];
      const uniqueIds = [...new Set(ids)];

      node.setAttribute("data-group-id", data.groupId);
      node.setAttribute("data-suggestion-type", "delete");
      node.setAttribute("data-actor-email", data.actorEmail ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");
      node.setAttribute("data-references", JSON.stringify(uniqueIds));
      node.classList.add("suggestion-delete-newline");

      return node;
    }

    static formats(node: HTMLElement): SuggestionDeleteNewline {
      return {
        groupId: node.getAttribute("data-group-id") ?? "",
        actorEmail: node.getAttribute("data-actor-email") ?? "",
        createdAt: node.getAttribute("data-created-at") ?? "",
        references: getJsonObject(node, "data-references", []),
      };
    }
  }

  class SuggestionFormat extends Inline {
    static blotName = "suggestion-format";
    static tagName = "span";

    static create(data: {
      groupId: string;
      actorEmail: string;
      createdAt: string;
      attributes: string;
      references: string;
    }) {
      const attrString =
        typeof data.attributes === "object"
          ? JSON.stringify(data.attributes)
          : data.attributes;

      const node = super.create();

      const ids = Array.isArray(data.references) ? data.references : [];
      const uniqueIds = [...new Set(ids)];

      node.setAttribute("data-group-id", data.groupId);
      node.setAttribute("data-suggestion-type", "format");
      node.setAttribute("data-actor-email", data.actorEmail ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");
      node.setAttribute("data-references", JSON.stringify(uniqueIds));
      node.setAttribute("data-format-attributes", attrString ?? "{}");
      node.classList.add("suggestion-format");
      return node;
    }

    static formats(node: HTMLElement): SuggestionFormat {
      return {
        groupId: node.getAttribute("data-group-id") ?? "",
        actorEmail: node.getAttribute("data-actor-email") ?? "",
        createdAt: node.getAttribute("data-created-at") ?? "",
        references: getJsonObject(node, "data-references", []),
        attributes: getJsonObject(node, "data-format-attributes", {}),
      };
    }
  }

  QuillModule.register(SuggestionInsert, true);
  QuillModule.register(SuggestionDelete, true);
  QuillModule.register(SuggestionDeleteNewline, true);
  QuillModule.register(SuggestionFormat, true);
}
