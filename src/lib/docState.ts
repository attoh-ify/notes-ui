import { Deque } from "@/src/lib/deque";
import { OperationTransformation } from "@/src/lib/operationTransformation";
import { TextOperation } from "./textOperation";

export class DocState {
  public onDocumentChange: (newDoc: string) => void;
  public sentOperation: TextOperation | null;
  public pendingOperations: Deque;
  public lastSyncedRevision: number = 0;
  public document: string = "";
  public prevText: string = "";

  constructor(onDocumentChange: (newDoc: string) => void) {
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

  setDocumentText(text: string): void {
    this.prevText = this.document;
    this.document = text;
  }

  async queueOperation(
    operation: TextOperation,
    newDocument: (currDoc: string) => string,
    onSend: (operation: TextOperation, revision: number) => Promise<void>,
  ): Promise<void> {
    this.setDocumentText(newDocument(this.document));
    console.log(`[DOC] ${this.document}`);

    if (this.sentOperation === null) {
      this.sentOperation = operation;
      console.log(
        `[SEND] sent operation = ${JSON.stringify(operation)}, lastSyncedRevision = ${operation.revision}`,
      );
      await onSend(operation, this.lastSyncedRevision);
    } else {
      console.log(
        `[ENQ] enqueued operation = ${JSON.stringify(operation)}, lastSyncedRevision = ${this.lastSyncedRevision}`,
      );
      this.pendingOperations.enqueueRear(operation);
    }
  }

  transformPendingOperations(op2: TextOperation): void {
    if (op2 === null) {
      return;
    }
    this.pendingOperations.modifyWhere((op1: TextOperation) =>
      OperationTransformation.transformOperation(op1, op2),
    );
  }

  transformOperationAgainstSentOperation(
    op1: TextOperation,
  ): TextOperation | TextOperation[] | null {
    if (this.sentOperation === null) return op1;
    const transformed = OperationTransformation.transformOperation(
      op1,
      this.sentOperation,
    );
    return transformed;
  }

  transformOperationAgainstLocalChanges(
    op1: TextOperation,
  ): TextOperation | TextOperation[] | null {
    let transformed: TextOperation | TextOperation[] | null = op1;

    if (this.sentOperation !== null) {
      transformed = OperationTransformation.transformOperation(
        op1,
        this.sentOperation,
      );
    }

    if (transformed === null) {
      return null;
    }

    let results: TextOperation[] = Array.isArray(transformed)
      ? transformed
      : [transformed];

    this.pendingOperations.forEach((op2: TextOperation) => {
      const newResult: TextOperation[] = [];

      for (const op of results) {
        const result = OperationTransformation.transformOperation(op, op2);

        if (result === null) {
          continue;
        } else if (Array.isArray(result)) {
          newResult.push(...result);
        } else {
          newResult.push(result);
        }
      }

      results = newResult;
    });

    if (results.length === 0) return null;
    if (results.length === 1) return results[0];
    return results;
  }
}
