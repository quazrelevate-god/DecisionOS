/* The one-time microphone notice (lib/micNotice.js), drawn once for the app. */
import { useEffect, useState } from "react";
import { Microphone } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { onMicNotice, answerMicNotice } from "../lib/micNotice";

export default function MicNoticeHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => onMicNotice(setOpen), []);
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) answerMicNotice(false); }}>
      <DialogContent
        className="max-w-sm gap-4 rounded-[1.75rem] border-0 bg-[hsl(226_24%_92%)] p-6 sm:rounded-[1.75rem]"
        data-testid="mic-notice">
        <Microphone size={28} weight="duotone" className="text-slate-700" aria-hidden="true" />
        <div>
          <DialogTitle className="text-lg font-semibold text-slate-900">Before you speak to Dex</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-slate-600">
            DecisionOS records your voice only while the mic is on. The recording is sent to a
            speech-to-text provider (Sarvam or OpenAI) to turn it into text, and the recording and its
            text are kept in your workspace, where your team can see what it becomes. You can type instead
            at any time.
          </DialogDescription>
        </div>
        <button type="button" onClick={() => answerMicNotice(true)} data-testid="mic-notice-yes"
          className="flex h-12 w-full items-center justify-center rounded-full bg-neutral-900 text-sm font-medium text-white">
          Use the microphone
        </button>
        <button type="button" onClick={() => answerMicNotice(false)} data-testid="mic-notice-no"
          className="text-center text-xs font-semibold text-slate-600 underline underline-offset-2">
          Not now
        </button>
      </DialogContent>
    </Dialog>
  );
}
