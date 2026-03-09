import type Quill from "quill";

let formatsRegistered = false;

export function registerFormats(QuillModule: typeof Quill) {
  if (formatsRegistered) return;
  formatsRegistered = true;

  const Inline = QuillModule.import("blots/inline") as any;

  class SuggestionInsert extends Inline {
    static blotName = "suggestion-insert";  // how quill identifies it
    static tagName = "span";  // HTML element used

    static create(data: { groupId: string; authorId: string; createdAt: string }) {  // how the element should be built when the format is applied
      const node = super.create();
      node.setAttribute("data-group-id", data.groupId);
      node.setAttribute("data-suggestion-type", "insert");
      node.setAttribute("data-author-id", data.authorId ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");
      node.classList.add("suggestion-insert");  // CSS styling reference
      return node;
    }

    static formats(node: HTMLElement) {
      return {
        groupId: node.getAttribute("data-group-id"),
        authorId: node.getAttribute("data-author-id"),
        createdAt: node.getAttribute("data-created-at"),
      };
    }
  }

  class SuggestionDelete extends Inline {
    static blotName = "suggestion-delete";
    static tagName = "span";

    static create(data: { groupId: string; authorId: string; createdAt: string; originalText: string }) {
      const node = super.create();
      node.setAttribute("data-group-id", data.groupId);
      node.setAttribute("data-suggestion-type", "delete");
      node.setAttribute("data-author-id", data.authorId ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");
      node.setAttribute("data-original-text", data.originalText ?? "");
      node.classList.add("suggestion-delete");
      return node;
    }

    static formats(node: HTMLElement) {
      return {
        groupId: node.getAttribute("data-group-id"),
        authorId: node.getAttribute("data-author-id"),
        createdAt: node.getAttribute("data-created-at"),
        originalText: node.getAttribute("data-original-text"),
      };
    }
  }

  class SuggestionFormat extends Inline {
    static blotName = "suggestion-format";
    static tagName = "span";

    static create(data: {
      groupId: string;
      authorId: string;
      createdAt: string;
      attributes: string;
    }) {
      const node = super.create();
      node.setAttribute("data-group-id", data.groupId);
      node.setAttribute("data-suggestion-type", "format");
      node.setAttribute("data-author-id", data.authorId ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");
      node.setAttribute("data-format-attributes", data.attributes ?? "{}");
      node.classList.add("suggestion-format");
      return node;
    }

    static formats(node: HTMLElement) {
      return {
        groupId: node.getAttribute("data-group-id"),
        authorId: node.getAttribute("data-author-id"),
        createdAt: node.getAttribute("data-created-at"),
        attributes: node.getAttribute("data-format-attributes"),
      };
    }
  }

  QuillModule.register(SuggestionInsert, true);
  QuillModule.register(SuggestionDelete, true);
  QuillModule.register(SuggestionFormat, true);
}