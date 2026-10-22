/* The founder, in dots (hero, three.js).
 *
 * A businessman built from ~25,000 points on simple solids (head, neck,
 * shoulders, chest, arms, hands) seen over his shoulder from behind and above,
 * the camera on the phone in his hands. The phone's screen is not drawn here:
 * the real app runs in an HTML element (#hero-phone) that this module keeps
 * glued to the 3D phone's screen with a CSS matrix3d, so it takes the same
 * perspective as the dots. On scroll (page.js drives `setProgress`) the camera
 * dollies down the screen's normal until the phone faces us and fills the frame.
 *
 * Colours: ink dots, lit gold where the phone's glow reaches (hands, chest,
 * chin) and silver where the top light lands. The pointer orbits the camera a
 * few degrees at rest. Reduced motion: one frame at rest, no loop.
 */
import * as THREE from "three";

const canvas = document.getElementById("figure");
const phoneEl = document.getElementById("hero-phone");
const host = canvas.parentElement;
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30);

/* ── The phone in his hands: where it is and which way it faces ──────────── */
const P = new THREE.Vector3(0.02, 1.22, 0.36);                 // screen centre
const U = new THREE.Vector3(0, 0.68, 0.73).normalize();        // long axis, top away from the body
const N = new THREE.Vector3(0, 0.73, -0.68).normalize();       // screen normal, toward his face
const V = new THREE.Vector3().crossVectors(U, N).normalize();  // screen's right
const HW = 0.0375, HH = 0.0815;                                // half width / height, metres

/* ── Sampling the man ─────────────────────────────────────────────────────── */
let seed = 3;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pts = [], nrm = [];
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
function sphere(c, r, n, yMin = -Infinity) {
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const d = v3(s * Math.cos(t), u, s * Math.sin(t));
    const p = d.clone().multiplyScalar(r).add(c);
    if (p.y < yMin) continue;
    pts.push(p); nrm.push(d);
  }
}
function ellipsoid(c, rx, ry, rz, n, yMin = -Infinity) {
  for (let i = 0; i < n; i++) {
    const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const d = v3(s * Math.cos(t), u, s * Math.sin(t));
    const p = v3(c.x + d.x * rx, c.y + d.y * ry, c.z + d.z * rz);
    if (p.y < yMin) continue;
    pts.push(p); nrm.push(v3(d.x / rx, d.y / ry, d.z / rz).normalize());
  }
}
function capsule(a, b, r, n) {
  const axis = b.clone().sub(a), L = axis.length(); axis.normalize();
  const side = Math.abs(axis.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0);
  const e1 = v3().crossVectors(axis, side).normalize(), e2 = v3().crossVectors(axis, e1);
  for (let i = 0; i < n; i++) {
    const t = rnd() * L, ang = rnd() * Math.PI * 2;
    const d = e1.clone().multiplyScalar(Math.cos(ang)).add(e2.clone().multiplyScalar(Math.sin(ang)));
    pts.push(a.clone().add(axis.clone().multiplyScalar(t)).add(d.clone().multiplyScalar(r))); nrm.push(d);
  }
  sphere(a, r, Math.round(n * 0.18)); sphere(b, r, Math.round(n * 0.18));
}
// Head, hair, neck, shoulders, chest, waist (fading out), arms, hands.
sphere(v3(0, 1.665, 0), 0.112, 5200);
ellipsoid(v3(0, 1.69, -0.015), 0.12, 0.105, 0.125, 5200, 1.64);
capsule(v3(0, 1.5, 0.01), v3(0, 1.585, 0), 0.05, 500);
capsule(v3(-0.215, 1.465, 0), v3(0.215, 1.465, 0), 0.072, 2200);
ellipsoid(v3(0, 1.29, 0.0), 0.2, 0.2, 0.115, 5200);
ellipsoid(v3(0, 1.04, 0.0), 0.17, 0.15, 0.1, 2400, 0.94);
for (const s of [-1, 1]) {
  capsule(v3(s * 0.235, 1.44, 0), v3(s * 0.225, 1.19, 0.1), 0.05, 1300);
  capsule(v3(s * 0.225, 1.19, 0.1), v3(s * 0.08, 1.2, 0.33), 0.045, 1100);
  ellipsoid(v3(s * 0.062, 1.205, 0.365), 0.045, 0.06, 0.028, 700);
}
// The phone's rim: a band of dots just outside the screen, in its plane.
for (let i = 0; i < 1400; i++) {
  const side = Math.floor(rnd() * 4), t = rnd() * 2 - 1, off = 1.02 + rnd() * 0.08;
  const a = side < 2 ? v3().addScaledVector(U, (side ? -1 : 1) * HH * off).addScaledVector(V, t * HW * off)
                     : v3().addScaledVector(V, (side === 2 ? -1 : 1) * HW * off).addScaledVector(U, t * HH * off);
  pts.push(a.add(P).addScaledVector(N, -0.004 - rnd() * 0.006)); nrm.push(N.clone().negate());
}

