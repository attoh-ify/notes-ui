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
    userId: string,
    onPendingOperation: (op: TextOperation | null) => void,
  ): void {
    // Remove sent operation
    this.sentOperation = null;
    this.lastSyncedRevision = newRevision;

    // Take out a pending operation
    if (!this.pendingOperations.isEmpty()) {
      let composedDelta = new Delta();
      while (!this.pendingOperations.isEmpty()) {
        const op = this.pendingOperations.dequeueFront();
        composedDelta = composedDelta.compose(op!.delta);
      }
      this.sentOperation = new TextOperation(
        composedDelta, userId, this.lastSyncedRevision
      );
      onPendingOperation(this.sentOperation);
    }
  }

  setDocument(doc: Delta): void {
    this.prevDoc = this.document;
    this.document = doc;
  }

  async queueOperation(
    delta: Delta,
    userId: string,
    composeNewDeltaToDocument: (currDoc: Delta) => Delta,
    onSend: (operation: TextOperation) => Promise<void>,
  ): Promise<void> {
    this.setDocument(composeNewDeltaToDocument(this.document));
    console.log(`[DOC] ${this.document.ops}`);

    const operation = new TextOperation(
      delta, userId, this.lastSyncedRevision
    )

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
    this.lastSyncedRevision = incomingOp.revision;

    if (this.sentOperation !== null) {
      const priority = incomingOp.actorId > this.sentOperation.actorId;
      this.sentOperation = new TextOperation(
        incomingOp.delta.transform(this.sentOperation.delta, priority),
        this.sentOperation.actorId,
        this.sentOperation.revision,
      );
    }

    this.pendingOperations.modifyWhere((localOp: TextOperation) => {
      const priority = incomingOp.actorId > localOp.actorId;
      const transformedDelta = incomingOp.delta.transform(
        localOp.delta,
        priority,
      );

      return new TextOperation(
        transformedDelta,
        localOp.actorId,
        localOp.revision,
      );
    });
  }

  transformOperationAgainstSentOperation(
    incomingOp: TextOperation,
  ): TextOperation {
    const priority = incomingOp.actorId > (this.sentOperation?.actorId || "");

    if (this.sentOperation === null) return incomingOp;

    const transformedDelta = incomingOp.delta.transform(
      this.sentOperation.delta,
      priority,
    );
    return new TextOperation(
      transformedDelta,
      this.sentOperation.actorId,
      this.sentOperation.revision,
    );
  }

  transformOperationAgainstLocalChanges(
    incomingOp: TextOperation,
  ): TextOperation {
    let serverDelta = incomingOp.delta;

    if (this.sentOperation !== null) {
      const priority = incomingOp.actorId > this.sentOperation.actorId;
      serverDelta = this.sentOperation.delta.transform(serverDelta, !priority);
    }

    this.pendingOperations.forEach((localOp: TextOperation) => {
      const priority = incomingOp.actorId > localOp.actorId;
      serverDelta = localOp.delta.transform(serverDelta, !priority);
    });

    return new TextOperation(
      serverDelta,
      incomingOp.actorId,
      incomingOp.revision,
    );
  }
}
