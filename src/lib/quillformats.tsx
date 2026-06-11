import type Quill from "quill";
import type { Reference } from "@/src/types";

let formatsRegistered = false;

type ChangePayload = {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  references?: Reference[];
  baseAttributes?: Record<string, any>;
  changeAttributes?: Record<string, any>;
};

type FormatPayload = {
  groupId: string;
  actorEmail: string;
  createdAt: string;
  attributes?: Record<string, any>;
  references?: Reference[];
};

type ReviewBasePayload = {
  baseAttributes?: Record<string, any>;
  changeAttributes?: Record<string, any>;
};

function setReviewBaseAttrs(node: HTMLElement, data: ReviewBasePayload) {
  node.setAttribute(
    "data-base-attributes",
    JSON.stringify(data.baseAttributes ?? {}),
  );

  node.setAttribute(
    "data-change-attributes",
    JSON.stringify(data.changeAttributes ?? {}),
  );
}

function readReviewBaseAttrs(node: HTMLElement): ReviewBasePayload {
  return {
    baseAttributes: getJsonObject<Record<string, any>>(
      node,
      "data-base-attributes",
      {},
    ),
    changeAttributes: getJsonObject<Record<string, any>>(
      node,
      "data-change-attributes",
      {},
    ),
  };
}

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

function dedupeChangeReferences(references: Reference[] = []): Reference[] {
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

function setCommonChangeAttrs(
  node: HTMLElement,
  data: ChangePayload,
  type: "insert" | "delete",
) {
  node.setAttribute("data-group-id", data.groupId ?? "");
  node.setAttribute("data-change-type", type);
  node.setAttribute("data-actor-email", data.actorEmail ?? "");
  node.setAttribute("data-created-at", data.createdAt ?? "");

  node.setAttribute(
    "data-references",
    JSON.stringify(dedupeChangeReferences(data.references ?? [])),
  );

  node.setAttribute(
    "data-base-attributes",
    JSON.stringify(data.baseAttributes ?? {}),
  );

  node.setAttribute(
    "data-change-attributes",
    JSON.stringify(data.changeAttributes ?? {}),
  );
}

function readCommonChangeAttrs(node: HTMLElement) {
  return {
    groupId: node.getAttribute("data-group-id") ?? "",
    actorEmail: node.getAttribute("data-actor-email") ?? "",
    createdAt: node.getAttribute("data-created-at") ?? "",
    references: getJsonObject<Reference[]>(node, "data-references", []),
    baseAttributes: getJsonObject<Record<string, any>>(
      node,
      "data-base-attributes",
      {},
    ),
    changeAttributes: getJsonObject<Record<string, any>>(
      node,
      "data-change-attributes",
      {},
    ),
  };
}

export function registerFormats(QuillModule: typeof Quill) {
  if (formatsRegistered) return;
  formatsRegistered = true;

  const Inline = QuillModule.import("blots/inline") as any;
  const Parchment = QuillModule.import("parchment") as any;

  class AuditInsert extends Inline {
    static blotName = "audit-insert";
    static tagName = "span";

    static create(data: ChangePayload) {
      const node = super.create() as HTMLElement;
      setCommonChangeAttrs(node, data, "insert");
      node.classList.add("audit-insert");
      return node;
    }

    static formats(node: HTMLElement) {
      return readCommonChangeAttrs(node);
    }
  }

  class AuditDelete extends Inline {
    static blotName = "audit-delete";
    static tagName = "span";

    static create(data: ChangePayload) {
      const node = super.create() as HTMLElement;
      setCommonChangeAttrs(node, data, "delete");
      node.classList.add("audit-delete");
      return node;
    }

    static formats(node: HTMLElement) {
      return readCommonChangeAttrs(node);
    }
  }

  class AuditDeleteSingleLine extends Inline {
    static blotName = "audit-delete-singleline";
    static tagName = "span";

    static create(data: ChangePayload) {
      const node = super.create() as HTMLElement;
      setCommonChangeAttrs(node, data, "delete");
      node.classList.add("audit-delete-singleline");
      return node;
    }

    static formats(node: HTMLElement) {
      return readCommonChangeAttrs(node);
    }
  }

  class AuditDeleteMultiLine extends Inline {
    static blotName = "audit-delete-multiline";
    static tagName = "span";

    static create(data: ChangePayload) {
      const node = super.create() as HTMLElement;
      setCommonChangeAttrs(node, data, "delete");
      node.classList.add("audit-delete-multiline");
      return node;
    }

    static formats(node: HTMLElement) {
      return readCommonChangeAttrs(node);
    }
  }

  class AuditFormat extends Inline {
    static blotName = "audit-format";
    static tagName = "span";

    static create(data: FormatPayload) {
      const node = super.create() as HTMLElement;

      node.setAttribute("data-group-id", data.groupId ?? "");
      node.setAttribute("data-change-type", "format");
      node.setAttribute("data-actor-email", data.actorEmail ?? "");
      node.setAttribute("data-created-at", data.createdAt ?? "");

      node.setAttribute(
        "data-references",
        JSON.stringify(dedupeChangeReferences(data.references ?? [])),
      );

      node.setAttribute(
        "data-format-attributes",
        JSON.stringify(data.attributes ?? {}),
      );

      node.classList.add("audit-format");

      return node;
    }

    static formats(node: HTMLElement) {
      return {
        groupId: node.getAttribute("data-group-id") ?? "",
        actorEmail: node.getAttribute("data-actor-email") ?? "",
        createdAt: node.getAttribute("data-created-at") ?? "",
        references: getJsonObject<Reference[]>(node, "data-references", []),
        attributes: getJsonObject<Record<string, any>>(
          node,
          "data-format-attributes",
          {},
        ),
      };
    }
  }

  class ReviewBase extends Inline {
    static blotName = "review-base";
    static tagName = "span";

    static create(data: ReviewBasePayload) {
      const node = super.create() as HTMLElement;
      setReviewBaseAttrs(node, data);

      /*
       * Metadata only. Do not make it clickable.
       */
      node.classList.add("review-base-metadata");

      return node;
    }

    static formats(node: HTMLElement) {
      return readReviewBaseAttrs(node);
    }
  }

  class AuditFormatActive extends Inline {
    static blotName = "format-inline-active";
    static tagName = "span";
    static className = "format-inline-activee";

    static create(value: boolean) {
      const node = super.create();
      if (value) {
        node.classList.add("format-inline-active");
      }
      return node;
    }

    static formats(node: HTMLElement) {
      return node.classList.contains("format-inline-active");
    }
  }

  const AuditBlockFormat = new Parchment.Attributor(
    "audit-block-format",
    "data-audit-block-format",
    {
      scope: Parchment.Scope.BLOCK,
    },
  );

  const ReviewBlockBaseAttributor = new Parchment.Attributor(
    "review-block-base",
    "data-review-block-base",
    {
      scope: Parchment.Scope.BLOCK,
    },
  );

  QuillModule.register(AuditInsert, true);
  QuillModule.register(AuditDelete, true);
  QuillModule.register(AuditDeleteSingleLine, true);
  QuillModule.register(AuditDeleteMultiLine, true);
  QuillModule.register(AuditFormat, true);
  QuillModule.register(ReviewBase, true);
  QuillModule.register(AuditFormatActive, true);
  QuillModule.register(AuditBlockFormat, true);
  QuillModule.register(ReviewBlockBaseAttributor, true);
}
