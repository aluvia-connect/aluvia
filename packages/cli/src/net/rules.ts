// Rule engine for hostname matching and proxy decision

/**
 * Match a hostname against a pattern.
 *
 * Supported patterns:
 * - '*' matches any hostname
 * - '*.example.com' matches subdomains of example.com (but not example.com itself)
 * - 'example.com' exact match
 * - 'google.*' matches google.com, google.co.uk, etc.
 *
 * @param hostname - The hostname to match
 * @param pattern - The pattern to match against
 * @returns true if hostname matches pattern
 */
export function matchPattern(hostname: string, pattern: string): boolean {
  // Normalize inputs to lowercase
  const normalizedHostname = hostname.trim().toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();

  if (!normalizedHostname) return false;
  if (!normalizedPattern) return false;

  // Universal wildcard matches everything
  if (normalizedPattern === '*') {
    return true;
  }

  // Exact match
  if (normalizedHostname === normalizedPattern) {
    return true;
  }

  // Prefix wildcard: *.example.com matches subdomains
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(1); // '.example.com'
    // Must end with the suffix and have something before it
    if (normalizedHostname.endsWith(suffix)) {
      const prefix = normalizedHostname.slice(0, -suffix.length);
      // Prefix must not be empty. This matches any subdomain depth (for example, foo.example.com and foo.bar.example.com).
      return prefix.length > 0;
    }
    return false;
  }

  // Suffix wildcard: google.* matches google.com, google.co.uk, etc.
  if (normalizedPattern.endsWith('.*')) {
    const prefix = normalizedPattern.slice(0, -2); // 'google'
    // Must start with prefix followed by a dot
    if (normalizedHostname.startsWith(prefix + '.')) {
      return true;
    }
    return false;
  }

  return false;
}

/**
 * Determine if a hostname should be proxied based on rules.
 *
 * Rules semantics:
 * - [] (empty) → no proxy (return false)
 * - ['*'] → proxy everything
 * - ['example.com'] → proxy only example.com
 * - ['*.google.com'] → proxy subdomains of google.com
 * - ['*', '-example.com'] → proxy everything except example.com
 * - ['AUTO', 'example.com'] → AUTO is placeholder (ignored), proxy example.com
 *
 * Negative patterns (prefixed with '-') exclude hosts from proxying.
 * If '*' is in rules, default is to proxy unless excluded.
 * Without '*', only explicitly matched patterns are proxied.
 *
 * @param hostname - The hostname to check
 * @param rules - Array of rule patterns
 * @returns true if the hostname should be proxied
 */
/**
 * Pre-normalized rules for efficient per-request matching.
 */
export type NormalizedRules = {
  positiveRules: string[];
  negativeRules: string[];
  hasCatchAll: boolean;
  empty: boolean;
};

/**
 * Pre-process raw rule strings into a NormalizedRules structure.
 * Call once when config is loaded, then use shouldProxyNormalized() per request.
 */
export function normalizeRules(rules: string[]): NormalizedRules {
  if (!rules || rules.length === 0) {
    return {
      positiveRules: [],
      negativeRules: [],
      hasCatchAll: false,
      empty: true,
    };
  }

  const trimmed = rules
    .filter((r) => typeof r === 'string')
    .map((r) => r.trim().toLowerCase())
    .filter((r) => r.length > 0)
    .filter((r) => r !== 'auto');

  if (trimmed.length === 0) {
    return {
      positiveRules: [],
      negativeRules: [],
      hasCatchAll: false,
      empty: true,
    };
  }

  const negativeRules: string[] = [];
  const positiveRules: string[] = [];

  for (const rule of trimmed) {
    if (rule.startsWith('-')) {
      const neg = rule.slice(1).trim();
      if (neg.length > 0) negativeRules.push(neg);
    } else {
      positiveRules.push(rule);
    }
  }

  return {
    positiveRules,
    negativeRules,
    hasCatchAll: positiveRules.includes('*'),
    empty: false,
  };
}

/**
 * Fast proxy decision using pre-normalized rules.
 */
export function shouldProxyNormalized(hostname: string, rules: NormalizedRules): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  if (!normalizedHostname) return false;
  if (rules.empty) return false;

  for (const negRule of rules.negativeRules) {
    if (matchPattern(normalizedHostname, negRule)) return false;
  }

  if (rules.hasCatchAll) return true;

  for (const posRule of rules.positiveRules) {
    if (matchPattern(normalizedHostname, posRule)) return true;
  }

  return false;
}

export function shouldProxy(hostname: string, rules: string[]): boolean {
  return shouldProxyNormalized(hostname, normalizeRules(rules));
}
