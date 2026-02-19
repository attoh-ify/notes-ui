import Delta from "quill-delta";


export class TextOperation {
    constructor(
        public delta : Delta,
        public actorId: string,
        public revision: number,
    ) {}
}
