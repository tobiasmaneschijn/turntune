interface PlayerApiLoaderOptions<T> {
  src: string;
  label: string;
  readApi: () => T | undefined;
  readyCallback?: "onYouTubeIframeAPIReady" | "onSpotifyWebPlaybackSDKReady";
  readyEvent?: string;
  timeoutMs?: number;
}

/** Share SDK initialization, but allow a later mount to retry a failed download. */
export function createPlayerApiLoader<T>(options: PlayerApiLoaderOptions<T>) {
  let pending: Promise<T> | null = null;
  return () => {
    const available = options.readApi();
    if (available) return Promise.resolve(available);
    if (pending) return pending;

    pending = new Promise<T>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${options.src}"]`);
      const script = existing || document.createElement("script");
      let settled = false;
      let timeout: number | undefined;
      let poll: number | undefined;
      const callbackKey = options.readyCallback;
      const previousCallback = callbackKey ? window[callbackKey] : undefined;
      const cleanup = () => {
        if (timeout !== undefined) window.clearTimeout(timeout);
        if (poll !== undefined) window.clearInterval(poll);
        script.removeEventListener("load", checkReady);
        script.removeEventListener("error", failDownload);
        if (options.readyEvent) document.removeEventListener(options.readyEvent, checkReady);
        if (callbackKey && window[callbackKey] === readyCallback) window[callbackKey] = previousCallback;
      };
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        // Remove our failed element so a new attempt actually fetches the SDK.
        if (!existing) script.remove();
        reject(new Error(message));
      };
      const checkReady = () => {
        if (settled) return;
        const api = options.readApi();
        if (!api) return;
        settled = true;
        cleanup();
        resolve(api);
      };
      const readyCallback = () => {
        try {
          previousCallback?.();
        } finally {
          checkReady();
        }
      };
      const failDownload = () => fail(`Could not load ${options.label}.`);

      if (callbackKey) window[callbackKey] = readyCallback;
      if (options.readyEvent) document.addEventListener(options.readyEvent, checkReady);
      script.addEventListener("load", checkReady);
      script.addEventListener("error", failDownload);
      timeout = window.setTimeout(() => fail(`${options.label} took too long to load.`), options.timeoutMs ?? 15_000);
      // Also supports a script loaded by another part of the app and SDKs whose
      // readiness event fired immediately before listeners were attached.
      poll = window.setInterval(checkReady, 100);
      if (!existing) {
        script.src = options.src;
        script.async = true;
        document.head.appendChild(script);
      }
      checkReady();
    }).catch((cause) => {
      pending = null;
      throw cause;
    });
    return pending;
  };
}
