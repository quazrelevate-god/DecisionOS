/* The pile that files itself (hero, three.js).
 *
 * A few hundred small cards tumble in a slow vortex behind the headline: every
 * decision, bill, approval and "tell Ravi" that lives in a founder's head. The
 * pointer pushes through them. As the first scene scrolls, page.js drives
 * `settle` from 0 to 1 and each card streams into its slot in a wall of neat
 * rows, the company's memory, and the black sheet lands in front of it.
 *
 * Colours are the brand's: card white and the silver canvas for most, ink for
 * some, gold for a few, the alert orange for one or two (the things slipping).
 * One InstancedMesh, so the whole field is a single draw call; the motion is
 * computed on the CPU each frame (a few hundred matrices is nothing).
 *
 * Reduced motion: one frame, rendered in the filed state, no loop.
 */
import * as THREE from "three";

const canvas = document.getElementById("wave");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = window.matchMedia("(pointer: coarse)").matches;
// The same breakpoint the stylesheet uses (a media query, not innerWidth, so a
// zoomed or emulated viewport still agrees with the layout).
const phone = window.matchMedia("(max-width: 900px)");
const small = () => phone.matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe9eaed, 6.5, 12.5);           // far cards fade into the canvas
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
camera.position.set(0, 0, 7.2);

/* Light: a warm key from the bloom's side, a white fill, a hemisphere of sky over
   a warm ground, so white cards read as paper in afternoon light. */
scene.add(new THREE.HemisphereLight(0xffffff, 0xf3c47a, 1.15));
const key = new THREE.DirectionalLight(0xffe3b0, 1.7); key.position.set(3.5, 4, 5); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.55); fill.position.set(-4, 1.5, 3); scene.add(fill);

/* The card: a rounded rectangle with a little thickness and a bevel, so edges catch light. */
function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}
const CARD_W = 0.40, CARD_H = 0.25;
const geometry = new THREE.ExtrudeGeometry(roundedRect(CARD_W, CARD_H, 0.05), {
  depth: 0.016, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 6,
});
geometry.center();
const material = new THREE.MeshStandardMaterial({ roughness: 0.58, metalness: 0.04 });

/* The field. */
const COLS = small() ? 6 : 12;
const ROWS = small() ? 22 : 22;
const N = COLS * ROWS;
const mesh = new THREE.InstancedMesh(geometry, material, N);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(mesh);

const palette = [
  { c: new THREE.Color("#ffffff"), w: 0.70 },
  { c: new THREE.Color("#e9eaed"), w: 0.12 },
  { c: new THREE.Color("#131315"), w: 0.10 },
  { c: new THREE.Color("#f1c24d"), w: 0.06 },
  { c: new THREE.Color("#ff6a1a"), w: 0.02 },
];
function pickColour(u) { let acc = 0; for (const p of palette) { acc += p.w; if (u <= acc) return p.c; } return palette[0].c; }

/* Deterministic randomness, so reloads look the same. */
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

