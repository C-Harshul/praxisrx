import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, readSession, signIn, checkOrigin } from "./auth.server";
const origin = "http://localhost:8081";
const request = (cookie = "", suppliedOrigin = origin) =>
  new Request(origin + "/api/app", { headers: { origin: suppliedOrigin, cookie } });
beforeEach(async () => {
  vi.stubEnv("APP_ORIGIN", origin);
  vi.stubEnv("APP_SESSION_SECRET", "secret".repeat(10));
  vi.stubEnv(
    "APP_ACCOUNTS_JSON",
    JSON.stringify([
      {
        id: "00000000-0000-4000-8000-000000000001",
        email: "doctor@test.dev",
        role: "doctor",
        password_hash: await hashPassword("test-password"),
      },
    ]),
  );
});
afterEach(() => vi.unstubAllEnvs());
describe("app-managed authentication", () => {
  it("issues an HttpOnly session and isolates staff from doctor sessions", async () => {
    const result = await signIn(request(), {
      email: "doctor@test.dev",
      password: "test-password",
      role: "doctor",
    });
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("SameSite=Strict");
    expect(readSession(request(result.cookie), "doctor")?.email).toBe("doctor@test.dev");
    expect(readSession(request(result.cookie), "hospital")).toBeNull();
  });
  it("rejects password mistakes, forged cookies and foreign-origin writes", async () => {
    await expect(
      signIn(request(), { email: "doctor@test.dev", password: "wrong-password", role: "doctor" }),
    ).rejects.toThrow("don't match");
    expect(readSession(request("msl_doctor_session=forged.signature"), "doctor")).toBeNull();
    expect(() => checkOrigin(request("", "https://foreign.test"))).toThrow("origin");
  });
  it("revokes sessions when the account is removed or credentials change", async () => {
    const result = await signIn(request(), {
      email: "doctor@test.dev",
      password: "test-password",
      role: "doctor",
    });
    const accounts = JSON.parse(process.env["APP_ACCOUNTS_JSON"]!);
    accounts[0].password_hash = await hashPassword("replacement-password");
    vi.stubEnv("APP_ACCOUNTS_JSON", JSON.stringify(accounts));
    expect(readSession(request(result.cookie), "doctor")).toBeNull();
  });
});
