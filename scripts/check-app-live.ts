import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.env["APP_ORIGIN"]!;
const credentials = await readFile("demo-credentials.local", "utf8");
const pairs = [
  ...credentials.matchAll(/([^\s]+@msl\.demo) \((doctor|hospital)\)\nPassword: ([^\n]+)/g),
];
async function login(pair: RegExpMatchArray) {
  const response = await fetch(base + "/api/app", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "sign_in",
      role: pair[2],
      input: { email: pair[1], role: pair[2], password: pair[3] },
    }),
  });
  assert.equal(response.status, 200, "App login failed");
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  assert.ok(cookie);
  return cookie;
}
const unsigned = await fetch(base + "/api/app?action=doctor");
assert.equal(unsigned.status, 401);
const doctor = await login(pairs.find((p) => p[1] === "rao@msl.demo")!);
const get = async (path: string, cookie: string) => {
  const response = await fetch(base + path, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200, `Read failed: ${path}`);
  return response.json();
};
const data = await get("/api/app?action=doctor", doctor);
assert.equal(data.full_name, "Dr. Ananya Rao");
const profile = await get("/api/app?action=profile", doctor);
assert.equal(profile.status, "succeeded");
const library = await get("/api/app?action=newsletters", doctor);
assert.deepEqual(library, []);
const staff = await login(pairs.find((p) => p[2] === "hospital")!);
const directory = await get("/api/hospital", staff);
assert.equal(directory.mode, "connected");
assert.equal(directory.doctors.length, 2);
const staffDoctorRead = await fetch(base + "/api/app?action=doctor", {
  headers: { Cookie: staff },
});
assert.equal(staffDoctorRead.status, 401);
const crossOrigin = await fetch(base + "/api/app", {
  method: "POST",
  headers: { Cookie: doctor, Origin: "https://foreign.test", "Content-Type": "application/json" },
  body: JSON.stringify({ action: "unlink", input: {} }),
});
assert.equal(crossOrigin.status, 403);
console.log(
  "PASS: live local app login, canonical doctor/profile/library reads, hospital directory, separate role sessions, unauthenticated denial and origin enforcement.",
);
