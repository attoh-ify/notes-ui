import { TextOperation } from "./textOperation";

export class DequeNode {
  val: TextOperation;
  prev: DequeNode | null;
  next: DequeNode | null;

  constructor(val: TextOperation) {
    this.val = val;
    this.next = null;
    this.prev = null;
  }
}

export class Deque {
  front: DequeNode | null = null;
  rear: DequeNode | null = null;

  enqueueFront(element: TextOperation): void {
    const newNode = new DequeNode(element);
    if (this.isEmpty()) {
      this.front = this.rear = newNode;
    } else {
      newNode.next = this.front;
      this.front!.prev = newNode;
      this.front = newNode;
    }
  }

  enqueueRear(element: TextOperation): void {
    const newNode = new DequeNode(element);
    if (this.isEmpty()) {
      this.front = this.rear = newNode;
    } else {
      newNode.prev = this.rear;
      this.rear!.next = newNode;
      this.rear = newNode;
    }
  }

  dequeueFront(): TextOperation | null {
    if (!this.front) return null;
    const toRemove = this.front;
    this.front = toRemove.next;
    if (this.front) {
      this.front.prev = null;
    } else {
      this.rear = null;
    }
    return toRemove.val;
  }

  isEmpty(): boolean {
    return this.front === null;
  }

  modifyWhere(
    replaceWith: (op: TextOperation) => null | TextOperation | TextOperation[],
  ): void {
    let ptr = this.front; // Start from FRONT (oldest) to transform in order

    while (ptr !== null) {
      const replacement = replaceWith(ptr.val);
      const nextPtr = ptr.next; // Save next pointer before modifications
      const prevNode = ptr.prev;
      const nextNode = ptr.next;

      if (replacement === null) {
        // Delete node
        if (prevNode) {
          prevNode.next = nextNode;
        } else {
          this.front = nextNode; // Deleting front
        }

        if (nextNode) {
          nextNode.prev = prevNode;
        } else {
          this.rear = prevNode; // Deleting rear
        }
      } else if (Array.isArray(replacement)) {
        if (replacement.length === 0) {
          // Treat empty array as deletion
          if (prevNode) {
            prevNode.next = nextNode;
          } else {
            this.front = nextNode;
          }

          if (nextNode) {
            nextNode.prev = prevNode;
          } else {
            this.rear = prevNode;
          }
        } else {
          // Build chain in correct order
          const nodes: DequeNode[] = replacement.map((op) => new DequeNode(op));
          
          // Link the nodes together
          for (let i = 0; i < nodes.length - 1; i++) {
            nodes[i].next = nodes[i + 1];
            nodes[i + 1].prev = nodes[i];
          }

          const firstNewNode = nodes[0];
          const lastNewNode = nodes[nodes.length - 1];

          // Stitch the new chain into the deque
          firstNewNode.prev = prevNode;
          lastNewNode.next = nextNode;

          if (prevNode) {
            prevNode.next = firstNewNode;
          } else {
            this.front = firstNewNode; // Replacing front
          }

          if (nextNode) {
            nextNode.prev = lastNewNode;
          } else {
            this.rear = lastNewNode; // Replacing rear
          }
        }
      } else {
        // Simple 1-to-1 replacement
        ptr.val = replacement;
      }

      ptr = nextPtr; // Move to next node (toward rear)
    }
  }

  forEach(callback: (op: TextOperation) => void): void {
    let ptr = this.front;
    while (ptr !== null) {
      callback(ptr.val);
      ptr = ptr.next; // Move toward rear (not prev!)
    }
  }
}