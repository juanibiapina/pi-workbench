export const DEFAULT_BROWSER_ORIGIN = "http://127.0.0.1:19433";
export function browserOrigin(value = process.env.PI_PLANS_URL ?? DEFAULT_BROWSER_ORIGIN): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PI_PLANS_URL must be an HTTP origin on 127.0.0.1");
  }
  return url.origin;
}
export function planUrl(sessionId: string, planId: string, origin = browserOrigin()): string {
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) throw new Error("Invalid session ID");
  if (!/^[a-f0-9]{24}$/.test(planId)) throw new Error("Invalid plan ID");
  return `${browserOrigin(origin)}/plans/${sessionId}/${planId}`;
}
