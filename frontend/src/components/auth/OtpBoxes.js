/* The six-box code input (2026-09-19: moved out of Login.js).
 *
 * The sign-in page's Mobile OTP had it first; the signup step that confirms
 * the founder's mobile needs the same thing, and a code typed into two
 * different-looking inputs on two screens is one input too many. Paste fills
 * from the box it lands in; Backspace walks back; arrows move.
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
    if (!d) return;
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
