"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createOrbScene,
  type OrbSceneApi,
} from "@/lib/orbScene";
import {
  HandTracker,
  type TrackerStatus,
} from "@/lib/handTracker";

type CameraState = "off" | "starting" | "on" | "error";
type ApiState = "checking" | "online" | "offline";

type Job = {
  id: number;
  title?: string;
  company?: string;
  location?: string;
  type?: string;
  salary?: string;
  description?: string;
  requirements?: string[] | string;
  category_name?: string;
  gender?: string;
  posted?: string;
  created_at?: string;
};

type ApiPayload = {
  success?: boolean;
  message?: string;
  data?: unknown;
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
};

type ResultView =
  | { kind: "idle" }
  | { kind: "health"; payload: ApiPayload }
  | { kind: "categories"; items: Array<Record<string, unknown>> }
  | { kind: "jobs"; jobs: Job[]; query: string }
  | { kind: "job"; job: Job }
  | { kind: "error"; message: string };

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
};

const LOCATIONS = [
  "thrissur",
  "irinjalakuda",
  "mannuthy",
  "kozhikode",
  "calicut",
  "ernakulam",
  "kochi",
  "palakkad",
  "malappuram",
  "trivandrum",
  "thiruvananthapuram",
  "kannur",
  "kasargod",
  "kasaragod",
  "kottayam",
  "alappuzha",
  "pathanamthitta",
  "idukki",
  "kollam",
  "wayanad",
];

