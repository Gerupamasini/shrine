/** Resolve shipped data against Vite's base, including GitHub project Pages. */
export function publicUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\/+/, "");
}
