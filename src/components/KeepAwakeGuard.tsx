import React, { useEffect, useRef, useState } from "react";
import { useAppState } from "../store/appStore";

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
  removeEventListener: (type: "release", listener: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

export function KeepAwakeGuard() {
  const { state } = useAppState();
  const [status, setStatus] = useState<"active" | "unsupported" | "released" | "error" | "off">("off");
  const [message, setMessage] = useState("");
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    let cancelled = false;

    const releaseCurrent = async () => {
      const current = wakeLockRef.current;
      wakeLockRef.current = null;
      if (current && !current.released) {
        try { await current.release(); } catch { /* ignore */ }
      }
    };

    const requestWakeLock = async () => {
      if (!state.settings.keepAwake) {
        await releaseCurrent();
        if (!cancelled) {
          setStatus("off");
          setMessage("");
        }
        return;
      }

      const wakeLock = (navigator as WakeLockNavigator).wakeLock;
      if (!wakeLock) {
        setStatus("unsupported");
        setMessage("Chrome does not expose Screen Wake Lock here.");
        return;
      }

      if (document.visibilityState !== "visible") {
        setStatus("released");
        setMessage("Keep Awake resumes when the tab is visible again.");
        return;
      }

      try {
        await releaseCurrent();
        const sentinel = await wakeLock.request("screen");
        const onRelease = () => {
          if (!cancelled) {
            setStatus("released");
            setMessage("Wake lock was released by the browser.");
          }
        };
        sentinel.addEventListener("release", onRelease);
        wakeLockRef.current = sentinel;
        if (!cancelled) {
          setStatus("active");
          setMessage("Keep Awake active");
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error");
          setMessage(err instanceof Error ? err.message : "Could not acquire wake lock.");
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      void releaseCurrent();
    };
  }, [state.settings.keepAwake]);

  if (!state.settings.keepAwake || status === "off") return null;

  return (
    <div className={`keep-awake-chip keep-awake-${status}`} title={message}>
      <span className="keep-awake-dot" />
      <span>{status === "active" ? "Awake" : "Wake risk"}</span>
    </div>
  );
}
