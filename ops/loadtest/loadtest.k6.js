// S5-02 -- load test at target scale (k6).
//
// Simulates ~100 tenants doing the two hottest things at once: dashboard reads
// and voice-capture writes. This is the single test that most moves go-live
// confidence, so it asserts the SLO as pass/fail thresholds -- a failing run
// blocks the go/no-go (S5-10).
//
// Run against a STAGING deploy (S5-01), never production:
//   BASE_URL=https://staging.decisionos.app \
//   TENANTS=100 \
//   k6 run --vus 100 --duration 5m ops/loadtest/loadtest.k6.js
//
// Auth: this uses the demo login. Seed the staging DB with TENANTS demo owners
// (owner+N@demo.test / demo-pass) via a seed script before the run; each VU
// logs in as one of them so the load is spread across tenants, not one.
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:8001";
const TENANTS = parseInt(__ENV.TENANTS || "100", 10);
const PASSWORD = __ENV.DEMO_PASSWORD || "demo-pass";

const errorRate = new Rate("app_errors");
const captureLatency = new Trend("capture_latency", true);

export const options = {
  scenarios: {
    // steady dashboard + capture traffic across all tenants
    steady: { executor: "ramping-vus", startVUs: 0,
      stages: [{ duration: "1m", target: 100 }, { duration: "3m", target: 100 }, { duration: "1m", target: 0 }] },
    // a morning burst: everyone opens their desk at 9am
    burst: { executor: "ramping-vus", startVUs: 0, startTime: "2m",
      stages: [{ duration: "20s", target: 150 }, { duration: "40s", target: 0 }] },
  },
  thresholds: {
    // SLO pass bar (Testing-Plan phase D): p95 read latency and error budget.
    "http_req_duration{kind:read}": ["p(95)<500"],
    "http_req_duration{kind:capture}": ["p(95)<1500"],
    app_errors: ["rate<0.01"],       // < 1% app-level errors
    http_req_failed: ["rate<0.02"],  // < 2% transport failures
  },
};

function login(i) {
  const email = `owner+${i}@demo.test`;
  const res = http.post(`${BASE}/api/login`, JSON.stringify({ email, password: PASSWORD }),
    { headers: { "Content-Type": "application/json" }, tags: { kind: "auth" } });
  return check(res, { "login ok": (r) => r.status === 200 });
}

export default function () {
  const tenant = (__VU % TENANTS);
  if (!login(tenant)) { errorRate.add(1); sleep(1); return; }

  group("dashboard reads", () => {
    for (const path of ["/api/desk", "/api/operating-score", "/api/my-work", "/api/inbox"]) {
      const r = http.get(`${BASE}${path}`, { tags: { kind: "read" } });
      errorRate.add(r.status >= 500);
      check(r, { [`${path} < 500`]: (x) => x.status < 500 });
    }
  });

  group("voice capture (text path)", () => {
    const r = http.post(`${BASE}/api/voice-notes/text`,
      JSON.stringify({ text: "Follow up with the Kapoor order and confirm dispatch" }),
      { headers: { "Content-Type": "application/json" }, tags: { kind: "capture" } });
    captureLatency.add(r.timings.duration);
    errorRate.add(r.status >= 500);
    check(r, { "capture accepted": (x) => x.status < 500 });
  });

  sleep(Math.random() * 2 + 1); // 1-3s think time
}
