"use client";

import { Button, Modal } from "@/components/ui";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";

interface DeleteNoteModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onDelete: () => Promise<void>;
}

export default function DeleteNoteModal({ open, title, onClose, onDelete }: DeleteNoteModalProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  if (!open) return null;

  async function handleDelete() {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Modal
      title="Delete note"
      eyebrow="Destructive action"
      onClose={isDeleting ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isDeleting}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete} disabled={isDeleting}>{isDeleting ? "Deleting..." : "Delete note"}</Button>
        </>
      }
    >
      <div className="flex gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-black">This cannot be undone.</p>
          <p className="mt-1 text-sm leading-6">Are you sure you want to delete <span className="font-black underline">{title}</span>?</p>
        </div>
      </div>
    </Modal>
  );
}
