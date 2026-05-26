import { OperationState, TextOperation } from "./textOperation";
import Delta from "quill-delta";

function createOpId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function hasOps(delta: Delta): boolean {
  return Array.isArray(delta.ops) && delta.ops.length > 0;
}

function incomingHasPriority(
  incomingOp: TextOperation,
  localOp: TextOperation,
): boolean {
  if (incomingOp.actorEmail !== localOp.actorEmail) {
    return incomingOp.actorEmail > localOp.actorEmail;
  }

  return incomingOp.opId > localOp.opId;
}

export class DocState {
  public sentOperation: TextOperation | null = null;
  public pendingOperation: TextOperation | null = null;
  public lastSyncedRevision: number = 0;
  public document: Delta = new Delta();
  public userEmail: string;

  constructor(userEmail: string) {
    this.userEmail = userEmail;
  }

  acknowledgeOperation(
    newRevision: number,
    onSend: (op: TextOperation | null) => void,
  ): void {
    this.sentOperation = null;
    this.lastSyncedRevision = newRevision;

    if (this.pendingOperation) {
      this.sentOperation = new TextOperation(
        this.pendingOperation.opId,
        this.pendingOperation.delta,
        this.userEmail,
        this.lastSyncedRevision,
        OperationState.PENDING,
        this.pendingOperation.createdAt,
      );

      this.pendingOperation = null;
      onSend(this.sentOperation);
    }
  }

  setDocument(doc: Delta): void {
    this.document = doc;
  }

  resetPendingState(): void {
    this.sentOperation = null;
    this.pendingOperation = null;
  }

  async queueOperation(
    delta: Delta,
    send: (operation: TextOperation) => Promise<void>,
  ): Promise<void> {
    this.document = this.document.compose(delta);

    if (this.sentOperation === null) {
      this.sentOperation = new TextOperation(
        createOpId(),
        delta,
        this.userEmail,
        this.lastSyncedRevision,
        OperationState.PENDING,
        new Date().toISOString().slice(0, 19),
      );

      await send(this.sentOperation);
      return;
    }

    if (!this.pendingOperation) {
      this.pendingOperation = new TextOperation(
        createOpId(),
        delta,
        this.userEmail,
        this.lastSyncedRevision,
        OperationState.PENDING,
        new Date().toISOString().slice(0, 19),
      );

      return;
    }

    const composedDelta = this.pendingOperation.delta.compose(delta);

    this.pendingOperation = new TextOperation(
      this.pendingOperation.opId,
      composedDelta,
      this.pendingOperation.actorEmail,
      this.pendingOperation.revision,
      this.pendingOperation.state,
      this.pendingOperation.createdAt,
    );
  }

  applyRemoteOperation(incomingOp: TextOperation): Delta {
    let serverDelta = incomingOp.delta;

    if (this.sentOperation !== null) {
      const incomingWins = incomingHasPriority(
        incomingOp,
        this.sentOperation,
      );

      serverDelta = this.sentOperation.delta.transform(
        serverDelta,
        !incomingWins,
      );

      const transformedSentDelta = incomingOp.delta.transform(
        this.sentOperation.delta,
        incomingWins,
      );

      this.sentOperation = new TextOperation(
        this.sentOperation.opId,
        transformedSentDelta,
        this.sentOperation.actorEmail,
        this.sentOperation.revision,
        this.sentOperation.state,
        this.sentOperation.createdAt,
      );
    }

    if (this.pendingOperation && hasOps(this.pendingOperation.delta)) {
      const incomingWins = incomingHasPriority(
        incomingOp,
        this.pendingOperation,
      );

      const serverDeltaAfterSent = serverDelta;

      serverDelta = this.pendingOperation.delta.transform(
        serverDelta,
        !incomingWins,
      );

      const transformedPendingDelta = serverDeltaAfterSent.transform(
        this.pendingOperation.delta,
        incomingWins,
      );

      this.pendingOperation = new TextOperation(
        this.pendingOperation.opId,
        transformedPendingDelta,
        this.pendingOperation.actorEmail,
        this.pendingOperation.revision,
        this.pendingOperation.state,
        this.pendingOperation.createdAt,
      );
    }

    this.lastSyncedRevision = incomingOp.revision;
    this.document = this.document.compose(serverDelta);

    return serverDelta;
  }
}