/** Resolve local services against the browser host so phones can reach the dev PC. */
export function localServiceUrl(port: number) {
  if (
    typeof window !== "undefined" &&
    (window.location.protocol === "http:" ||
      window.location.protocol === "https:")
  ) {
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }

  return `http://localhost:${port}`;
}