function capitalize(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseCommand(raw: string): URLSearchParams {
  const original = raw.trim();
  const lower = original.toLowerCase();
  const params = new URLSearchParams();

  if (
    lower === "status" ||
    lower.includes("api status") ||
    lower.includes("health")
  ) {
    params.set("action", "health");
    return params;
  }

  if (lower.includes("categor")) {
    params.set("action", "categories");
    return params;
  }

  const jobIdMatch = lower.match(/\bjob\s*#?\s*(\d+)\b/);
  if (jobIdMatch) {
    params.set("action", "job");
    params.set("id", jobIdMatch[1]);
    return params;
  }

  params.set("action", "jobs");
  params.set("limit", "15");

  const location = LOCATIONS.find((item) =>
    lower.includes(item),
  );

  if (location) {
    params.set(
      "location",
      location === "calicut"
        ? "Kozhikode"
        : location === "kochi"
          ? "Ernakulam"
          : capitalize(location),
    );
  }

  const noise = new Set([
    "show",
    "find",
    "search",
    "give",
    "get",
    "me",
    "jobs",
    "job",
    "vacancy",
    "vacancies",
    "opening",
    "openings",
    "available",
    "latest",
    "live",
    "in",
    "at",
    "near",
    "please",
    "triagull",
    "ultron",
    "for",
  ]);

  const words = lower
    .replace(/[^a-z0-9\s+-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !noise.has(word))
    .filter((word) => !LOCATIONS.includes(word));

  const search = words.join(" ").trim();
  if (search) params.set("search", search);

  return params;
}

function summarizeJobs(jobs: Job[], query: string): string {
  if (!jobs.length) {
    return "No matching vacancies found in Triagull Jobs.";
  }

  const first = jobs[0];
  return (
    jobs.length +
    " vacancies found for " +
    (query || "your search") +
    ". First result is " +
    (first.title || "a vacancy") +
    (first.location ? " in " + first.location : "") +
    "."
  );
}

export default function JarvisOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);

  const [camera, setCamera] =
    useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({
    hands: 0,
    mode: "idle",
  });
  const [cameraError, setCameraError] =
    useState<string | null>(null);

  const [apiState, setApiState] =
    useState<ApiState>("checking");
  const [command, setCommand] = useState("");
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [result, setResult] = useState<ResultView>({
    kind: "idle",
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = createOrbScene(container);
    sceneRef.current = scene;

    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  const checkApi = useCallback(async () => {
    try {
      const response = await fetch(
        "/api/triagull?action=health",
        { cache: "no-store" },
      );
      const payload = (await response.json()) as ApiPayload;
      setApiState(
        response.ok && payload.success !== false
          ? "online"
          : "offline",
      );
      return payload;
    } catch {
      setApiState("offline");
      return null;
    }
  }, []);

  useEffect(() => {
    void checkApi();
  }, [checkApi]);

  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setCamera("off");
    setStatus({ hands: 0, mode: "idle" });
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;

    setCamera("starting");
    setCameraError(null);

    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) =>
        sceneRef.current?.rotateBy(dt, dp),
      onZoom: (factor) =>
        sceneRef.current?.zoomBy(factor),
      onStatus: setStatus,
    });

    trackerRef.current = tracker;

    try {
      await tracker.start();
      setCamera("on");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      setCameraError(
        err instanceof DOMException &&
          err.name === "NotAllowedError"
          ? "CAMERA ACCESS DENIED"
          : "TRACKING INIT FAILED",
      );
    }
  }, []);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) stopGestures();
    else void startGestures();
  }, [startGestures, stopGestures]);

  const speak = useCallback((text: string) => {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window)
    ) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-IN";
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }, []);

  const runCommand = useCallback(
    async (raw?: string, speakResult = false) => {
      const input = (raw ?? command).trim();
      if (!input || loading) return;

      setCommand(input);
      setLoading(true);

      try {
        const params = parseCommand(input);
        const response = await fetch(
          "/api/triagull?" + params.toString(),
          { cache: "no-store" },
        );
        const payload = (await response.json()) as ApiPayload;

        if (!response.ok || payload.success === false) {
          const message =
            payload.message || "Triagull API request failed";
          setResult({ kind: "error", message });
          if (speakResult) speak(message);
          return;
        }

        const action = params.get("action");

        if (action === "health") {
          setApiState("online");
          setResult({ kind: "health", payload });
          if (speakResult) {
            speak("Triagull Jobs API is online.");
          }
          return;
        }

        if (action === "categories") {
          const items = Array.isArray(payload.data)
            ? (payload.data as Array<Record<string, unknown>>)
            : [];
          setResult({ kind: "categories", items });
          if (speakResult) {
            speak(items.length + " job categories found.");
          }
          return;
        }

        if (action === "job") {
          const job = (payload.data || {}) as Job;
          setResult({ kind: "job", job });
          if (speakResult) {
            speak(
              (job.title || "Job") +
                (job.location
                  ? " in " + job.location
                  : ""),
            );
          }
          return;
        }

        const jobs = Array.isArray(payload.data)
          ? (payload.data as Job[]).slice(0, 15)
          : [];
        setResult({
          kind: "jobs",
          jobs,
          query: input,
        });

        if (speakResult) {
          speak(summarizeJobs(jobs, input));
        }
      } catch {
        const message = "Unable to connect to Triagull Jobs API.";
        setApiState("offline");
        setResult({ kind: "error", message });
        if (speakResult) speak(message);
      } finally {
        setLoading(false);
      }
    },
    [command, loading, speak],
  );

  const startVoiceCommand = useCallback(() => {
    if (typeof window === "undefined") return;

    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        start(): void;
        stop(): void;
        onresult:
          | ((event: {
              results: {
                [index: number]: {
                  [index: number]: {
                    transcript: string;
                  };
                };
              };
            }) => void)
          | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        start(): void;
        stop(): void;
        onresult:
          | ((event: {
              results: {
                [index: number]: {
                  [index: number]: {
                    transcript: string;
                  };
                };
              };
            }) => void)
          | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
      };
    };

    const Recognition =
      speechWindow.SpeechRecognition ||
      speechWindow.webkitSpeechRecognition;

    if (!Recognition) {
      setResult({
        kind: "error",
        message:
          "Voice command is not supported in this browser. Use the command box.",
      });
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const transcript =
        event.results?.[0]?.[0]?.transcript?.trim() || "";
      if (transcript) {
        setCommand(transcript);
        void runCommand(transcript, true);
      }
    };

    recognition.onerror = () => {
      setListening(false);
      setResult({
        kind: "error",
        message:
          "Voice recognition failed. Try again or type the command.",
      });
    };

    recognition.onend = () => {
      setListening(false);
    };

    setListening(true);
    recognition.start();
  }, [runCommand]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (event.key) {
        case "+":
        case "=":
          sceneRef.current?.zoomIn();
          break;
        case "-":
        case "_":
          sceneRef.current?.zoomOut();
          break;
        case "r":
        case "R":
          sceneRef.current?.resetView();
          break;
        case "g":
        case "G":
          toggleGestures();
          break;
        case "/":
          event.preventDefault();
          document
            .querySelector<HTMLInputElement>(
              ".triagull-command-input",
            )
            ?.focus();
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleGestures]);

  const cameraOn = camera === "on";

  return (
    <>
      <div ref={containerRef} className="orb-root" />

      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      <div className="hud hud-title">
        U.L.T.R.O.N.
        <div className="hud-subtitle">
          TRIAGULL JOBS // LIVE API COMMAND CENTER
        </div>
      </div>

      <div className="hud api-status">
        <span
          className={
            "api-dot " +
            (apiState === "online"
              ? "online"
              : apiState === "offline"
                ? "offline"
                : "checking")
          }
        />
        TRIAGULL API{" "}
        {apiState === "online"
          ? "ONLINE"
          : apiState === "offline"
            ? "OFFLINE"
            : "CHECKING"}
      </div>

      <section className="hud assistant-panel">
        <div className="assistant-heading">
          <div>
            <div className="assistant-kicker">
              LIVE RECRUITMENT DATA
            </div>
            <h1>TRIAGULL COMMAND</h1>
          </div>
          <button
            type="button"
            className={
              "voice-btn" + (listening ? " listening" : "")
            }
            onClick={startVoiceCommand}
            disabled={loading || listening}
            aria-label="Start voice command"
          >
            {listening ? "LISTENING…" : "MIC"}
          </button>
        </div>

        <form
          className="command-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runCommand();
          }}
        >
          <input
            className="triagull-command-input"
            value={command}
            onChange={(event) =>
              setCommand(event.target.value)
            }
            placeholder="e.g. Thrissur accountant jobs"
            autoComplete="off"
          />
          <button
            type="submit"
            className="command-submit"
            disabled={loading || !command.trim()}
          >
            {loading ? "SCANNING…" : "EXECUTE"}
          </button>
        </form>

        <div className="quick-commands">
          {[
            "Thrissur accountant jobs",
            "Telecaller Thrissur",
            "Categories",
            "API status",
          ].map((item) => (
            <button
              type="button"
              key={item}
              onClick={() => {
                setCommand(item);
                void runCommand(item);
              }}
              disabled={loading}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="assistant-results">
          {result.kind === "idle" && (
            <div className="assistant-empty">
              <strong>READY.</strong>
              <span>
                Ask ULTRON to search live Triagull Jobs
                vacancies.
              </span>
              <span>
                Commands: location + role, categories,
                API status, or job ID.
              </span>
            </div>
          )}

          {result.kind === "error" && (
            <div className="assistant-error">
              {result.message}
            </div>
          )}

          {result.kind === "health" && (
            <div className="health-result">
              <strong>API LINK ESTABLISHED</strong>
              <span>
                {result.payload.message ||
                  "Triagull Jobs API is online."}
              </span>
            </div>
          )}

          {result.kind === "categories" && (
            <div className="categories-grid">
              {result.items.length ? (
                result.items.slice(0, 30).map((item, index) => {
                  const label =
                    String(
                      item.name ??
                        item.category_name ??
                        item.title ??
                        "Category " + (index + 1),
                    );
                  return (
                    <button
                      type="button"
                      key={String(item.id ?? label ?? index)}
                      onClick={() => {
                        const next = label + " jobs";
                        setCommand(next);
                        void runCommand(next);
                      }}
                    >
                      {label}
                    </button>
                  );
                })
              ) : (
                <div className="assistant-empty">
                  No categories returned.
                </div>
              )}
            </div>
          )}

          {result.kind === "job" && (
            <JobCard job={result.job} />
          )}

          {result.kind === "jobs" && (
            <>
              <div className="results-summary">
                <strong>
                  {result.jobs.length} RESULTS
                </strong>
                <span>{result.query}</span>
              </div>
              <div className="job-list">
                {result.jobs.length ? (
                  result.jobs.map((job) => (
                    <JobCard key={job.id} job={job} compact />
                  ))
                ) : (
                  <div className="assistant-empty">
                    No matching live vacancies found.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <div className="hud hud-hint">
        <div>
          <span className="key">DRAG</span> spin&nbsp;&nbsp;
          <span className="key">SCROLL</span> zoom
        </div>
        {cameraOn ? (
          <div>
            <span className="key">PINCH + MOVE</span>
            spin&nbsp;&nbsp;
            <span className="key">BOTH PINCH</span> zoom
          </div>
        ) : (
          <div>
            <span className="key">G</span> gestures&nbsp;&nbsp;
            <span className="key">/</span> command
          </div>
        )}
      </div>

      <div className="hud hud-controls">
        <div
          className={
            "camera-panel" + (cameraOn ? " visible" : "")
          }
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className="camera-video"
          />
          <canvas
            ref={overlayRef}
            width={208}
            height={156}
            className="camera-overlay"
          />
          <div className="camera-status">
            {status.hands > 0
              ? status.hands +
                " HAND" +
                (status.hands > 1 ? "S" : "") +
                " · " +
                MODE_LABEL[status.mode]
              : "SHOW HANDS"}
          </div>
        </div>

        {cameraError && (
          <div className="hud-error">{cameraError}</div>
        )}

        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            aria-pressed={cameraOn}
            onClick={toggleGestures}
            disabled={camera === "starting"}
          >
            {camera === "starting"
              ? "INITIALIZING…"
              : cameraOn
                ? "GESTURES ON"
                : "GESTURES OFF"}
          </button>
        </div>

        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            onClick={() => sceneRef.current?.zoomIn()}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="hud-btn"
            onClick={() => sceneRef.current?.zoomOut()}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="hud-btn"
            onClick={() => sceneRef.current?.resetView()}
          >
            RESET
          </button>
        </div>
      </div>
    </>
  );
}

function JobCard({
  job,
  compact = false,
}: {
  job: Job;
  compact?: boolean;
}) {
  const requirements = Array.isArray(job.requirements)
    ? job.requirements.join(", ")
    : job.requirements || "";

  return (
    <article
      className={"job-card" + (compact ? " compact" : "")}
    >
      <div className="job-card-top">
        <div>
          <span className="job-id">JOB #{job.id}</span>
          <h2>{job.title || "Untitled vacancy"}</h2>
        </div>
        {job.category_name && (
          <span className="job-category">
            {job.category_name}
          </span>
        )}
      </div>

      <div className="job-meta">
        {job.location && <span>{job.location}</span>}
        {job.type && <span>{job.type}</span>}
        {job.gender && <span>{job.gender}</span>}
        {job.posted && <span>{job.posted}</span>}
      </div>

      {job.salary && (
        <div className="job-salary">{job.salary}</div>
      )}

      {!compact && job.description && (
        <p>{job.description}</p>
      )}

      {!compact && requirements && (
        <p className="job-requirements">
          <strong>Requirements:</strong> {requirements}
        </p>
      )}
    </article>
  );
}
