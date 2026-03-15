import Delta from "quill-delta";

export enum OperationState {
  PENDING = "PENDING",
  COMMITTED = "COMMITTED",
  INVERSE = "INVERSE"
}

export class TextOperation {
  constructor(
    public delta: Delta,
    public actorEmail: string,
    public revision: number,
    public state: OperationState = OperationState.PENDING,
    public createdAt: string = new Date().toISOString(),
  ) {}
}