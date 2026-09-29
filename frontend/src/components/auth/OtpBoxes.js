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
 */
import { useRef } from "react";

export default function OtpBoxes({ value, onChange, disabled, testid = "otp-boxes" }) {
  const refs = useRef([]);
  const digits = value.split("").concat(Array(6).fill("")).slice(0, 6);

  const setAt = (i, d) => {
    const next = digits.slice();
    next[i] = d;
    onChange(next.join("").replace(/\D/g, "").slice(0, 6));
  };

  const handleChange = (i) => (e) => {
    const d = e.target.value.replace(/\D/g, "");
    /* B18 — an empty value is a DELETION, and on the keyboards that do not
       send a Backspace keydown it is the only signal we get. */
    if (!d) {
      if (digits[i]) setAt(i, "");
      else if (i > 0) { setAt(i - 1, ""); refs.current[i - 1]?.focus(); }
      return;
    }
    if (d.length > 1) {
      // pasted / multi-char: fill from current box
      const chars = d.slice(0, 6 - i).split("");
      const next = digits.slice();
      chars.forEach((c, k) => { next[i + k] = c; });
      onChange(next.join("").replace(/\D/g, "").slice(0, 6));
      const focusIdx = Math.min(i + chars.length, 5);
      refs.current[focusIdx]?.focus();
      return;
    }
    setAt(i, d);
    if (i < 5) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i) => (e) => {
    if (e.key === "Backspace") {
      if (digits[i]) setAt(i, "");
      else if (i > 0) { setAt(i - 1, ""); refs.current[i - 1]?.focus(); }
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
  };

  return (
    <div className="flex gap-2 justify-between" data-testid={testid}>
      {digits.map((d, i) => (
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
