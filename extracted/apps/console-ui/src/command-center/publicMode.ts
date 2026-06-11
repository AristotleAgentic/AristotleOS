export function isPublicDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/public" || path.startsWith("/public/");
}
