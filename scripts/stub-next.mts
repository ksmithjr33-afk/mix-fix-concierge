// Stand-ins for next/headers and next/navigation, so the real staff auth runs
// in a test: cookies() reads stubCookies, redirect() throws a RedirectError.

export const stubCookies = new Map<string, string>();

export async function cookies() {
  return { get: (name: string) => (stubCookies.has(name) ? { name, value: stubCookies.get(name)! } : undefined) };
}

export class RedirectError extends Error {
  to: string;
  constructor(to: string) {
    super(`redirect to ${to}`);
    this.to = to;
  }
}

export function redirect(to: string): never {
  throw new RedirectError(to);
}