const cards = [];
const SX = small() ? 0.46 : 0.46, SY = 0.30;
for (let i = 0; i < N; i++) {
  const col = i % COLS, row = Math.floor(i / COLS);
  const a = rnd() * Math.PI * 2, r = 0.45 + Math.pow(rnd(), 0.65) * (small() ? 1.6 : 1.85);
  cards.push({
    // The vortex: an angle, a radius, a height and a depth, each with its own drift.
    a, r, y: (rnd() - 0.5) * (small() ? 0.7 : 0.9), z: (rnd() - 0.5) * 1.6,
    spin: 0.08 + rnd() * 0.22, bob: rnd() * Math.PI * 2, bobAmp: 0.05 + rnd() * 0.12,
    tumble: new THREE.Euler(rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2),
    tumbleV: new THREE.Vector3((rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.4),
    scale: 0.75 + rnd() * 0.5,
    // The wall: its slot, with a hair of depth so faces never fight.
    gx: (col - (COLS - 1) / 2) * SX, gy: ((ROWS - 1) / 2 - row) * SY, gz: (rnd() - 0.5) * 0.03,
    order: rnd(),                                   // when it streams into place
    push: new THREE.Vector3(),                      // the pointer's shove, eased
    colour: pickColour(rnd()),
  });
  mesh.setColorAt(i, cards[i].colour);
}
mesh.instanceColor.needsUpdate = true;

/* Where the field sits in the frame: right of the copy on a laptop, centred and
   lower on a phone; the wall gathers toward the centre as it files. */
const cloudCentre = new THREE.Vector3(), wallCentre = new THREE.Vector3();
function fit() {
  // The layout viewport (what the stylesheet and the media queries see), sized
  // onto the canvas explicitly: the viewer's innerWidth can disagree with it.
  const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
  renderer.setSize(w, h, true);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (small()) { cloudCentre.set(0.1, -1.55, 0); wallCentre.set(0, -0.4, 0); }
  else { cloudCentre.set(2.75, -0.35, 0); wallCentre.set(0, -0.55, 0); }
}
fit();
window.addEventListener("resize", fit);

/* The pointer, as a point on the z = 0 plane. */
const raycaster = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2(9, 9), pointerWorld = new THREE.Vector3(99, 99, 0), pointerAim = new THREE.Vector3(99, 99, 0);
let pointerIn = false;
window.addEventListener("pointermove", (e) => {
  const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
  pointerIn = e.clientY < h * 1.1;
  ndc.set((e.clientX / w) * 2 - 1, -(e.clientY / h) * 2 + 1);
}, { passive: true });
window.addEventListener("pointerleave", () => { pointerIn = false; });

/* Driven by page.js. */
const state = { settle: 0, lift: 0 };
window.__wave = {
  setSettle(v) { state.settle = v; },
  setOffset(y) { state.lift = y; },
  setVisible(v) { canvas.style.opacity = v; },
  pause() { running = false; },
  resume() { if (!running && !reduced) { running = true; frame(); } },
};

const dummy = new THREE.Object3D(), qTumble = new THREE.Quaternion(), qFlat = new THREE.Quaternion();
const tmp = new THREE.Vector3(), d = new THREE.Vector3();
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const clock = new THREE.Clock();
let running = !reduced;

function update(t, dt) {
  // Pointer: aim at where the ray meets the plane, eased so the shove feels like air, not a cursor.
  if (pointerIn) { raycaster.setFromCamera(ndc, camera); raycaster.ray.intersectPlane(plane, pointerAim); }
  else pointerAim.set(99, 99, 0);
  pointerWorld.lerp(pointerAim, 0.1);
  const settle = state.settle;
  const centre = tmp.copy(cloudCentre).lerp(wallCentre, easeOut(settle));
  centre.y += state.lift * 0.6;
  const spinT = t * 0.12;
  const R = small() ? 0.9 : 1.15;
  const TILT = small() ? 0.28 : 0.42;

  for (let i = 0; i < N; i++) {
    const c = cards[i];
    // Each card files in its own moment, so the wall assembles as a stream, not a snap.
    const s = easeOut(THREE.MathUtils.clamp(settle * 1.35 - c.order * 0.35, 0, 1));
    // The vortex position at this instant.
    const ang = c.a + spinT * c.spin * (3 / (1 + c.r));
    // The orbit is a disc tilted toward the viewer: the far side rises, the near side dips.
    const vx = Math.cos(ang) * c.r, vz = Math.sin(ang) * c.r * 0.5 + c.z * 0.4;
    const vy = c.y - Math.sin(ang) * c.r * TILT + Math.sin(t * 0.7 + c.bob) * c.bobAmp;
    // Blend to the slot in the wall.
    const px = centre.x + THREE.MathUtils.lerp(vx, c.gx, s);
    const py = centre.y + THREE.MathUtils.lerp(vy, c.gy, s);
    const pz = THREE.MathUtils.lerp(vz, c.gz, s);
    // The pointer's shove: a soft radial push, strongest in the loose pile.
    d.set(px - pointerWorld.x, py - pointerWorld.y, 0);
    const dist = d.length();
    if (dist < R) { const f = (1 - dist / R) * 0.55 * (1 - s * 0.85); d.normalize().multiplyScalar(f); d.z = f * 0.9; c.push.lerp(d, 0.12); }
    else c.push.multiplyScalar(0.92);
    dummy.position.set(px + c.push.x, py + c.push.y, pz + c.push.z);
    // Tumble in the pile; face the viewer in the wall.
    c.tumble.x += c.tumbleV.x * dt * (1 - s); c.tumble.y += c.tumbleV.y * dt * (1 - s); c.tumble.z += c.tumbleV.z * dt * (1 - s);
    qTumble.setFromEuler(c.tumble);
    dummy.quaternion.copy(qTumble).slerp(qFlat, s);
    const sc = THREE.MathUtils.lerp(c.scale, 1, s);
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  // The whole field leans a little toward the pointer: depth felt, not shown.
  const lean = pointerIn ? ndc.x * 0.12 : 0;
  mesh.rotation.y += (lean - mesh.rotation.y) * 0.04;
}

function frame() {
  if (!running) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  update(clock.getElapsedTime(), dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
if (reduced) { state.settle = 1; update(2, 0.016); renderer.render(scene, camera); }
else frame();
document.addEventListener("visibilitychange", () => { if (!reduced) { running = !document.hidden; if (running) frame(); } });
