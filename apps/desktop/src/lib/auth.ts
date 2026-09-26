/** Auth client — talks to the gateway (which routes /auth/* to auth-service).
 *
 * localStorage:
 *  - mponline_session : logged-in user + JWT (checked on app start)
 *  - mponline_banned  : lowercased teacher emails declined by a coordinator.
 *    A banned email is blocked client-side even before hitting the server.
 */

export const AUTH_URL =
  import.meta.env.VITE_AUTH_URL ??
  import.meta.env.VITE_GATEWAY_URL ??
  "http://localhost:8080";

export type Role = "coordinator" | "teacher";

export type AuthUser = {
  role: Role;
  name: string;
  college: string;
  email?: string | null;
  coordinator_id?: string | null;
  teacher_id?: string | null;
  status?: string | null;
};

export type Session = {
  token: string;
  user: AuthUser;
};

export type TeacherRequest = {
  id: number;
  name: string;
  email: string;
  teacher_id: string;
  college: string;
  status: string;
  created_at: string;
};

const SESSION_KEY = "mponline_session";
const BANNED_KEY = "mponline_banned";

// ---- localStorage helpers ----
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.token || !parsed?.user?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function loadBanned(): string[] {
  try {
    const raw = localStorage.getItem(BANNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((e) => String(e).toLowerCase()) : [];
  } catch {
    return [];
  }
}

export function isBanned(email: string): boolean {
  return loadBanned().includes(email.trim().toLowerCase());
}

export function markBanned(email: string) {
  const list = loadBanned();
  const key = email.trim().toLowerCase();
  if (!list.includes(key)) {
    list.push(key);
    localStorage.setItem(BANNED_KEY, JSON.stringify(list));
  }
}

// ---- api ----
async function parseError(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  const detail = body?.detail ?? `Request failed with status ${res.status}`;
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

export async function fetchColleges(): Promise<string[]> {
  const res = await fetch(`${AUTH_URL}/auth/colleges`);
  if (!res.ok) throw new Error(await parseError(res));
  const body = await res.json();
  return body.colleges ?? [];
}

export async function fetchSeededCoordinators(): Promise<
  { coordinator_id: string; name: string; college: string }[]
> {
  const res = await fetch(`${AUTH_URL}/auth/seeded-coordinators`);
  if (!res.ok) throw new Error(await parseError(res));
  const body = await res.json();
  return body.coordinators ?? [];
}

export async function coordinatorLogin(
  coordinator_id: string,
  password: string,
): Promise<Session> {
  const res = await fetch(`${AUTH_URL}/auth/coordinator/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ coordinator_id, password }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const session = (await res.json()) as Session;
  saveSession(session);
  return session;
}

export async function teacherRegister(input: {
  name: string;
  email: string;
  password: string;
  teacher_id: string;
  college: string;
}): Promise<{ status: string; message: string }> {
  if (isBanned(input.email)) {
    throw new Error("This account was declined by the coordinator and cannot register again.");
  }
  const res = await fetch(`${AUTH_URL}/auth/teacher/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function teacherLogin(email: string, password: string): Promise<Session> {
  if (isBanned(email)) {
    throw new Error("This account was declined by the coordinator and is banned.");
  }
  const res = await fetch(`${AUTH_URL}/auth/teacher/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const msg = await parseError(res);
    if (msg === "banned") {
      markBanned(email);
      throw new Error("Your registration was declined by the coordinator. You are banned.");
    }
    if (msg === "pending_approval") {
      throw new Error("Your registration is still pending coordinator approval.");
    }
    throw new Error(msg);
  }
  const session = (await res.json()) as Session;
  saveSession(session);
  return session;
}

export async function fetchTeacherRequests(
  token: string,
  status = "pending",
): Promise<{ college: string; requests: TeacherRequest[] }> {
  const res = await fetch(`${AUTH_URL}/auth/coordinator/requests?status=${status}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function decideTeacherRequest(
  token: string,
  teacherDbId: number,
  decision: "approved" | "rejected",
): Promise<{ status: string; email: string }> {
  const res = await fetch(`${AUTH_URL}/auth/coordinator/requests/${teacherDbId}/decision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const body = await res.json();
  if (decision === "rejected" && body.email) markBanned(body.email);
  return body;
}
