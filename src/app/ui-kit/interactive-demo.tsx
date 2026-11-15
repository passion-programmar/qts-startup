"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/app/ui/button";
import { ConfirmDialog } from "@/app/ui/confirm-dialog";
import { Switch } from "@/app/ui/switch";

// The parts of the UI kit preview that react to clicks.
export function InteractiveDemo() {
  const [on, setOn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(0);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <Switch aria-label="Demo switch" checked={on} label={on ? "Active" : "Inactive"} onClick={() => setOn(!on)} tone="success" />
      <Switch aria-label="Saving switch" checked loading label="Saving..." />
      <Button
        loading={loading}
        onClick={() => {
          setLoading(true);
          setTimeout(() => setLoading(false), 1500);
        }}
      >
        {loading ? "Saving..." : "Click to load"}
      </Button>
      <ConfirmDialog
        confirmLabel="Delete"
        description="This only counts clicks on the preview page; nothing is deleted."
        onConfirm={() => setConfirmed((count) => count + 1)}
        title="Delete this candidate?"
        trigger="Delete"
        triggerIcon={<Trash2 aria-hidden="true" className="size-3.5" />}
        triggerVariant="secondary"
      />
      <span className="text-xs text-fg-muted">Confirmed {confirmed} times</span>
    </div>
  );
}
