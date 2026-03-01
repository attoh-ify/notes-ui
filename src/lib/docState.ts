import { TextOperation } from "./textOperation";
import Delta from "quill-delta";

export interface OTLogEntry {
  seq: number;
  timestamp: string;
  event: "QUEUE" | "ACK" | "REMOTE";
  // before state
  sentOpBefore: string;
  pendingBefore: string;
  revisionBefore: number;
  // the incoming operation
  incomingDelta: string;
  incomingRevision: number;
  incomingActor: string;
  isAck: boolean;
  // transform details (only for REMOTE)
  transformedDelta: string;
  // after state
  sentOpAfter: string;
  pendingAfter: string;
  revisionAfter: number;
  // next send (if ACK promoted pending)
  nextSend: string;
}

function opsStr(delta: Delta | null | undefined): string {
  if (!delta || !delta.ops || delta.ops.length === 0) return "∅";
  return JSON.stringify(
    delta.ops.map((op: any) => {
      if (op.insert != null) return { ins: op.insert };
      if (op.delete != null) return { del: op.delete };
      if (op.retain != null) return { ret: op.retain };
      return op;
    }),
  );
}

export class DocState {
  public sentOperation: TextOperation | null = null;
  public pendingDelta: Delta = new Delta();
  public lastSyncedRevision: number = 0;
  public document: Delta = new Delta();
  public userId: string;
  public log: OTLogEntry[] = [];
  private seq: number = 0;

  constructor(userId: string) {
    this.userId = userId;
  }

  private nextSeq() {
    return ++this.seq;
  }

  private ts() {
    return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  }

  acknowledgeOperation(
    newRevision: number,
    onSend: (op: TextOperation | null) => void,
  ): void {
    const entry: OTLogEntry = {
      seq: this.nextSeq(),
      timestamp: this.ts(),
      event: "ACK",
      sentOpBefore: opsStr(this.sentOperation?.delta ?? null),
      pendingBefore: opsStr(this.pendingDelta),
      revisionBefore: this.lastSyncedRevision,
      incomingDelta: opsStr(this.sentOperation?.delta ?? null),
      incomingRevision: newRevision,
      incomingActor: this.userId,
      isAck: true,
      transformedDelta: "—",
      sentOpAfter: "",
      pendingAfter: "",
      revisionAfter: newRevision,
      nextSend: "—",
    };

    this.sentOperation = null;
    this.lastSyncedRevision = newRevision;

    if (this.pendingDelta.ops.length > 0) {
      this.sentOperation = new TextOperation(
        this.pendingDelta,
        this.userId,
        this.lastSyncedRevision,
      );
      this.pendingDelta = new Delta();
      entry.nextSend = opsStr(this.sentOperation.delta);
      onSend(this.sentOperation);
    } else {
      entry.nextSend = "—";
    }

    entry.sentOpAfter = opsStr(this.sentOperation?.delta ?? null);
    entry.pendingAfter = opsStr(this.pendingDelta);
    this.log.push(entry);
  }

  setDocument(doc: Delta): void {
    this.document = doc;
  }

  async queueOperation(
    delta: Delta,
    onSend: (operation: TextOperation) => Promise<void>,
  ): Promise<void> {
    const entry: OTLogEntry = {
      seq: this.nextSeq(),
      timestamp: this.ts(),
      event: "QUEUE",
      sentOpBefore: opsStr(this.sentOperation?.delta ?? null),
      pendingBefore: opsStr(this.pendingDelta),
      revisionBefore: this.lastSyncedRevision,
      incomingDelta: opsStr(delta),
      incomingRevision: this.lastSyncedRevision,
      incomingActor: this.userId,
      isAck: false,
      transformedDelta: "—",
      sentOpAfter: "",
      pendingAfter: "",
      revisionAfter: this.lastSyncedRevision,
      nextSend: "—",
    };

    this.document = this.document.compose(delta);

    if (this.sentOperation === null) {
      this.sentOperation = new TextOperation(
        delta,
        this.userId,
        this.lastSyncedRevision,
      );
      entry.nextSend = opsStr(this.sentOperation.delta);
      entry.sentOpAfter = opsStr(this.sentOperation.delta);
      entry.pendingAfter = opsStr(this.pendingDelta);
      this.log.push(entry);
      await onSend(this.sentOperation);
    } else {
      this.pendingDelta = this.pendingDelta.compose(delta);
      entry.sentOpAfter = opsStr(this.sentOperation.delta);
      entry.pendingAfter = opsStr(this.pendingDelta);
      this.log.push(entry);
    }
  }

  applyRemoteOperation(incomingOp: TextOperation): Delta {
    const entry: OTLogEntry = {
      seq: this.nextSeq(),
      timestamp: this.ts(),
      event: "REMOTE",
      sentOpBefore: opsStr(this.sentOperation?.delta ?? null),
      pendingBefore: opsStr(this.pendingDelta),
      revisionBefore: this.lastSyncedRevision,
      incomingDelta: opsStr(incomingOp.delta),
      incomingRevision: incomingOp.revision,
      incomingActor: incomingOp.actorId,
      isAck: false,
      transformedDelta: "",
      sentOpAfter: "",
      pendingAfter: "",
      revisionAfter: incomingOp.revision,
      nextSend: "—",
    };

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

    entry.transformedDelta = opsStr(serverDelta);
    entry.sentOpAfter = opsStr(this.sentOperation?.delta ?? null);
    entry.pendingAfter = opsStr(this.pendingDelta);
    this.log.push(entry);

    return serverDelta;
  }
}