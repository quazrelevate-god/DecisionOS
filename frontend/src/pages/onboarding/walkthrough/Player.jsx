/* The shared clock maths and screen sizes for the tour's illustrations
 * (scenes.jsx), and Still — one frame of a scene at the screen's real size,
 * scaled to fit. The first-week tour (components/tour/FirstWeekTour) plays
 * them: the "at a glance" and cycle interludes, and the motion inside each
 * lens. A scene is a pure function of its progress p (0..1), so any instant
 * can be drawn on its own.
 */

export const SCREEN = { desktop: { w: 1440, h: 900 }, phone: { w: 390, h: 844 } };

export const ease = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3.2);
};
export const easeInOut = (t) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/* 0 before a, 1 after b, eased between. */
export const span = (p, a, b, f = ease) => (p <= a ? 0 : p >= b ? 1 : f((p - a) / (b - a)));
export const lerp = (a, b, t) => a + (b - a) * t;

/* One frame of a scene at the screen's real size, scaled to `fit`. */
export function Still({ scene, p, device, fit }) {
  const size = SCREEN[device];
  return (
    <div className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: size.w, height: size.h, transform: `scale(${fit})` }}>
      {scene?.render(p)}
    </div>
  );
}
