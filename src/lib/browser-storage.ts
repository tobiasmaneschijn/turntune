/** Preferences are optional: blocked or full browser storage must not stop the app. */
export function readStoredValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep the current in-memory preference when persistence is unavailable.
  }
}
