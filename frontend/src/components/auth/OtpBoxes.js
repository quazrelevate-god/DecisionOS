/* The six-box code input (2026-09-19: moved out of Login.js).
 *
 * The sign-in page's Mobile OTP had it first; the signup step that confirms
 * the founder's mobile needs the same thing, and a code typed into two
 * different-looking inputs on two screens is one input too many. Paste fills
 * from the box it lands in; Backspace walks back; arrows move.
 *
 * B18 (2026-09-29) · THREE THINGS AN ANDROID KEYBOARD DOES DIFFERENTLY.
 *
 * 1. THE CODE IS NOT OFFERED. Android reads the SMS and offers the code above
 *    the keyboard — but only to a field that says it is expecting one.
 *    `autoComplete="one-time-code"` is that declaration, and nothing here had
 *    it, so every founder typed a code their phone had already read.
 * 2. BACKSPACE ON AN EMPTY BOX DID NOTHING. Gboard and Samsung's keyboard
 *    often report keyCode 229 / "Unidentified" for a composing key rather
 *    than "Backspace", so the keydown branch never ran. An empty box that is
 *    cleared reports it through `change` with an empty value — which this
 *    ignored outright (`if (!d) return`). It walks back from there too now,
 *    so the founder's thumb does the same thing on every keyboard.
 * 3. THE BOXES DID NOT SAY WHAT THEY WERE. Six unlabelled inputs read as six
 *    unrelated fields to a screen reader.
 *
 * 2026-10-08 · THE RIGHT CODE, TYPED, WAS SENT WRONG ("Incorrect OTP").
 * Founders typed the code from their SMS correctly and were told it was
 * wrong — reproduced on the sign-in page by typing 422812 into empty boxes:
 * the server received a different code and answered 401. Two causes:
 *   a. Each keystroke rebuilt the code from `digits`, a copy taken at the last
 *      render. A thumb (or a keyboard) delivering the next digit before React
 *      re-rendered wrote it onto that stale copy, so the digit before it was
 *      lost — and the six-digit auto-submit fired on a scrambled code.
 *   b. The code was stored with its gaps squeezed out (`["4","","2"]` became
 *      "42"), so a digit typed after an empty box slid into the wrong place.
 * The boxes now keep their own six cells, updated synchronously through a ref
 * on every keystroke (never from a render-time copy), and each cell keeps its
 * position. `value` from the parent still wins when it changes from outside
 * (a pasted code, the dev auto-fill, the screen clearing a refused code).
 */
import { useEffect, useRef, useState } from "react";

const toCells = (v) => String(v || "").replace(/\D/g, "").slice(0, 6).split("").concat(Array(6).fill("")).slice(0, 6);

export default function OtpBoxes({ value, onChange, disabled, testid = "otp-boxes" }) {
  const refs = useRef([]);
  const [cells, setCells] = useState(() => toCells(value));
  const cellsRef = useRef(cells);           // the latest cells, ahead of any render

  // The parent changed the code itself (paste handled upstream, dev auto-fill,
  // a refused code cleared): take it. Our own edits come back equal and are ignored.
  useEffect(() => {
    if ((value || "") !== cellsRef.current.join("")) {
      const c = toCells(value);
      cellsRef.current = c;
      setCells(c);
    }
  }, [value]);

  const commit = (next) => {
    cellsRef.current = next;
    setCells(next);
    onChange(next.join(""));
  };
  const setAt = (i, d) => {
    const next = cellsRef.current.slice();
    next[i] = d;
    commit(next);
  };

  const handleChange = (i) => (e) => {
    const cur = cellsRef.current;
    let d = e.target.value.replace(/\D/g, "");
    /* B18 — an empty value is a DELETION, and on the keyboards that do not
       send a Backspace keydown it is the only signal we get. */
    if (!d) {
      if (cur[i]) setAt(i, "");
      else if (i > 0) { setAt(i - 1, ""); refs.current[i - 1]?.focus(); }
      return;
    }
    // A digit typed into a box that already held one (the selection did not
    // take, as when focus moves fast): keep the NEW digit, not both.
    if (d.length === 2 && cur[i] && d.includes(cur[i])) d = d.replace(cur[i], "");
    if (d.length > 1) {
      // pasted / multi-char: fill from current box
      const chars = d.slice(0, 6 - i).split("");
      const next = cur.slice();
      chars.forEach((c, k) => { next[i + k] = c; });
      commit(next);
      const focusIdx = Math.min(i + chars.length, 5);
      refs.current[focusIdx]?.focus();
      return;
    }
    setAt(i, d);
    if (i < 5) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i) => (e) => {
    const cur = cellsRef.current;
    if (e.key === "Backspace") {
      e.preventDefault();               // the cells are ours; the input's own delete would race them
      if (cur[i]) setAt(i, "");
      else if (i > 0) { setAt(i - 1, ""); refs.current[i - 1]?.focus(); }
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
  };

  return (
    <div className="flex gap-2 justify-between" data-testid={testid}>
      {cells.map((d, i) => (
        <input
          key={`otp-${i}`}
          ref={(el) => (refs.current[i] = el)}
          data-testid={`otp-box-${i}`}
          inputMode="numeric"
          /* B18 — the SMS suggestion appears over the field that declares it.
             On the first box only: Android fills the whole code from there,
             and six fields all claiming the code confuses the offer. */
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1} of 6`}
          maxLength={6}
          autoFocus={i === 0}
          disabled={disabled}
          value={d}
          onChange={handleChange(i)}
          onKeyDown={handleKeyDown(i)}
          onFocus={(e) => e.target.select()}
          className="kr-pressed aspect-square w-full min-w-0 rounded-cardlg bg-transparent text-center text-xl font-medium focus:outline-none focus:ring-2 focus:ring-ring/30 disabled:opacity-50"
        />
      ))}
    </div>
  );
}
