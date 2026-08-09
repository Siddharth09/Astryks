"use client";

import { useState } from "react";

const REASONS = ["Spam", "Harassment or bullying", "Inappropriate content", "Fake account", "Other"];

export default function ReportModal({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string, details: string) => Promise<void>;
}) {
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (!open) return null;

  function reset() {
    setDone(false);
    setReason(REASONS[0]);
    setDetails("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(reason, details);
      setDone(true);
    } catch (err: any) {
      alert(err.message ?? "Couldn't submit the report.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={handleClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <>
            <h3 className="font-display font-semibold text-lg mb-2">Report submitted</h3>
            <p className="text-sm text-ink/60 mb-4">Thanks — our team will take a look.</p>
            <button onClick={handleClose} className="btn-primary w-full">
              Done
            </button>
          </>
        ) : (
          <>
            <h3 className="font-display font-semibold text-lg mb-3">Report</h3>
            <div className="space-y-2 mb-3">
              {REASONS.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="report-reason" checked={reason === r} onChange={() => setReason(r)} />
                  {r}
                </label>
              ))}
            </div>
            <textarea
              className="input mb-4 min-h-[70px]"
              placeholder="Add details (optional)"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
            <div className="flex gap-2">
              <button onClick={handleClose} className="btn-secondary flex-1">
                Cancel
              </button>
              <button onClick={handleSubmit} disabled={submitting} className="btn-primary flex-1">
                {submitting ? "Sending…" : "Submit"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
