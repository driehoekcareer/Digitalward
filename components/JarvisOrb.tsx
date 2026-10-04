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
  type GameInput,
  type TrackerStatus,
} from "@/lib/handTracker";

type CameraState = "off" | "starting" | "on" | "error";
type GamePhase = "idle" | "playing" | "gameover";

interface Enemy {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  angle: number;
  elite: boolean;
}

interface Beam {
  x: number;
  y: number;
  life: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
}

interface GameModel {
  enemies: Enemy[];
  beams: Beam[];
  particles: Particle[];
  score: number;
  lives: number;
  combo: number;
  wave: number;
  shieldEnergy: number;
  nextId: number;
  lastSpawn: number;
  lastShot: number;
  startedAt: number;
  lastHudUpdate: number;
}

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
};

function freshGame(now = 0): GameModel {
  return {
    enemies: [],
    beams: [],
    particles: [],
    score: 0,
    lives: 5,
    combo: 0,
    wave: 1,
    shieldEnergy: 100,
    nextId: 1,
    lastSpawn: now,
    lastShot: 0,
    startedAt: now,
    lastHudUpdate: 0,
  };
}

function spawnEnemy(
  game: GameModel,
  width: number,
  height: number,
): void {
  if (width < 50 || height < 50) return;

  const edge = Math.floor(Math.random() * 4);
  const pad = 34;
  let x = 0;
  let y = 0;

  if (edge === 0) {
    x = Math.random() * width;
    y = -pad;
  } else if (edge === 1) {
    x = width + pad;
    y = Math.random() * height;
  } else if (edge === 2) {
    x = Math.random() * width;
    y = height + pad;
  } else {
    x = -pad;
    y = Math.random() * height;
  }

  const cx = width / 2;
  const cy = height / 2;
  const dx = cx - x;
  const dy = cy - y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const elite = Math.random() < Math.min(0.32, 0.08 + game.wave * 0.025);
  const speed =
    38 +
    game.wave * 6 +
    Math.random() * 24 +
    (elite ? 8 : 0);

  game.enemies.push({
    id: game.nextId++,
    x,
    y,
    vx: (dx / dist) * speed,
    vy: (dy / dist) * speed,
    r: elite ? 24 : 17,
    hp: elite ? 2 : 1,
    maxHp: elite ? 2 : 1,
    angle: Math.random() * Math.PI * 2,
    elite,
  });
}

function addBurst(
  game: GameModel,
  x: number,
  y: number,
  amount: number,
): void {
  for (let i = 0; i < amount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 45 + Math.random() * 150;
    game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.35 + Math.random() * 0.45,
      size: 1.5 + Math.random() * 3,
    });
  }
}

