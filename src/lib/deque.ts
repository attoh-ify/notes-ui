import { TextOperation } from "./textOperation";

/**
 * Represents a single node in the Double-Ended Queue (Deque).
 * Each node contains a TextOperation and pointers to its neighbors.
 */
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

/**
 * A Double-Ended Queue (Deque) implemented as a Doubly Linked List.
 * In the context of OT, 'front' represents the oldest operations (closest to the last sync)
 * and 'rear' represents the newest local operations.
 */
export class Deque {
  front: DequeNode | null = null;
  rear: DequeNode | null = null;

  /**
   * Adds an operation to the beginning of the queue.
   * Useful for re-injecting acknowledged operations or prioritizing specific transforms.
   */
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

  /**
   * Adds an operation to the end of the queue.
   * This is the standard method for capturing new local changes.
   */
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

  /**
   * Removes and returns the oldest operation from the front of the queue.
   * Typically used when an operation is confirmed/acknowledged by the server.
   */
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

  /**
   * Checks if the queue contains any operations.
   */
  isEmpty(): boolean {
    return this.front === null;
  }

  /**
   * The core OT transformation engine.
   * Iterates through the queue and allows each operation to be modified, deleted, or split
   * based on a transformation function.
   * * @param replaceWith A callback that takes a TextOperation and returns:
   * - `null` or `[]`: To remove the operation from the queue.
   * - `TextOperation`: To update the operation in place.
   * - `TextOperation[]`: To replace one operation with multiple (splitting).
   */
  modifyWhere(
    replaceWith: (op: TextOperation) => TextOperation,
  ): void {
    let ptr = this.front; // Start from oldest to transform in chronological order

    while (ptr !== null) {
      const replacement = replaceWith(ptr.val);
      const nextPtr = ptr.next; // Store next before we potentially orphan this node
      const prevNode = ptr.prev;
      const nextNode = ptr.next;

      if (replacement === null) {
        // CASE: Remove the current node and stitch the neighbors together
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
      } else if (Array.isArray(replacement)) {
        // CASE: Splitting one operation into multiple (e.g., a delete split by an insert)
        if (replacement.length === 0) {
          // Empty array behaves like deletion
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
          // Convert the operation array into a chain of DequeNodes
          const nodes: DequeNode[] = replacement.map((op) => new DequeNode(op));
          
          // Link the new internal nodes together
          for (let i = 0; i < nodes.length - 1; i++) {
            nodes[i].next = nodes[i + 1];
            nodes[i + 1].prev = nodes[i];
          }

          const firstNewNode = nodes[0];
          const lastNewNode = nodes[nodes.length - 1];

          // Stitch the new sub-chain into the existing list
          firstNewNode.prev = prevNode;
          lastNewNode.next = nextNode;

          if (prevNode) {
            prevNode.next = firstNewNode;
          } else {
            this.front = firstNewNode; // Replaced the head
          }

          if (nextNode) {
            nextNode.prev = lastNewNode;
          } else {
            this.rear = lastNewNode; // Replaced the tail
          }
        }
      } else {
        // CASE: Standard 1-to-1 transformation (e.g., shifting an index)
        ptr.val = replacement;
      }

      ptr = nextPtr; // Continue toward the newest operations
    }
  }

  /**
   * Executes a callback function on every operation in the queue, 
   * starting from the oldest (front) to the newest (rear).
   */
  forEach(callback: (op: TextOperation) => void): void {
    let ptr = this.front;
    while (ptr !== null) {
      callback(ptr.val);
      ptr = ptr.next;
    }
  }
}