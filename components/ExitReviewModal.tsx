"use client";

import { Button, Modal } from "@/components/ui";

interface ExitReviewModalProps {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  exitReview: () => void;
}

export default function ExitReviewModal({ open, onClose, onSave, exitReview }: ExitReviewModalProps) {
  if (!open) return null;

  return (
    <Modal title="Exit review" eyebrow="Review mode" onClose={onClose} widthClass="max-w-md">
      <div className="space-y-4">
        <p className="text-sm leading-6 text-slate-500">What would you like to do with the changes you&apos;ve reviewed so far?</p>
        <div className="grid gap-2">
          <Button onClick={() => { onClose(); onSave(); }}>Save changes &amp; exit</Button>
          <Button variant="secondary" onClick={() => { onClose(); exitReview(); }}>Exit without saving</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
