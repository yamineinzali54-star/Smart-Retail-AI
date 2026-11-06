export function isNavActive(pathname: string | null, url: string) {
  if (!pathname) return false
  const path =
    pathname === "/admin" || pathname === "/inventory"
      ? "/dashboard"
      : pathname === "/pos"
        ? "/pos/terminal"
        : pathname
  return path === url || path.startsWith(`${url}/`)
}
