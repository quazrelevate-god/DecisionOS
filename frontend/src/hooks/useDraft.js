/* PILOT-1 A — useState that remembers. See lib/drafts.js for why and the rules.
 *
 *   const [text, setText, draft] = useDraft(`task-update:${taskId}`, "");
 *   const [f, setF, draft]       = useDraft("expense", EXPENSE_BLANK, { omit: ["file"] });
 *
 *   draft.restored  true when the form opened with words kept from before
 *   draft.discard() Post / Save / Cancel / Discard: forget it and empty the form
 *   draft.reload()  read the kept words again — for a form that is hidden
 *                   rather than unmounted when it closes (see below)
 *
 * `name` null keeps nothing, so a form can switch drafts off where it makes no
 * sense (an edit of an existing record, say) and still use the same code.
 * A value that is empty — blank text, or an object no different from the blank
 * form — is not a draft: it is removed rather than stored.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { clearDraft, draftScope, readDraft, writeDraft } from "../lib/drafts";

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const without = (v, omit) => {
  if (!isObj(v) || !omit.length) return v;
  const out = { ...v };
  omit.forEach((k) => { delete out[k]; });
  return out;
};
const same = (a, b) => {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
};
export const isBlankDraft = (v, initial, omit = []) => {
  if (v == null) return true;
  if (typeof v === "string") return !v.trim();
  return same(without(v, omit), without(initial, omit));
};

export function useDraft(name, initial, { omit = [] } = {}) {
  const { user, tenant } = useAuth();
  const scope = draftScope(tenant, user);
  const key = name && scope ? `${scope}|${name}` : null;

  const initialRef = useRef(initial);
  initialRef.current = initial;
  const omitRef = useRef(omit);
  omitRef.current = omit;

  const load = () => {
    const kept = name ? readDraft(scope, name) : null;
    if (kept == null) return { value: initialRef.current, restored: false };
    const value = isObj(initialRef.current) && isObj(kept) ? { ...initialRef.current, ...kept } : kept;
    return { value, restored: !isBlankDraft(value, initialRef.current, omitRef.current) };
  };

  const [state, setState] = useState(load);
  const valueRef = useRef(state.value);
  valueRef.current = state.value;

  // Another task, another company: read that one's draft instead.
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    const next = load();
    valueRef.current = next.value;
    setState(next);
    // load reads refs only; the key is what decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setValue = useCallback((next) => {
    const v = typeof next === "function" ? next(valueRef.current) : next;
    valueRef.current = v;
    if (name && scope) {
      if (isBlankDraft(v, initialRef.current, omitRef.current)) clearDraft(scope, name);
      else writeDraft(scope, name, without(v, omitRef.current));
    }
    setState((s) => ({ value: v, restored: s.restored && !isBlankDraft(v, initialRef.current, omitRef.current) }));
  }, [name, scope]);

  /* J14-01 (JOURNEY-1) — A DIALOG THAT NEVER UNMOUNTS NEVER LOOKED AGAIN.
     `restored` is decided once, when the component mounts. A screen like the
     Desk's Dex well remounts on every visit, so it re-reads and says "Kept
     from before". New Task does not: its dialog is mounted with the page and
     only hidden, so the words came back on the next open with nothing to say
     they had been kept — and a founder who meant to throw them away carried
     them around instead. A form that outlives its own closing calls this when
     it opens. */
  const reload = useCallback(() => {
    const next = load();
    valueRef.current = next.value;
    setState(next);
    // load reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, scope]);

  const discard = useCallback(() => {
    if (name && scope) clearDraft(scope, name);
    valueRef.current = initialRef.current;
    setState({ value: initialRef.current, restored: false });
  }, [name, scope]);

  return [state.value, setValue, { restored: state.restored, discard, reload }];
}

export default useDraft;
