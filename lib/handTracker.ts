import {
  FilesetResolver,
  HandLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

const WASM_CDN =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;

const PINCH_ON = 0.32;
const PINCH_OFF = 0.45;
const ROTATE_SPEED = 5.0;
const SMOOTHING = 0.4;

export type GestureMode = "idle" | "spin" | "zoom";

export interface TrackerStatus {
  hands: number;
  mode: GestureMode;
}

export interface GameInput {
  x: number;
  y: number;
  pinching: boolean;
  justPinched: boolean;
  shield: boolean;
  hands: number;
}

export interface HandTrackerCallbacks {
  onRotate(deltaTheta: number, deltaPhi: number): void;
  onZoom(factor: number): void;
  onStatus(status: TrackerStatus): void;
  onGameInput?(input: GameInput): void;
}

interface Point {
  x: number;
  y: number;
}

interface HandState {
  pinching: boolean;
  grab: Point;
  pointer: Point;
}

export class HandTracker {
  private video: HTMLVideoElement;
  private overlay: HTMLCanvasElement;
  private callbacks: HandTrackerCallbacks;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private running = false;
  private lastVideoTime = -1;

  private handStates = new Map<string, HandState>();
  private prevMode: GestureMode = "idle";
  private prevSpinGrab: Point | null = null;
  private prevZoomDist: number | null = null;
  private lastStatus: TrackerStatus = { hands: 0, mode: "idle" };

  constructor(
    video: HTMLVideoElement,
    overlay: HTMLCanvasElement,
    callbacks: HandTrackerCallbacks,
  ) {
    this.video = video;
    this.overlay = overlay;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM_CDN);
    const options = {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" as const },
      runningMode: "VIDEO" as const,
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    };

    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options);
    } catch {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: "CPU" as const },
      });
    }

    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.landmarker?.close();
    this.landmarker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.handStates.clear();
    this.prevMode = "idle";
    this.prevSpinGrab = null;
    this.prevZoomDist = null;
    const ctx = this.overlay.getContext("2d");
    ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.callbacks.onGameInput?.({
      x: 0.5,
      y: 0.5,
      pinching: false,
      justPinched: false,
      shield: false,
      hands: 0,
    });
    this.emitStatus({ hands: 0, mode: "idle" });
  }

  private loop = () => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    if (!this.landmarker || this.video.readyState < 2) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;

    const result = this.landmarker.detectForVideo(
      this.video,
      performance.now(),
    );
    this.processHands(
      result.landmarks,
      result.handedness.map((h) => h[0]?.categoryName ?? "?"),
    );
    this.drawOverlay(result.landmarks);
  };

  private processHands(
    landmarks: NormalizedLandmark[][],
    labels: string[],
  ): void {
    const pinchedGrabs: Point[] = [];
    const seen = new Set<string>();
    let primary:
      | { point: Point; pinching: boolean; justPinched: boolean }
      | null = null;

    landmarks.forEach((lm, i) => {
      const label = labels[i] + "-" + i;
      seen.add(label);

      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      if (handScale < 1e-6) return;

      const pinchRatio =
        dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / handScale;

      const grabRaw: Point = {
        x: 1 - (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2,
        y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2,
      };
      const pointerRaw: Point = {
        x: 1 - lm[INDEX_TIP].x,
        y: lm[INDEX_TIP].y,
      };

      let state = this.handStates.get(label);
      if (!state) {
        state = {
          pinching: false,
          grab: grabRaw,
          pointer: pointerRaw,
        };
        this.handStates.set(label, state);
      }

      const wasPinching = state.pinching;
      if (state.pinching && pinchRatio > PINCH_OFF) {
        state.pinching = false;
      } else if (!state.pinching && pinchRatio < PINCH_ON) {
        state.pinching = true;
      }

      state.grab = {
        x: state.grab.x + (grabRaw.x - state.grab.x) * SMOOTHING,
        y: state.grab.y + (grabRaw.y - state.grab.y) * SMOOTHING,
      };
      state.pointer = {
        x: state.pointer.x + (pointerRaw.x - state.pointer.x) * 0.55,
        y: state.pointer.y + (pointerRaw.y - state.pointer.y) * 0.55,
      };

      if (state.pinching) pinchedGrabs.push(state.grab);

      if (i === 0) {
        primary = {
          point: state.pointer,
          pinching: state.pinching,
          justPinched: !wasPinching && state.pinching,
        };
      }
    });

    for (const key of this.handStates.keys()) {
      if (!seen.has(key)) this.handStates.delete(key);
    }

    const mode: GestureMode =
      pinchedGrabs.length >= 2
        ? "zoom"
        : pinchedGrabs.length === 1
          ? "spin"
          : "idle";

    if (mode !== this.prevMode) {
      this.prevSpinGrab = null;
      this.prevZoomDist = null;
      this.prevMode = mode;
    }

    if (mode === "spin") {
      const grab = pinchedGrabs[0];
      if (this.prevSpinGrab) {
        const dx = grab.x - this.prevSpinGrab.x;
        const dy = grab.y - this.prevSpinGrab.y;
        if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) {
          this.callbacks.onRotate(
            dx * ROTATE_SPEED,
            dy * ROTATE_SPEED,
          );
        }
      }
      this.prevSpinGrab = grab;
    } else if (mode === "zoom") {
      const d = Math.hypot(
        pinchedGrabs[0].x - pinchedGrabs[1].x,
        pinchedGrabs[0].y - pinchedGrabs[1].y,
      );
      if (this.prevZoomDist && d > 1e-4) {
        const factor = Math.min(
          1.18,
          Math.max(0.85, this.prevZoomDist / d),
        );
        this.callbacks.onZoom(factor);
      }
      this.prevZoomDist = d;
    }

    if (primary) {
      this.callbacks.onGameInput?.({
        x: clamp01(primary.point.x),
        y: clamp01(primary.point.y),
        pinching: primary.pinching,
        justPinched: primary.justPinched,
        shield: pinchedGrabs.length >= 2,
        hands: landmarks.length,
      });
    } else {
      this.callbacks.onGameInput?.({
        x: 0.5,
        y: 0.5,
        pinching: false,
        justPinched: false,
        shield: false,
        hands: 0,
      });
    }

    this.emitStatus({ hands: landmarks.length, mode });
  }

  private emitStatus(status: TrackerStatus): void {
    if (
      status.hands !== this.lastStatus.hands ||
      status.mode !== this.lastStatus.mode
    ) {
      this.lastStatus = status;
      this.callbacks.onStatus(status);
    }
  }

  private drawOverlay(
    landmarks: NormalizedLandmark[][],
  ): void {
    const ctx = this.overlay.getContext("2d");
    if (!ctx) return;

    const { width, height } = this.overlay;
    ctx.clearRect(0, 0, width, height);

    for (const lm of landmarks) {
      const thumb = lm[THUMB_TIP];
      const index = lm[INDEX_TIP];
      const tx = (1 - thumb.x) * width;
      const ty = thumb.y * height;
      const ix = (1 - index.x) * width;
      const iy = index.y * height;

      const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
      const pinched =
        handScale > 1e-6 &&
        dist2d(thumb, index) / handScale < PINCH_ON;

      ctx.strokeStyle = pinched
        ? "#ffcc66"
        : "rgba(255,170,48,0.5)";
      ctx.lineWidth = pinched ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(ix, iy);
      ctx.stroke();

      ctx.fillStyle = pinched
        ? "#ffcc66"
        : "rgba(255,170,48,0.7)";
      for (const [x, y] of [
        [tx, ty],
        [ix, iy],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, pinched ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function dist2d(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
