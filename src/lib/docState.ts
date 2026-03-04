import { TextOperation } from "./textOperation";
import Delta from "quill-delta";

export class DocState {
  public sentOperation: TextOperation | null = null;
  public pendingDelta: Delta = new Delta();
  public lastSyncedRevision: number = 0;
  public document: Delta = new Delta();
  public userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  acknowledgeOperation(
    newRevision: number,
    onSend: (op: TextOperation | null) => void,
  ): void {

    this.sentOperation = null;
    this.lastSyncedRevision = newRevision;

    if (this.pendingDelta.ops.length > 0) {
      this.sentOperation = new TextOperation(
        this.pendingDelta,
        this.userId,
        this.lastSyncedRevision,
        new Date().toISOString().slice(0, 19)
      );
      this.pendingDelta = new Delta();
      onSend(this.sentOperation);
    }
  }

  setDocument(doc: Delta): void {
    this.document = doc;
  }

  async queueOperation(
    delta: Delta,
    onSend: (operation: TextOperation) => Promise<void>,
  ): Promise<void> {
    this.document = this.document.compose(delta);

    if (this.sentOperation === null) {
      this.sentOperation = new TextOperation(
        delta,
        this.userId,
        this.lastSyncedRevision,
        new Date().toISOString().slice(0, 19)
      );
      await onSend(this.sentOperation);
    } else {
      this.pendingDelta = this.pendingDelta.compose(delta);
    }
  }

  applyRemoteOperation(incomingOp: TextOperation): Delta {
    let serverDelta = incomingOp.delta;

    if (this.sentOperation !== null) {
      const incomingWins = incomingOp.actorId > this.sentOperation.actorId;

      serverDelta = this.sentOperation.delta.transform(
        serverDelta,
        !incomingWins,
      );

      this.sentOperation = new TextOperation(
        incomingOp.delta.transform(this.sentOperation.delta, incomingWins),
        this.sentOperation.actorId,
        this.sentOperation.revision,
        this.sentOperation.createdAt
      );
    }

    if (this.pendingDelta.ops.length > 0) {
      const incomingWins = incomingOp.actorId > this.userId;
      const serverDeltaAfterSent = serverDelta;

      serverDelta = this.pendingDelta.transform(serverDelta, !incomingWins);
      this.pendingDelta = serverDeltaAfterSent.transform(
        this.pendingDelta,
        incomingWins,
      );
    }

    this.lastSyncedRevision = incomingOp.revision;
    this.document = this.document.compose(serverDelta);

    return serverDelta;
  }
}