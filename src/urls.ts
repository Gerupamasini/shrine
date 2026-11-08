/** Resolve shipped data against Vite's base (GitHub project Pages included), tagged with the
 *  build's data version so a new deploy never mixes fresh code with stale cached data. */
export function publicUrl(path: string): string {
  const url = import.meta.env.BASE_URL + path.replace(/^\/+/, "");
  return `${url}${url.includes("?") ? "&" : "?"}v=${__ASSET_VERSION__}`;
}