/* ── Colour and size ──────────────────────────────────────────────────────── */
const INK = new THREE.Color("hsl(240, 4%, 13%)"), GOLD = new THREE.Color("hsl(44, 88%, 60%)"), SILVER = new THREE.Color("hsl(225, 7%, 78%)");
const top = v3(-0.35, 1, -0.25).normalize();
const n = pts.length;
const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), siz = new Float32Array(n), pha = new Float32Array(n);
const c = new THREE.Color();
for (let i = 0; i < n; i++) {
  const p = pts[i], d = p.distanceTo(P);
  const glow = THREE.MathUtils.smoothstep(0.42 - d, 0, 0.34);           // the phone lights what is near it
  const rim = Math.max(0, nrm[i].dot(top)) * 0.55;                         // the top light
  c.copy(INK).lerp(SILVER, rim * rim).lerp(GOLD, glow * (0.35 + 0.65 * Math.max(0, nrm[i].dot(N))));
  pos.set([p.x, p.y, p.z], i * 3); col.set([c.r, c.g, c.b], i * 3);
  siz[i] = 2.1 + rnd() * 1.6 + glow * 0.8; pha[i] = rnd() * Math.PI * 2;
}
const geo = new THREE.BufferGeometry();
geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
geo.setAttribute("aSize", new THREE.BufferAttribute(siz, 1));
geo.setAttribute("aPhase", new THREE.BufferAttribute(pha, 1));
const mat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: { value: 0 }, uPR: { value: renderer.getPixelRatio() }, uFade: { value: 0.95 } },
  vertexShader: `
    attribute vec3 aColor; attribute float aSize; attribute float aPhase;
    uniform float uTime, uPR, uFade; varying vec3 vColor; varying float vAlpha;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float d = -mv.z;
      gl_PointSize = aSize * uPR * clamp(1.5 / d, 0.55, 3.2) * (0.9 + 0.1 * sin(uTime * 1.4 + aPhase));
      vAlpha = smoothstep(0.1, 0.32, d) * uFade;
      vColor = aColor;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying vec3 vColor; varying float vAlpha;
    void main() {
      float r = length(gl_PointCoord - 0.5);
      if (r > 0.5) discard;
      gl_FragColor = vec4(vColor, smoothstep(0.5, 0.32, r) * vAlpha);
    }`,
});
scene.add(new THREE.Points(geo, mat));

/* ── The camera: over the shoulder at rest, on the screen when zoomed ─────── */
const REST = { pos: v3(0.62, 2.32, -1.02), target: v3(0.38, 1.28, 0.3), up: v3(0, 1, 0) };   // over his right shoulder, the figure right of the copy
const ZOOM = { pos: P.clone().addScaledVector(N, 0.36), target: P.clone(), up: U.clone() };
const state = { progress: 0, live: true, yaw: 0, pitch: 0, yawAim: 0, pitchAim: 0 };
const pose = { pos: v3(), target: v3(), up: v3() };
const ease = (x) => x * x * (3 - 2 * x);
function placeCamera() {
  const k = ease(THREE.MathUtils.clamp(state.progress, 0, 1));
  pose.pos.lerpVectors(REST.pos, ZOOM.pos, k);
  pose.target.lerpVectors(REST.target, ZOOM.target, k);
  pose.up.lerpVectors(REST.up, ZOOM.up, k).normalize();
  // The pointer's orbit, strongest at rest.
  const orbit = (1 - k) * 1 + k * 0.15;
  const off = pose.pos.clone().sub(pose.target);
  off.applyAxisAngle(v3(0, 1, 0), state.yaw * orbit);
  const right = v3().crossVectors(off, pose.up).normalize();
  off.applyAxisAngle(right, state.pitch * orbit);
  camera.position.copy(pose.target).add(off);
  camera.up.copy(pose.up);
  camera.lookAt(pose.target);
}

