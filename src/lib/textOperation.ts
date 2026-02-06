export type OperationType = "INS" | "DEL";

export class TextOperation {

    constructor(
        public opName: OperationType,
        public operand: string, 
        public position: number,
        public revision: number,
        public actorId: string
    ) {}
}
