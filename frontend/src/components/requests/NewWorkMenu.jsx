/* Requests (2026-10-21) — My Work's "+" asks what you are adding.
 *
 * It used to open New Task straight away. A request is the other thing a
 * person adds from their own list — "I need twenty bags of cement" sits next
 * to "I have to deliver to Bluewave" — so the "+" now asks: a task (work to
 * do) or a request (something you need, which goes for approval). The CRM's
 * Add-contact menu is the pattern (pages/CRM.js AddContactMenu): a Radix menu
 * of glass rows, each an icon, a name and a line saying what is behind it.
 *
 * Both dialogs are controlled from here. The chosen one opens a tick after the
 * menu has closed, so the menu handing focus back to its button does not fight
 * the dialog's focus trap (the same reason AddContactMenu waits).
 */
import { useState } from "react";
import { ListChecks, HandCoins } from "@phosphor-icons/react";
import { NewTaskDialog } from "../../pages/Tasks";
import { NewRequestDialog } from "./NewRequestDialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "../ui/dropdown-menu";
import { GLASS_MENU, GLASS_MENU_ITEM } from "../neuglass/glass";

export function NewWorkMenu({
  onTaskCreated, onTaskOpenChange, onRequestCreated, roleOptions, members, defaultType,
  triggerClassName, triggerChildren, triggerAriaLabel = "New task or request", testid = "new-work-button",
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  const pick = (which) => setTimeout(() => (which === "task" ? setTaskOpen(true) : setRequestOpen(true)), 0);
  const setTask = (o) => { setTaskOpen(o); onTaskOpenChange?.(o); };

  const item = (key, Icon, title, hint) => (
    <DropdownMenuItem key={key} data-testid={`new-work-${key}`} onSelect={() => pick(key)}
      className={`${GLASS_MENU_ITEM} items-start gap-3 px-3 py-2.5`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-900/[0.05] text-slate-700 ring-1 ring-inset ring-slate-900/[0.04]">
        <Icon size={18} weight="regular" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-slate-500">{hint}</span>
      </span>
    </DropdownMenuItem>
  );

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button type="button" data-testid={testid} aria-label={triggerAriaLabel} title={triggerAriaLabel}
            className={triggerClassName}>
            {triggerChildren}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} collisionPadding={12}
          className={`${GLASS_MENU} w-[min(20rem,calc(100vw-1.5rem))] p-1.5`} data-testid="new-work-menu">
          {item("task", ListChecks, "New task", "Work to do — for you or someone on your team")}
          {item("request", HandCoins, "New request", "Something you need — material, money, equipment. It goes for approval.")}
        </DropdownMenuContent>
      </DropdownMenu>
      <NewTaskDialog hideTrigger open={taskOpen} onOpenChange={setTask}
        onCreated={() => onTaskCreated?.()} roleOptions={roleOptions} members={members} defaultType={defaultType} />
      <NewRequestDialog open={requestOpen} onOpenChange={setRequestOpen} onCreated={onRequestCreated} />
    </>
  );
}
