import { Deque } from "@/src/lib/deque";
import { TextOperation } from "./textOperation";
import Delta from "quill-delta";

export class DocState {
  public onDocumentChange: (newDoc: Delta) => void;
  public sentOperation: TextOperation | null;
  public pendingOperations: Deque;
  public lastSyncedRevision: number = 0;
  public document: Delta = new Delta();
  public prevDoc: Delta = new Delta();

  constructor(onDocumentChange: (newDoc: Delta) => void) {
    this.onDocumentChange = onDocumentChange;
    this.sentOperation = null; // operation sent to server but not yet acknowledged
    this.pendingOperations = new Deque(); // operations not yet sent to server
  }

  acknowledgeOperation(
    newRevision: number,
    onPendingOperation: (op: TextOperation | null) => void,
  ): void {
    // Remove sent operation
    this.sentOperation = null;
    this.lastSyncedRevision = newRevision;

    // Take out a pending operation
    if (!this.pendingOperations.isEmpty()) {
      this.sentOperation = this.pendingOperations.dequeueFront();
      onPendingOperation(this.sentOperation);
    }
  }

  setDocument(doc: Delta): void {
    this.prevDoc = this.document;
    this.document = doc;
  }

  async queueOperation(
    operation: TextOperation,
    composeNewDeltaToDocument: (currDoc: Delta) => Delta,
    onSend: (operation: TextOperation) => Promise<void>,
  ): Promise<void> {
    this.setDocument(composeNewDeltaToDocument(this.document));
    console.log(`[DOC] ${this.document.ops}`);

    if (this.sentOperation === null) {
      this.sentOperation = operation;
      console.log(
        `[SEND] sent operation = ${JSON.stringify(operation)}, lastSyncedRevision = ${operation.revision}`,
      );
      await onSend(operation);
    } else {
      console.log(
        `[ENQ] enqueued operation = ${JSON.stringify(operation)}, lastSyncedRevision = ${this.lastSyncedRevision}`,
      );
      this.pendingOperations.enqueueRear(operation);
    }
  }

  transformPendingOperations(incomingOp: TextOperation): void {
    const priority = incomingOp.actorId > (this.sentOperation?.actorId || "");
    
    if (incomingOp === null) {
      return;
    }

    this.pendingOperations.modifyWhere((localOp: TextOperation) => {
      const transformedDelta = incomingOp.delta.transform(localOp.delta, priority);
      return new TextOperation(transformedDelta, localOp.actorId, localOp.revision);
    });
  }

  transformOperationAgainstSentOperation(
    incomingOp: TextOperation,
  ): TextOperation {
    const priority = incomingOp.actorId > (this.sentOperation?.actorId || "");

    if (this.sentOperation === null) return incomingOp;

    const transformedDelta = incomingOp.delta.transform(this.sentOperation.delta, priority);
    return new TextOperation(transformedDelta, this.sentOperation.actorId, this.sentOperation.revision);
  }

  transformOperationAgainstLocalChanges(
    incomingOp: TextOperation,
  ): TextOperation {
    let serverDelta = incomingOp.delta;
    const priority = false;

    if (this.sentOperation !== null) {
      serverDelta = this.sentOperation.delta.transform(serverDelta, !priority)
    }

    this.pendingOperations.forEach((localOp: TextOperation) => {
      serverDelta = localOp.delta.transform(serverDelta, !priority)
    });

    return new TextOperation(serverDelta, incomingOp.actorId, incomingOp.revision);
  }
}
