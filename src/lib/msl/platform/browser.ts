export type AppSession = { id: string; email: string; role: "doctor" | "hospital" };
export async function appRequest<T>(
  action: string,
  input?: unknown,
  role: "doctor" | "hospital" = "doctor",
  id?: string,
): Promise<T> {
  const read = input === undefined;
  const response = await fetch(
    read
      ? `/api/app?action=${encodeURIComponent(action)}&role=${role}${id ? `&id=${encodeURIComponent(id)}` : ""}`
      : "/api/app",
    {
      method: read ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      ...(read
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, input, role }),
          }),
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Databricks app request failed.");
  return result as T;
}
export const getAppSession = () => appRequest<AppSession | null>("session");
export async function loginApp(
  email: string,
  password: string,
  role: "doctor" | "hospital" = "doctor",
) {
  const session = await appRequest<AppSession>("sign_in", { email, password, role }, role);
  window.dispatchEvent(new Event("msl-auth-changed"));
  return session;
}
export async function logoutApp(role: "doctor" | "hospital" = "doctor") {
  await appRequest("sign_out", {}, role);
  window.dispatchEvent(new Event("msl-auth-changed"));
}