export default function JarvisOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const gameCanvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const gameRef = useRef<GameModel>(freshGame());
  const gameActiveRef = useRef(false);
  const fireShotRef = useRef<() => void>(() => {});
  const aimRef = useRef<GameInput>({
    x: 0.5,
    y: 0.5,
    pinching: false,
    justPinched: false,
    shield: false,
    hands: 0,
  });

  const [camera, setCamera] = useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({
    hands: 0,
    mode: "idle",
  });
  const [error, setError] = useState<string | null>(null);
  const [gamePhase, setGamePhase] = useState<GamePhase>("idle");
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(5);
  const [combo, setCombo] = useState(0);
  const [wave, setWave] = useState(1);
  const [shieldEnergy, setShieldEnergy] = useState(100);

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

  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setCamera("off");
    setStatus({ hands: 0, mode: "idle" });
    aimRef.current = {
      x: 0.5,
      y: 0.5,
      pinching: false,
      justPinched: false,
      shield: false,
      hands: 0,
    };
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;

    setCamera("starting");
    setError(null);

    const tracker = new HandTracker(video, overlay, {
      onRotate: (dt, dp) => {
        if (!gameActiveRef.current) {
          sceneRef.current?.rotateBy(dt, dp);
        }
      },
      onZoom: (factor) => {
        if (!gameActiveRef.current) {
          sceneRef.current?.zoomBy(factor);
        }
      },
      onStatus: setStatus,
      onGameInput: (input) => {
        aimRef.current = input;
        if (
          gameActiveRef.current &&
          input.justPinched &&
          !input.shield
        ) {
          fireShotRef.current();
        }
      },
    });

    trackerRef.current = tracker;

    try {
      await tracker.start();
      setCamera("on");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      setError(
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

  const fireShot = useCallback(() => {
    if (!gameActiveRef.current) return;

    const canvas = gameCanvasRef.current;
    if (!canvas) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const game = gameRef.current;
    const now = performance.now();
    if (now - game.lastShot < 135) return;
    game.lastShot = now;

    const x = aimRef.current.x * width;
    const y = aimRef.current.y * height;

    game.beams.push({ x, y, life: 0.12 });

    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    game.enemies.forEach((enemy, index) => {
      const distance = Math.hypot(enemy.x - x, enemy.y - y);
      const lockRadius = enemy.r + 34;
      if (distance <= lockRadius && distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    if (bestIndex >= 0) {
      const enemy = game.enemies[bestIndex];
      enemy.hp -= 1;
      addBurst(game, enemy.x, enemy.y, enemy.hp <= 0 ? 18 : 8);

      if (enemy.hp <= 0) {
        game.enemies.splice(bestIndex, 1);
        game.combo += 1;
        const gain =
          100 +
          Math.min(500, game.combo * 20) +
          (enemy.elite ? 180 : 0);
        game.score += gain;
        setScore(game.score);
        setCombo(game.combo);
      } else {
        game.score += 25;
        setScore(game.score);
      }
    } else {
      game.combo = 0;
      setCombo(0);
    }
  }, []);

  fireShotRef.current = fireShot;

  const startGame = useCallback(() => {
    const now = performance.now();
    gameRef.current = freshGame(now);
    gameActiveRef.current = true;
    setGamePhase("playing");
    setScore(0);
    setLives(5);
    setCombo(0);
    setWave(1);
    setShieldEnergy(100);
    sceneRef.current?.resetView();

    if (!trackerRef.current) {
      void startGestures();
    }
  }, [startGestures]);

  const stopGame = useCallback(() => {
    gameActiveRef.current = false;
    gameRef.current = freshGame();
    setGamePhase("idle");
    setScore(0);
    setLives(5);
    setCombo(0);
    setWave(1);
    setShieldEnergy(100);
  }, []);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!gameActiveRef.current) return;
      const rect = event.currentTarget.getBoundingClientRect();
      aimRef.current = {
        ...aimRef.current,
        x: Math.max(
          0,
          Math.min(1, (event.clientX - rect.left) / rect.width),
        ),
        y: Math.max(
          0,
          Math.min(1, (event.clientY - rect.top) / rect.height),
        ),
      };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      handlePointerMove(event);
      fireShot();
    },
    [fireShot, handlePointerMove],
  );

  useEffect(() => {
    const canvas = gameCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;

      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetWidth = Math.floor(width * dpr);
      const targetHeight = Math.floor(height * dpr);

      if (
        canvas.width !== targetWidth ||
        canvas.height !== targetHeight
      ) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const game = gameRef.current;

      if (gameActiveRef.current) {
        const nextWave =
          1 + Math.floor((now - game.startedAt) / 15000);
        if (nextWave !== game.wave) {
          game.wave = nextWave;
          setWave(nextWave);
        }

        const spawnEvery = Math.max(
          360,
          1050 - game.wave * 70,
        );
        if (
          now - game.lastSpawn >= spawnEvery &&
          game.enemies.length < 28
        ) {
          game.lastSpawn = now;
          spawnEnemy(game, width, height);
        }

        const shielding =
          aimRef.current.shield && game.shieldEnergy > 0;

        if (shielding) {
          game.shieldEnergy = Math.max(
            0,
            game.shieldEnergy - 34 * dt,
          );
        } else {
          game.shieldEnergy = Math.min(
            100,
            game.shieldEnergy + 18 * dt,
          );
        }

        const cx = width / 2;
        const cy = height / 2;
        const coreRadius = Math.max(
          70,
          Math.min(width, height) * 0.105,
        );

        for (let i = game.enemies.length - 1; i >= 0; i -= 1) {
          const enemy = game.enemies[i];
          enemy.x += enemy.vx * dt;
          enemy.y += enemy.vy * dt;
          enemy.angle += dt * (enemy.elite ? 2.8 : 4.1);

          if (
            Math.hypot(enemy.x - cx, enemy.y - cy) <=
            coreRadius
          ) {
            game.enemies.splice(i, 1);
            addBurst(game, enemy.x, enemy.y, 12);

            if (shielding) {
              game.shieldEnergy = Math.max(
                0,
                game.shieldEnergy - (enemy.elite ? 22 : 12),
              );
              game.score += enemy.elite ? 80 : 40;
              setScore(game.score);
            } else {
              game.lives -= 1;
              game.combo = 0;
              setLives(game.lives);
              setCombo(0);

              if (game.lives <= 0) {
                gameActiveRef.current = false;
                setGamePhase("gameover");
              }
            }
          }
        }

        for (const beam of game.beams) {
          beam.life -= dt;
        }
        game.beams = game.beams.filter(
          (beam) => beam.life > 0,
        );

        for (const particle of game.particles) {
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          particle.vx *= 0.97;
          particle.vy *= 0.97;
          particle.life -= dt;
        }
        game.particles = game.particles.filter(
          (particle) => particle.life > 0,
        );

        if (now - game.lastHudUpdate > 180) {
          game.lastHudUpdate = now;
          setShieldEnergy(Math.round(game.shieldEnergy));
        }

        if (shielding) {
          ctx.save();
          ctx.strokeStyle = "rgba(102,221,255,0.9)";
          ctx.lineWidth = 3;
          ctx.shadowBlur = 20;
          ctx.shadowColor = "#66ddff";
          ctx.beginPath();
          ctx.arc(
            cx,
            cy,
            coreRadius + 22 + Math.sin(now * 0.01) * 4,
            0,
            Math.PI * 2,
          );
          ctx.stroke();
          ctx.restore();
        }

        for (const enemy of game.enemies) {
          ctx.save();
          ctx.translate(enemy.x, enemy.y);
          ctx.rotate(enemy.angle);
          ctx.strokeStyle = enemy.elite
            ? "#ff5544"
            : "#ffb13b";
          ctx.fillStyle = enemy.elite
            ? "rgba(255,70,50,0.12)"
            : "rgba(255,177,59,0.1)";
          ctx.lineWidth = enemy.elite ? 2.5 : 1.5;
          ctx.shadowBlur = enemy.elite ? 18 : 10;
          ctx.shadowColor = enemy.elite
            ? "#ff5533"
            : "#ffaa30";

          ctx.beginPath();
          ctx.moveTo(0, -enemy.r);
          ctx.lineTo(enemy.r, 0);
          ctx.lineTo(0, enemy.r);
          ctx.lineTo(-enemy.r, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          ctx.rotate(-enemy.angle * 1.7);
          ctx.beginPath();
          ctx.arc(0, 0, enemy.r * 0.55, 0, Math.PI * 2);
          ctx.stroke();

          if (enemy.maxHp > 1) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = "rgba(255,255,255,0.25)";
            ctx.fillRect(
              -enemy.r,
              enemy.r + 7,
              enemy.r * 2,
              3,
            );
            ctx.fillStyle = "#ff6655";
            ctx.fillRect(
              -enemy.r,
              enemy.r + 7,
              enemy.r * 2 * (enemy.hp / enemy.maxHp),
              3,
            );
          }
          ctx.restore();
        }

        for (const beam of game.beams) {
          const alpha = Math.max(0, beam.life / 0.12);
          ctx.save();
          ctx.strokeStyle =
            "rgba(255,210,120," + alpha + ")";
          ctx.lineWidth = 2 + alpha * 3;
          ctx.shadowBlur = 18;
          ctx.shadowColor = "#ffb13b";
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(beam.x, beam.y);
          ctx.stroke();
          ctx.restore();
        }

        for (const particle of game.particles) {
          const alpha = Math.max(
            0,
            Math.min(1, particle.life / 0.45),
          );
          ctx.fillStyle =
            "rgba(255,180,70," + alpha + ")";
          ctx.beginPath();
          ctx.arc(
            particle.x,
            particle.y,
            particle.size,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }

        const aimX = aimRef.current.x * width;
        const aimY = aimRef.current.y * height;
        const locked = game.enemies.some(
          (enemy) =>
            Math.hypot(enemy.x - aimX, enemy.y - aimY) <=
            enemy.r + 34,
        );

        ctx.save();
        ctx.translate(aimX, aimY);
        ctx.strokeStyle = locked ? "#fff1b0" : "#ffaa30";
        ctx.lineWidth = locked ? 2.5 : 1.5;
        ctx.shadowBlur = locked ? 18 : 9;
        ctx.shadowColor = locked ? "#fff1b0" : "#ffaa30";
        ctx.beginPath();
        ctx.arc(0, 0, locked ? 22 : 17, 0, Math.PI * 2);
        ctx.moveTo(-30, 0);
        ctx.lineTo(-10, 0);
        ctx.moveTo(30, 0);
        ctx.lineTo(10, 0);
        ctx.moveTo(0, -30);
        ctx.lineTo(0, -10);
        ctx.moveTo(0, 30);
        ctx.lineTo(0, 10);
        ctx.stroke();

        if (locked) {
          ctx.fillStyle = "#fff1b0";
          ctx.beginPath();
          ctx.arc(0, 0, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.code === "Space" && gameActiveRef.current) {
        event.preventDefault();
        fireShotRef.current();
        return;
      }

      switch (event.key) {
        case "+":
        case "=":
          if (!gameActiveRef.current) {
            sceneRef.current?.zoomIn();
          }
          break;
        case "-":
        case "_":
          if (!gameActiveRef.current) {
            sceneRef.current?.zoomOut();
          }
          break;
        case "r":
        case "R":
          if (!gameActiveRef.current) {
            sceneRef.current?.resetView();
          }
          break;
        case "g":
        case "G":
          toggleGestures();
          break;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleGestures]);

  const cameraOn = camera === "on";
  const gameActive = gamePhase === "playing";

  return (
    <>
      <div ref={containerRef} className="orb-root" />

      <canvas
        ref={gameCanvasRef}
        className={
          "game-canvas" + (gameActive ? " active" : "")
        }
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        aria-label="ULTRON Core Defense game field"
      />

      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      <div className="hud hud-title">
        U.L.T.R.O.N.
        <div className="hud-subtitle">
          CORE DEFENSE // GESTURE COMBAT
        </div>
      </div>

      {gamePhase !== "idle" && (
        <div className="hud game-stats">
          <div>
            <span>SCORE</span>
            <strong>{score.toLocaleString()}</strong>
          </div>
          <div>
            <span>WAVE</span>
            <strong>{wave}</strong>
          </div>
          <div>
            <span>CORE</span>
            <strong>{"◆".repeat(Math.max(0, lives))}</strong>
          </div>
          <div>
            <span>COMBO</span>
            <strong>x{combo}</strong>
          </div>
          <div className="shield-stat">
            <span>SHIELD</span>
            <div className="shield-track">
              <div
                className="shield-fill"
                style={{ width: shieldEnergy + "%" }}
              />
            </div>
          </div>
        </div>
      )}

      {gamePhase === "idle" && (
        <div className="hud game-card">
          <div className="game-kicker">
            HAND GESTURE GAME
          </div>
          <div className="game-name">
            ULTRON // CORE DEFENSE
          </div>
          <div className="game-copy">
            Move your hand to aim. Pinch to fire.
            Pinch with both hands to activate the core shield.
          </div>
          <button
            type="button"
            className="game-primary-btn"
            onClick={startGame}
          >
            START DEFENSE
          </button>
          <div className="game-mini">
            Mouse/tap also works as backup controls.
          </div>
        </div>
      )}

      {gamePhase === "gameover" && (
        <div className="hud game-card gameover-card">
          <div className="game-kicker">CORE BREACHED</div>
          <div className="game-name">
            FINAL SCORE {score.toLocaleString()}
          </div>
          <div className="game-copy">
            Wave {wave} reached · Best combo x{combo}
          </div>
          <button
            type="button"
            className="game-primary-btn"
            onClick={startGame}
          >
            RESTART DEFENSE
          </button>
          <button
            type="button"
            className="game-secondary-btn"
            onClick={stopGame}
          >
            EXIT GAME
          </button>
        </div>
      )}

      <div className="hud hud-hint">
        {gameActive ? (
          <>
            <div>
              <span className="key">MOVE HAND</span> aim&nbsp;&nbsp;
              <span className="key">PINCH</span> fire
            </div>
            <div>
              <span className="key">BOTH PINCH</span> shield&nbsp;&nbsp;
              <span className="key">SPACE / TAP</span> backup fire
            </div>
          </>
        ) : (
          <>
            <div>
              <span className="key">DRAG</span> spin&nbsp;&nbsp;
              <span className="key">SCROLL</span> zoom
            </div>
            <div>
              <span className="key">G</span> hand gestures&nbsp;&nbsp;
              <span className="key">R</span> reset
            </div>
          </>
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
              ? gameActive
                ? status.hands +
                  " HAND" +
                  (status.hands > 1 ? "S" : "") +
                  " · " +
                  (status.hands > 1 ? "SHIELD READY" : "TARGETING")
                : status.hands +
                  " HAND" +
                  (status.hands > 1 ? "S" : "") +
                  " · " +
                  MODE_LABEL[status.mode]
              : "SHOW HANDS"}
          </div>
        </div>

        {error && <div className="hud-error">{error}</div>}

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
                ? "CAMERA ON"
                : "CAMERA OFF"}
          </button>
          {gameActive && (
            <button
              type="button"
              className="hud-btn danger"
              onClick={stopGame}
            >
              END GAME
            </button>
          )}
        </div>

        {!gameActive && gamePhase === "idle" && (
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
        )}
      </div>
    </>
  );
}
