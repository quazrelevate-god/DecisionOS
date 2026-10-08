/* What notifications are for, said before Android asks (2026-10-08).
 *
 * Play audit W3: permissions are to be requested in context, so people know
 * why. Without this the first thing after signing in was a bare system prompt
 * — "Allow DecisionOS to send you notifications?" — with no reason given.
 * "Turn on" hands over to the OS prompt; "Not now" asks again in a week
 * (lib/native/push.js). Android only: startPush never asks anywhere else.
 */
import { Bell } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";

export default function PushRationale({ onAnswer }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onAnswer(false); }}>
      <DialogContent
        className="max-w-sm gap-4 rounded-[1.75rem] border-0 bg-[hsl(226_24%_92%)] p-6 sm:rounded-[1.75rem]"
        data-testid="push-rationale">
        <Bell size={28} weight="duotone" className="text-slate-700" aria-hidden="true" />
        <div>
          <DialogTitle className="text-lg font-semibold text-slate-900">Know when work needs you</DialogTitle>
          <DialogDescription className="mt-2 text-sm leading-relaxed text-slate-600">
            DecisionOS can notify you when a task is assigned to you, something waits for your approval,
            or work you follow changes — even when the app is closed. No marketing, ever. You can turn it
            off any time in your phone&rsquo;s settings.
          </DialogDescription>
        </div>
        <button type="button" onClick={() => onAnswer(true)} data-testid="push-rationale-yes"
          className="flex h-12 w-full items-center justify-center rounded-full bg-neutral-900 text-sm font-medium text-white">
          Turn on notifications
        </button>
        <button type="button" onClick={() => onAnswer(false)} data-testid="push-rationale-no"
          className="text-center text-xs font-semibold text-slate-600 underline underline-offset-2">
          Not now
        </button>
      </DialogContent>
    </Dialog>
  );
}