/* ── Gluing the HTML phone to the 3D screen ───────────────────────────────── */
const corners = [
  P.clone().addScaledVector(U, HH).addScaledVector(V, -HW),   // top-left
  P.clone().addScaledVector(U, HH).addScaledVector(V, HW),    // top-right
  P.clone().addScaledVector(U, -HH).addScaledVector(V, HW),   // bottom-right
  P.clone().addScaledVector(U, -HH).addScaledVector(V, -HW),  // bottom-left
];
function solve8(A, b) { // Gaussian elimination with partial pivoting, 8 unknowns
  const m = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 8; c++) {
    let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    const d = m[c][c] || 1e-9;
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = m[r][c] / d; for (let k = c; k <= 8; k++) m[r][k] -= f * m[c][k]; }
  }
  return m.map((row, i) => row[8] / (row[i] || 1e-9));
}
function matrix3d(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [X, Y] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
  }
  const h = solve8(A, b);
  return `matrix3d(${h[0]},${h[3]},0,${h[6]},${h[1]},${h[4]},0,${h[7]},0,0,1,0,${h[2]},${h[5]},0,1)`;
}
const tmp = v3();
let W = 0, H = 0;
function gluePhone() {
  const pw = phoneEl.offsetWidth, ph = phoneEl.offsetHeight;
  if (!pw || !ph) return;
  const dst = [];
  for (const cnr of corners) {
    tmp.copy(cnr).project(camera);
    if (tmp.z > 1) { phoneEl.style.visibility = "hidden"; return; }
    dst.push([(tmp.x * 0.5 + 0.5) * W, (-tmp.y * 0.5 + 0.5) * H]);
  }
  phoneEl.style.visibility = "";
  phoneEl.style.transform = matrix3d([[0, 0], [pw, 0], [pw, ph], [0, ph]], dst);
}

/* ── Size, pointer, loop ──────────────────────────────────────────────────── */
function fit() {
  W = host.clientWidth; H = host.clientHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  draw();
}
window.addEventListener("resize", fit);
window.addEventListener("pointermove", (e) => {
  if (!state.live) return;
  state.yawAim = -((e.clientX / W) * 2 - 1) * 0.07;
  state.pitchAim = ((e.clientY / H) * 2 - 1) * 0.035;
}, { passive: true });

const clock = new THREE.Clock();
let running = false;
function draw() {
  state.yaw += (state.yawAim - state.yaw) * 0.06;
  state.pitch += (state.pitchAim - state.pitch) * 0.06;
  placeCamera();
  mat.uniforms.uTime.value = clock.getElapsedTime();
  mat.uniforms.uFade.value = 0.95 - 0.4 * ease(THREE.MathUtils.clamp(state.progress, 0, 1));
  renderer.render(scene, camera);
  gluePhone();
}
function frame() { if (!running) return; draw(); requestAnimationFrame(frame); }

window.__figure = {
  setProgress(p) { state.progress = p; if (!running) draw(); },
  setLive(v) { state.live = v; if (!v) { state.yawAim = 0; state.pitchAim = 0; } },
  pause() { running = false; },
  setRest(pos, target) { if (pos) REST.pos.set(...pos); if (target) REST.target.set(...target); draw(); },
  resume() { if (!running && !reduced) { running = true; frame(); } },
};
fit();
if (!reduced) { running = true; frame(); }
document.addEventListener("visibilitychange", () => { if (!reduced) { running = !document.hidden; if (running) frame(); } });
