const POE_COOKIE_NAMES = ["cf_clearance", "POESESSID", "POETOKEN"];

export function normalizePoeCookieInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const cookies = new Map<string, string>();

  if (trimmed.includes("=")) {
    for (const part of trimmed.split(";")) {
      const [rawName, ...rawValue] = part.trim().split("=");
      const name = rawName.trim();
      const value = rawValue.join("=").trim();
      if (POE_COOKIE_NAMES.includes(name) && value) {
        cookies.set(name, value);
      }
    }
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    const name = columns[0];
    const value = columns[1];
    if (POE_COOKIE_NAMES.includes(name) && value) {
      cookies.set(name, value);
    }
  }

  if (cookies.size === 0 && /^[a-f0-9]{32,}$/i.test(trimmed)) {
    cookies.set("POESESSID", trimmed);
  }

  return POE_COOKIE_NAMES
    .map(name => {
      const value = cookies.get(name);
      return value ? `${name}=${value}` : null;
    })
    .filter(Boolean)
    .join("; ");
}

export function getMissingPoeCookies(cookieHeader: string): string[] {
  return POE_COOKIE_NAMES.filter(name => !cookieHeader.includes(`${name}=`));
}
