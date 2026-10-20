import packageJson from "../../../package.json";

export interface FeedbackDiagnosticContext {
  surface: "room-directory" | "room" | "profile" | "admin";
  roomRole?: "owner" | "moderator" | "dj" | "listener";
  socketConnected?: boolean;
  playbackProvider?: string | null;
  playbackState?: "idle" | "playing" | "paused";
  preferredPlayback?: string;
}

interface CapturedError {
  name: string;
  message: string;
  source?: string;
  occurredAt: string;
}

interface NavigatorWithHints extends Navigator {
  userAgentData?: { brands?: Array<{ brand: string; version: string }>; platform?: string };
  connection?: { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean };
}

const appStartedAt = Date.now();
const recentErrors: CapturedError[] = [];

export function sanitizeFeedbackDiagnosticText(value: unknown) {
  return String(value || "Unknown error")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]")
    .replace(/\b(access_token|refresh_token|token|api[_-]?key|authorization|password)=([^\s&]+)/gi, "$1=[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/https?:\/\/[^\s)\]}]+/g, (candidate) => {
      try {
        const url = new URL(candidate);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[redacted-url]";
      }
    })
    .slice(0, 240);
}

function sourceName(value?: string) {
  if (!value) return undefined;
  try {
    return new URL(value).pathname.split("/").filter(Boolean).pop()?.slice(0, 100);
  } catch {
    return undefined;
  }
}

function captureError(name: string, message: unknown, source?: string) {
  recentErrors.push({
    name: sanitizeFeedbackDiagnosticText(name).slice(0, 60),
    message: sanitizeFeedbackDiagnosticText(message),
    source: sourceName(source),
    occurredAt: new Date().toISOString()
  });
  if (recentErrors.length > 8) recentErrors.shift();
}

if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    captureError(event.error?.name || "Error", event.message, event.filename);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    captureError(reason instanceof Error ? reason.name : "Unhandled rejection", reason instanceof Error ? reason.message : reason);
  });
}

function browserDetails(navigatorWithHints: NavigatorWithHints) {
  const preferredBrand = navigatorWithHints.userAgentData?.brands?.find(({ brand }) => !brand.includes("Not"));
  if (preferredBrand) return { name: preferredBrand.brand, majorVersion: preferredBrand.version.split(".")[0] };

  const userAgent = navigatorWithHints.userAgent;
  const match = userAgent.match(/(?:Edg|Chrome|Firefox)\/(\d+)/) || userAgent.match(/Version\/(\d+).+Safari/);
  const name = userAgent.includes("Edg/") ? "Edge"
    : userAgent.includes("Firefox/") ? "Firefox"
      : userAgent.includes("Chrome/") ? "Chrome"
        : userAgent.includes("Safari/") ? "Safari"
          : "Other";
  return { name, majorVersion: match?.[1] || "unknown" };
}

function operatingSystem(navigatorWithHints: NavigatorWithHints) {
  const platform = navigatorWithHints.userAgentData?.platform;
  if (platform) return platform;
  const userAgent = navigatorWithHints.userAgent;
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Mac OS/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Other";
}

function deviceClass() {
  const shortestSide = Math.min(window.screen.width, window.screen.height);
  if (shortestSide < 600) return "mobile";
  if (shortestSide < 1024 || matchMedia("(pointer: coarse)").matches) return "tablet";
  return "desktop";
}

export function buildFeedbackDiagnostics(context: FeedbackDiagnosticContext): Record<string, unknown> {
  const navigatorWithHints = navigator as NavigatorWithHints;
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const connection = navigatorWithHints.connection;

  return {
    app: {
      version: packageJson.version,
      mode: import.meta.env.MODE,
      surface: context.surface,
      sessionDurationSeconds: Math.round((Date.now() - appStartedAt) / 1000)
    },
    browser: browserDetails(navigatorWithHints),
    device: {
      operatingSystem: operatingSystem(navigatorWithHints),
      class: deviceClass(),
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: window.screen.width, height: window.screen.height },
      pixelRatio: Number(window.devicePixelRatio.toFixed(2))
    },
    connection: {
      online: navigator.onLine,
      ...(connection ? {
        effectiveType: connection.effectiveType || "unknown",
        roundTripTimeMs: connection.rtt ?? null,
        downlinkMbps: connection.downlink ?? null,
        dataSaver: connection.saveData ?? false
      } : { detailsAvailable: false })
    },
    page: {
      path: location.pathname,
      navigationType: navigation?.type || "unknown",
      domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
      loadCompleteMs: navigation?.loadEventEnd ? Math.round(navigation.loadEventEnd) : null,
      timeToFirstByteMs: navigation ? Math.round(navigation.responseStart) : null
    },
    soundspin: {
      roomRole: context.roomRole || null,
      socketConnected: context.socketConnected ?? null,
      playbackProvider: context.playbackProvider || null,
      playbackState: context.playbackState || null,
      preferredPlayback: context.preferredPlayback || null
    },
    recentErrors: recentErrors.map((error) => ({ ...error }))
  };
}
