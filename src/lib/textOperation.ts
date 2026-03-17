import Delta from "quill-delta";

export enum OperationState {
  PENDING = "PENDING",
  COMMITTED = "COMMITTED"
}

export class TextOperation {
  constructor(
    public opId: string,
    public delta: Delta,
    public actorEmail: string,
    public revision: number,
    public state: OperationState = OperationState.PENDING,
    public createdAt: string = new Date().toISOString(),
  ) {}
}