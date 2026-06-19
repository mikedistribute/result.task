"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { ActionCtx, internalAction } from "./_generated/server";

type CompanyProfile = {
  companyName: string;
  productUrl: string | null;
  category: string;
  productSummary: string;
  targetUser: string;
  painPoints: string[];
  productBenefits: string[];
  keywords: string[];
};

type MemeConcept = {
  caption: string;
  jokeAngle: string;
  foregroundQuery: string;
  backgroundQuery: string;
  audioMood: "dramatic" | "chill" | "victory" | "awkward" | "chaotic";
};

type ClipAsset = {
  source: "klipy" | "vlipsy" | "fallback";
  title: string;
  url: string;
  previewUrl?: string;
  hasAudio: boolean;
};

export const processJob = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    try {
      const job = await ctx.runQuery(internal.chat.getJobForPipeline, {
        jobId: args.jobId,
      });
      if (!job) {
        return null;
      }

      await ctx.runMutation(internal.chat.updatePipelineState, {
        jobId: args.jobId,
        status: "researching",
        content: "Reading the product site...",
      });

      const extractedUrl = extractUrl(job.prompt);
      const siteText = extractedUrl ? await scrapeSite(extractedUrl) : "";

      await ctx.runMutation(internal.chat.updatePipelineState, {
        jobId: args.jobId,
        status: "planning",
        content: "Writing meme concepts and searching KLIPY/Vlipsy clips...",
      });

      const { profile, concepts } = await planVideo(job.prompt, siteText);
      const concept = concepts[0] ?? fallbackConcept(profile);
      const foreground = await findForegroundClip(concept.foregroundQuery);
      const background = await findBackgroundClip(concept.backgroundQuery);

      const foregroundStored = await storeRemoteAsset(ctx, foreground.url);
      const backgroundStored = await storeRemoteAsset(ctx, background.url);

      const renderPlan = {
        durationSec: 8,
        caption: concept.caption,
        jokeAngle: concept.jokeAngle,
        foreground: {
          ...foreground,
          storageId: foregroundStored.storageId,
          url: foregroundStored.url,
          fit: "contain",
          scale: 0.86,
          position: "bottom",
        },
        background: {
          ...background,
          storageId: backgroundStored.storageId,
          url: backgroundStored.url,
          fit: "cover",
        },
        audio: {
          useForegroundAudio: foreground.hasAudio,
          mood: concept.audioMood,
        },
      };

      await ctx.runMutation(internal.chat.updatePipelineState, {
        jobId: args.jobId,
        status: "needs_client_render",
        companyProfile: profile,
        renderPlan,
        content: `Found the angle: "${concept.caption}" Rendering the video now...`,
      });
    } catch (error) {
      await ctx.runMutation(internal.chat.updatePipelineState, {
        jobId: args.jobId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        content: `Pipeline failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
    return null;
  },
});

async function scrapeSite(url: string) {
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
  if (!firecrawlApiKey) {
    return "";
  }

  const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firecrawlApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown", "html"],
      onlyMainContent: true,
      timeout: 15000,
    }),
  });

  if (!response.ok) {
    return "";
  }

  const json = await response.json();
  const data = json.data ?? json;
  return [data.markdown, data.html, data.metadata?.title, data.metadata?.description]
    .filter(Boolean)
    .join("\n")
    .slice(0, 12000);
}

async function planVideo(prompt: string, siteText: string) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    const profile = fallbackProfile(prompt);
    return { profile, concepts: [fallbackConcept(profile)] };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 1800,
      temperature: 0.8,
      messages: [
        {
          role: "user",
          content: `You are a UGC meme producer. Return ONLY valid JSON with this shape:
{
  "profile": {
    "companyName": string,
    "productUrl": string | null,
    "category": string,
    "productSummary": string,
    "targetUser": string,
    "painPoints": string[],
    "productBenefits": string[],
    "keywords": string[]
  },
  "concepts": [
    {
      "caption": string,
      "jokeAngle": string,
      "foregroundQuery": string,
      "backgroundQuery": string,
      "audioMood": "dramatic" | "chill" | "victory" | "awkward" | "chaotic"
    }
  ]
}

Make 5 concepts. Captions should feel like short-form social captions, not ads.
Prioritize reaction clips from KLIPY/Vlipsy, so foregroundQuery should be simple pop-culture/reaction terms such as "confused thinking", "dramatic stare", "celebration", "awkward silence".

User prompt:
${prompt}

Website notes:
${siteText}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const profile = fallbackProfile(prompt);
    return { profile, concepts: [fallbackConcept(profile)] };
  }

  const json = await response.json();
  const text =
    json.content?.find((part: { type: string }) => part.type === "text")?.text ??
    "";
  const parsed = parseJsonBlock(text) as
    | { profile: CompanyProfile; concepts: MemeConcept[] }
    | null;

  if (!parsed?.profile || !Array.isArray(parsed.concepts)) {
    const profile = fallbackProfile(prompt);
    return { profile, concepts: [fallbackConcept(profile)] };
  }

  return {
    profile: parsed.profile,
    concepts: parsed.concepts.slice(0, 5),
  };
}

async function findForegroundClip(query: string): Promise<ClipAsset> {
  return (
    (await searchKlipy(query)) ??
    (await searchVlipsy(query)) ??
    fallbackClip(query)
  );
}

async function findBackgroundClip(query: string): Promise<ClipAsset> {
  return (
    (await searchKlipy(`${query} background`)) ??
    (await searchVlipsy(`${query} background`)) ??
    fallbackClip(query)
  );
}

async function searchKlipy(query: string): Promise<ClipAsset | null> {
  const endpoint = resolveKlipyEndpoint();
  const url = new URL(endpoint);
  url.searchParams.set("q", query);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "10");

  const headers: Record<string, string> = {};
  if (process.env.KLIPY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.KLIPY_API_KEY}`;
    headers["x-api-key"] = process.env.KLIPY_API_KEY;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      return null;
    }
    const json = await response.json();
    const asset = pickVideoUrl(json);
    return asset
      ? {
          source: "klipy",
          title: asset.title ?? query,
          url: asset.url,
          previewUrl: asset.previewUrl,
          hasAudio: true,
        }
      : null;
  } catch {
    return null;
  }
}

function resolveKlipyEndpoint() {
  const apiKey = process.env.KLIPY_API_KEY ?? "";
  const configured = process.env.KLIPY_CLIPS_ENDPOINT;
  const baseUrl = process.env.KLIPY_BASE_URL ?? "https://api.klipy.com";
  const rawEndpoint = configured
    ? extractUrlFromMaybeCurl(configured)
    : `${baseUrl}/api/v1/${apiKey}/clips/trending?page=1&per_page=10&customer_id=result-dev&locale=en&content_filter=high`;

  return rawEndpoint
    .replaceAll("{app_key}", apiKey)
    .replaceAll("{page}", "1")
    .replaceAll("{per_page}", "10")
    .replaceAll("{customer_id}", "result-dev")
    .replaceAll("{locale}", "en")
    .replaceAll("{content_filter}", "high");
}

function extractUrlFromMaybeCurl(value: string) {
  const match = value.match(/https:\/\/[^'"\s]+/);
  return match?.[0] ?? value;
}

async function searchVlipsy(query: string): Promise<ClipAsset | null> {
  try {
    const url = `https://vlipsy.com/search/${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "result-dev-screening-task" },
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    const match =
      html.match(/https:\/\/[^"'<>]+\.mp4[^"'<>]*/i) ??
      html.match(/https:\/\/[^"'<>]+\.webm[^"'<>]*/i);
    if (!match) {
      return null;
    }
    return {
      source: "vlipsy",
      title: query,
      url: match[0].replace(/\\u002F/g, "/"),
      hasAudio: true,
    };
  } catch {
    return null;
  }
}

async function storeRemoteAsset(
  ctx: Pick<ActionCtx, "storage">,
  url: string,
) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download asset ${url}`);
  }
  const blob = await response.blob();
  const storageId = await ctx.storage.store(blob);
  const storedUrl = await ctx.storage.getUrl(storageId);
  if (!storedUrl) {
    throw new Error("Could not create Convex asset URL");
  }
  return { storageId, url: storedUrl };
}

function pickVideoUrl(value: unknown): { url: string; previewUrl?: string; title?: string } | null {
  const queue = [value];
  const seen = new Set<unknown>();

  while (queue.length) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === "string" && isVideoUrl(current)) {
      return { url: current };
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      const direct =
        firstVideoString(record.url) ??
        firstVideoString(record.mp4) ??
        firstVideoString(record.webm) ??
        firstVideoString(record.video) ??
        firstVideoString(record.media_url);

      if (direct) {
        return {
          url: direct,
          previewUrl:
            firstString(record.preview) ??
            firstString(record.thumbnail) ??
            firstString(record.poster) ??
            undefined,
          title: firstString(record.title) ?? firstString(record.name) ?? undefined,
        };
      }
      queue.push(...Object.values(record));
    }
  }
  return null;
}

function firstVideoString(value: unknown) {
  const text = firstString(value);
  return text && isVideoUrl(text) ? text : null;
}

function firstString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isVideoUrl(value: string) {
  return /^https:\/\//.test(value) && /\.(mp4|webm|mov)(\?|#|$)/i.test(value);
}

function parseJsonBlock(text: string): unknown | null {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const match = withoutFence.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function extractUrl(text: string) {
  const match = text.match(/https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}/i);
  if (!match) return null;
  const value = match[0].replace(/[.,]$/, "");
  return value.startsWith("http") ? value : `https://${value}`;
}

function fallbackProfile(prompt: string): CompanyProfile {
  const url = extractUrl(prompt);
  return {
    companyName: prompt.match(/building\s+([^,.\n]+)/i)?.[1]?.trim() ?? "the product",
    productUrl: url,
    category: "consumer app",
    productSummary: prompt,
    targetUser: "busy people who want the shortcut",
    painPoints: ["manual work", "decision fatigue", "trying to look competent"],
    productBenefits: ["does the annoying part for you", "saves time"],
    keywords: ["shortcut", "automation", "confidence"],
  };
}

function fallbackConcept(profile: CompanyProfile): MemeConcept {
  const product = profile.companyName || "this app";
  const category = profile.category || "this";
  return {
    caption: `me acting like i know ${category} so i just open ${product} and let it handle it`,
    jokeAngle: "fake confidence meets useful automation",
    foregroundQuery: "thinking reaction",
    backgroundQuery: "modern apartment",
    audioMood: "awkward",
  };
}

function fallbackClip(query: string): ClipAsset {
  throw new Error(
    `No KLIPY or Vlipsy clip found for "${query}". Add a KLIPY endpoint/key or try a broader prompt.`,
  );
}
