"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

type RenderPlan = {
  durationSec: number;
  caption: string;
  foreground: {
    url: string;
    scale?: number;
    position?: "bottom" | "center";
  };
  background: {
    url: string;
  };
  audio?: {
    useForegroundAudio?: boolean;
  };
};

export function VideoRenderer({
  jobId,
  plan,
  onDone,
}: {
  jobId: Id<"jobs">;
  plan: RenderPlan;
  onDone?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const startedRef = useRef(false);
  const markClientRendering = useMutation(api.chat.markClientRendering);
  const generateVideoUploadUrl = useMutation(api.chat.generateVideoUploadUrl);
  const finishClientRender = useMutation(api.chat.finishClientRender);
  const failClientRender = useMutation(api.chat.failClientRender);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        await markClientRendering({ jobId });
        const blob = await renderPlanToWebm(canvasRef.current, plan);
        const uploadUrl = await generateVideoUploadUrl();
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "video/webm" },
          body: blob,
        });
        if (!uploadResponse.ok) {
          throw new Error("Convex upload failed");
        }
        const { storageId } = (await uploadResponse.json()) as {
          storageId: Id<"_storage">;
        };
        await finishClientRender({ jobId, storageId });
        onDone?.();
      } catch (error) {
        await failClientRender({
          jobId,
          error: error instanceof Error ? error.message : "Unknown render error",
        });
      }
    })();
  }, [
    failClientRender,
    finishClientRender,
    generateVideoUploadUrl,
    jobId,
    markClientRendering,
    onDone,
    plan,
  ]);

  return (
    <canvas
      ref={canvasRef}
      width={360}
      height={640}
      className="aspect-[9/16] w-28 rounded border border-black/10 bg-black shadow-sm"
    />
  );
}

async function renderPlanToWebm(
  canvas: HTMLCanvasElement | null,
  plan: RenderPlan,
) {
  if (!canvas) throw new Error("Renderer canvas missing");
  if (!("MediaRecorder" in window)) {
    throw new Error("This browser does not support MediaRecorder");
  }

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas context unavailable");

  const background = await loadVideo(plan.background.url);
  const foreground = await loadVideo(plan.foreground.url);
  background.muted = true;
  background.loop = true;
  foreground.muted = !(plan.audio?.useForegroundAudio ?? true);
  foreground.loop = true;

  await Promise.all([playMedia(background), playMedia(foreground)]);

  const stream = canvas.captureStream(30);
  const chunks: BlobPart[] = [];
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const durationMs = Math.max(5, Math.min(10, plan.durationSec || 8)) * 1000;
  const startedAt = performance.now();
  let frameId = 0;

  const draw = () => {
    const elapsed = performance.now() - startedAt;
    drawFrame(context, canvas, background, foreground, plan, elapsed / durationMs);
    if (elapsed < durationMs) {
      frameId = requestAnimationFrame(draw);
    }
  };

  recorder.start(200);
  draw();

  await new Promise<void>((resolve) => {
    window.setTimeout(() => {
      cancelAnimationFrame(frameId);
      recorder.stop();
      resolve();
    }, durationMs + 200);
  });

  await new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  background.pause();
  foreground.pause();

  return new Blob(chunks, { type: mimeType || "video/webm" });
}

function drawFrame(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  background: HTMLVideoElement,
  foreground: HTMLVideoElement,
  plan: RenderPlan,
  progress: number,
) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawCover(context, background, canvas.width, canvas.height);

  context.save();
  const pulse = 1 + Math.sin(progress * Math.PI) * 0.03;
  const scale = (plan.foreground.scale ?? 0.82) * pulse;
  const width = canvas.width * scale;
  const aspect = foreground.videoHeight
    ? foreground.videoWidth / foreground.videoHeight
    : 1;
  const height = width / aspect;
  const x = (canvas.width - width) / 2;
  const y =
    plan.foreground.position === "center"
      ? (canvas.height - height) / 2 + 40
      : canvas.height - height - 34;
  context.drawImage(foreground, x, y, width, height);
  context.restore();

  drawCaption(context, canvas.width, plan.caption);
}

function drawCover(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  const videoAspect = video.videoWidth / video.videoHeight || 9 / 16;
  const canvasAspect = width / height;
  let sx = 0;
  let sy = 0;
  let sw = video.videoWidth;
  let sh = video.videoHeight;

  if (videoAspect > canvasAspect) {
    sw = video.videoHeight * canvasAspect;
    sx = (video.videoWidth - sw) / 2;
  } else {
    sh = video.videoWidth / canvasAspect;
    sy = (video.videoHeight - sh) / 2;
  }

  context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
  context.fillStyle = "rgba(0, 0, 0, 0.12)";
  context.fillRect(0, 0, width, height);
}

function drawCaption(
  context: CanvasRenderingContext2D,
  width: number,
  caption: string,
) {
  const lines = wrapText(context, caption.toLowerCase(), 25);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.font = "700 20px Arial";

  lines.slice(0, 4).forEach((line, index) => {
    const y = 58 + index * 25;
    context.lineWidth = 5;
    context.strokeStyle = "black";
    context.strokeText(line, width / 2, y);
    context.fillStyle = "white";
    context.fillText(line, width / 2, y);
  });
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxChars: number,
) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);

  return lines.filter((line) => context.measureText(line).width < 330);
}

async function loadVideo(src: string) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.src = src;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error(`Could not load video asset: ${src}`));
  });
  return video;
}

async function playMedia(video: HTMLVideoElement) {
  video.currentTime = 0;
  await video.play();
}

function pickMimeType() {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}
