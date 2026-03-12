import type Quill from "quill";
import { SuggestionPayload } from "./types";

let formatsRegistered = false;

export function registerFormats(QuillModule: typeof Quill) {
  if (formatsRegistered) return;
  formatsRegistered = true;

  const Inline = QuillModule.import("blots/inline") as any;

  class SuggestionInsert extends Inline {
    static blotName = "suggestion-insert";
    static tagName = "span";

    static create(data: { groupId: string; actorEmail: string; createdAt: string }) {
      const node = super.create();
      node.setAttribute("data-group-id", data.groupId);
      node.setAttribute("data-suggestion-type", "insert");
      node.setAttribute("data-actor-email", data.actorEmail ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");
      node.classList.add("suggestion-insert");
      return node;
    }

    static formats(node: HTMLElement): SuggestionPayload {
      return {
        groupId: node.getAttribute("data-group-id") ?? "",
        actorEmail: node.getAttribute("data-actor-email") ?? "",
        createdAt: node.getAttribute("data-created-at") ?? "",
      };
    }
  }

  class SuggestionDelete extends Inline {
    static blotName = "suggestion-delete";
    static tagName = "span";

    static create(data: { groupId: string; actorEmail: string; createdAt: string }) {
      const node = super.create();
      node.setAttribute("data-group-id", data.groupId);
      node.setAttribute("data-suggestion-type", "delete");
      node.setAttribute("data-actor-email", data.actorEmail ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");
      node.classList.add("suggestion-delete");
      return node;
    }

    static formats(node: HTMLElement): SuggestionPayload {
      return {
        groupId: node.getAttribute("data-group-id") ?? "",
        actorEmail: node.getAttribute("data-actor-email") ?? "",
        createdAt: node.getAttribute("data-created-at") ?? "",
      };
    }
  }

  class SuggestionFormat extends Inline {
    static blotName = "suggestion-format";
    static tagName = "span";

    static create(data: { groupId: string; actorEmail: string; createdAt: string; attributes: string }) {
      const node = super.create();
      node.setAttribute("data-group-id", data.groupId);
      node.setAttribute("data-suggestion-type", "format");
      node.setAttribute("data-actor-email", data.actorEmail ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");
      node.setAttribute("data-format-attributes", data.attributes ?? "{}");
      node.classList.add("suggestion-format");
      return node;
    }

    static formats(node: HTMLElement): SuggestionPayload {
      return {
        groupId: node.getAttribute("data-group-id") ?? "",
        actorEmail: node.getAttribute("data-actor-email") ?? "",
        createdAt: node.getAttribute("data-created-at") ?? "",
        attributes: JSON.parse(node.getAttribute("data-format-attributes") ?? "{}"),
      };
    }
  }

  QuillModule.register(SuggestionInsert, true);
  QuillModule.register(SuggestionDelete, true);
  QuillModule.register(SuggestionFormat, true);
}