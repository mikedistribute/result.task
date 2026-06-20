"use node"

import { v } from "convex/values"
import { internal } from "./_generated/api"
import { Id } from "./_generated/dataModel"
import { ActionCtx, internalAction } from "./_generated/server"

type CompanyProfile = {
  companyName: string
  productUrl: string | null
  category: string
  productSummary: string
  targetUser: string
  painPoints: string[]
  productBenefits: string[]
  keywords: string[]
}

type MemeConcept = {
  caption: string
  jokeAngle: string
  foregroundQuery: string
  backgroundQuery: string
  audioMood: "dramatic" | "chill" | "victory" | "awkward" | "chaotic"
  score?: number
}

type ClipAsset = {
  source: "klipy" | "vlipsy" | "fallback"
  title: string
  url: string
  previewUrl?: string
  hasAudio: boolean
  relevanceScore?: number
}

type VideoCandidate = {
  url: string
  previewUrl?: string
  title?: string
  metadataText: string
  relevanceScore: number
}

type PipelineLogger = (
  step: string,
  message: string,
  data?: Record<string, unknown>
) => Promise<void>

export const processJob = internalAction({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const log = createPipelineLogger(ctx, args.jobId)
    try {
      await log("job", "Pipeline action started", { jobId: args.jobId })
      const job = await ctx.runQuery(internal.chat.getJobForPipeline, {
        jobId: args.jobId,
      })
      if (!job) {
        await log("job", "Job not found; aborting")
        return null
      }
      await log("job", "Loaded job", {
        promptChars: job.prompt.length,
        sessionId: job.sessionId,
      })

      await ctx.runMutation(internal.chat.updatePipelineState, {
        jobId: args.jobId,
        status: "researching",
        content: "Reading the product site...",
      })

      const extractedUrl = extractUrl(job.prompt)
      await log("research", "Extracted URL from prompt", { extractedUrl })
      const siteText = extractedUrl
        ? await researchProductSite(extractedUrl, log)
        : ""
      await log("research", "Research context ready", {
        contextChars: siteText.length,
        contextPreview: siteText.slice(0, 500),
      })

      await ctx.runMutation(internal.chat.updatePipelineState, {
        jobId: args.jobId,
        status: "planning",
        content: "Writing meme concepts and searching KLIPY/Vlipsy clips...",
      })

      const { profile, concepts } = await planVideo(job.prompt, siteText, log)
      const selectedConcepts = [
        ...concepts.slice(0, 3),
        fallbackConcept(profile),
        fallbackConcept(profile),
        fallbackConcept(profile),
      ].slice(0, 3)
      const usedAssetUrls = new Set<string>()
      const renderPlans = []

      for (const [index, concept] of selectedConcepts.entries()) {
        await log("concept", "Selected concept", {
          index,
          caption: concept.caption,
          jokeAngle: concept.jokeAngle,
          foregroundQuery: concept.foregroundQuery,
          backgroundQuery: concept.backgroundQuery,
          audioMood: concept.audioMood,
          score: concept.score ?? null,
        })
        const foreground = await findForegroundClip(
          concept.foregroundQuery,
          log,
          usedAssetUrls
        )
        usedAssetUrls.add(foreground.url)
        const background = await findBackgroundClip(
          concept.backgroundQuery,
          log,
          usedAssetUrls
        )
        usedAssetUrls.add(background.url)

        const foregroundStored = await storeRemoteAsset(
          ctx,
          foreground.url,
          `video_${index + 1}_foreground`,
          log
        )
        const backgroundStored = await storeRemoteAsset(
          ctx,
          background.url,
          `video_${index + 1}_background`,
          log
        )

        renderPlans.push({
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
        })
      }

      await ctx.runMutation(internal.chat.updatePipelineState, {
        jobId: args.jobId,
        status: "needs_client_render",
        companyProfile: profile,
        renderPlan: renderPlans[0],
        renderPlans,
        content: `Found ${renderPlans.length} angles. Rendering the videos now...`,
      })
      await log("render_plan", "Render plan ready for browser recorder", {
        count: renderPlans.length,
        plans: renderPlans.map((plan, index) => ({
          index,
          caption: plan.caption,
          foregroundSource: plan.foreground.source,
          foregroundTitle: plan.foreground.title,
          foregroundScore: plan.foreground.relevanceScore ?? null,
          backgroundSource: plan.background.source,
          backgroundTitle: plan.background.title,
          backgroundScore: plan.background.relevanceScore ?? null,
        })),
      })
    } catch (error) {
      await log("error", "Pipeline failed", {
        error: error instanceof Error ? error.message : String(error),
      })
      await ctx.runMutation(internal.chat.updatePipelineState, {
        jobId: args.jobId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        content: `Pipeline failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      })
    }
    return null
  },
})

function createPipelineLogger(
  ctx: ActionCtx,
  jobId: Id<"jobs">
): PipelineLogger {
  return async (step, message, data) => {
    const safeData = data === undefined ? undefined : sanitizeForLog(data)
    console.log(`[pipeline:${jobId}] ${step}: ${message}`, safeData ?? {})
    await ctx.runMutation(internal.chat.addJobLog, {
      jobId,
      step,
      message,
      data: safeData,
    })
  }
}

async function researchProductSite(url: string, log: PipelineLogger) {
  await log("research", "Starting product research", { url })
  const firecrawlText = await scrapeSite(url, log)
  if (firecrawlText) {
    await log("research", "Using Firecrawl research context", {
      chars: firecrawlText.length,
    })
    return firecrawlText
  }
  await log(
    "research",
    "Firecrawl returned no usable context; trying raw HTML fallback",
    {
      url,
    }
  )
  const htmlText = await fetchReadableHtml(url, log)
  if (htmlText) {
    await log("research", "Using raw HTML fallback context", {
      chars: htmlText.length,
    })
  } else {
    await log("research", "No product context could be retrieved", { url })
  }
  return htmlText
}

async function scrapeSite(url: string, log: PipelineLogger) {
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY
  if (!firecrawlApiKey) {
    await log("firecrawl", "Missing FIRECRAWL_API_KEY; skipping Firecrawl")
    return ""
  }

  await log("firecrawl", "Calling Firecrawl scrape API", { url })
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
  })

  await log("firecrawl", "Firecrawl response received", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  })

  if (!response.ok) {
    await log("firecrawl", "Firecrawl request failed", {
      status: response.status,
      bodyPreview: (await response.text()).slice(0, 500),
    })
    return ""
  }

  const json = await response.json()
  const data = json.data ?? json
  const text = [
    data.markdown,
    data.html,
    data.metadata?.title,
    data.metadata?.description,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 12000)
  await log("firecrawl", "Firecrawl content extracted", {
    chars: text.length,
    title: data.metadata?.title ?? null,
    description: data.metadata?.description ?? null,
    preview: text.slice(0, 500),
  })
  return text
}

async function fetchReadableHtml(url: string, log: PipelineLogger) {
  try {
    await log("html_fallback", "Fetching raw website HTML", { url })
    const response = await fetch(url, {
      headers: { "User-Agent": "result-dev-ugc-agent" },
    })
    await log("html_fallback", "Raw HTML response received", {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    })
    if (!response.ok) {
      return ""
    }
    const html = await response.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000)
    await log("html_fallback", "Raw HTML text extracted", {
      chars: text.length,
      preview: text.slice(0, 500),
    })
    return text
  } catch (error) {
    await log("html_fallback", "Raw HTML fallback failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return ""
  }
}

async function planVideo(
  prompt: string,
  siteText: string,
  log: PipelineLogger
) {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicApiKey) {
    await log("claude", "Missing ANTHROPIC_API_KEY; using fallback concept")
    const profile = fallbackProfile(prompt)
    await log("fallback", "Fallback profile/concept created", {
      profile,
      concept: fallbackConcept(profile),
    })
    return { profile, concepts: [fallbackConcept(profile)] }
  }

  const model = "claude-opus-4-6"
  await log("claude", "Calling Claude creative director", {
    model,
    promptChars: prompt.length,
    researchContextChars: siteText.length,
    researchContextPreview: siteText.slice(0, 500),
  })
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2600,
      temperature: 0.9,
      system: buildCreativeDirectorSystemPrompt(),
      messages: [
        {
          role: "user",
          content: `Create the best UGC-style short video plan for this chat request.

User message:
${prompt}

Researched product context from crawler/search:
${siteText || "No crawled content was available. Infer cautiously from the user message, but still produce a usable plan."}

Return ONLY valid JSON with this exact shape:
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
      "audioMood": "dramatic" | "chill" | "victory" | "awkward" | "chaotic",
      "score": number
    }
  ]
}`,
        },
      ],
    }),
  })

  await log("claude", "Claude response received", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  })

  if (!response.ok) {
    await log("claude", "Claude request failed; using fallback concept", {
      status: response.status,
      bodyPreview: (await response.text()).slice(0, 800),
    })
    const profile = fallbackProfile(prompt)
    await log("fallback", "Fallback profile/concept created", {
      profile,
      concept: fallbackConcept(profile),
    })
    return { profile, concepts: [fallbackConcept(profile)] }
  }

  const json = await response.json()
  const text =
    json.content?.find((part: { type: string }) => part.type === "text")
      ?.text ?? ""
  await log("claude", "Claude text extracted", {
    textChars: text.length,
    textPreview: text.slice(0, 800),
  })
  const parsed = parseJsonBlock(text) as {
    profile: CompanyProfile
    concepts: MemeConcept[]
  } | null

  if (!parsed?.profile || !Array.isArray(parsed.concepts)) {
    await log("claude", "Claude JSON parse failed; using fallback concept", {
      rawTextPreview: text.slice(0, 1200),
    })
    const profile = fallbackProfile(prompt)
    await log("fallback", "Fallback profile/concept created", {
      profile,
      concept: fallbackConcept(profile),
    })
    return { profile, concepts: [fallbackConcept(profile)] }
  }

  const concepts = parsed.concepts
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 5)
  await log("claude", "Claude JSON parsed successfully", {
    companyName: parsed.profile.companyName,
    category: parsed.profile.category,
    conceptCount: concepts.length,
    concepts: concepts.map((concept) => ({
      caption: concept.caption,
      foregroundQuery: concept.foregroundQuery,
      backgroundQuery: concept.backgroundQuery,
      score: concept.score ?? null,
    })),
  })
  return {
    profile: parsed.profile,
    concepts,
  }
}

function buildCreativeDirectorSystemPrompt() {
  return `You are the creative director and asset-search planner for a tiny web app that assembles UGC-style meme videos.

The assignment:
- A user sends a product description and usually a URL.
- The app researches the URL and product context.
- The app must assemble a 5-10 second UGC-style video from existing assets.
- The video has four layers: background video/photo, trendy text overlay, trending audio, and a foreground GIF/video clip on top.
- The app must be AI-organized, not AI-generated. Do not propose generated footage, background removal, avatars, or synthetic scenes.

Your job:
1. Understand the product from the user message AND crawled site content.
2. Find the specific emotional/comedic tension behind the product.
3. Write social-native captions that feel like memes people actually post.
4. Produce asset-search queries for KLIPY/Vlipsy-style short clips.
5. Rank the concepts and put the strongest one first.

Critical behavior:
- ALWAYS ground the joke in the researched product context when available: category, user pain, promised shortcut, buyer/user identity, and funny before/after contrast.
- If crawler content exists, use it. Do not ignore the site and do not make generic "productivity app" jokes.
- Prefer concrete product language over vague benefits. For a calorie app, use calories, macros, food logging, meal tracking, gym, cut/bulk, protein, etc.
- The output should sell the product indirectly through the joke. It must not read like an ad.
- The foreground clip is the most important layer. The foregroundQuery must be broad enough to find real reaction clips but specific enough to match the joke.
- Good foreground queries are short: "confused guy thinking", "dramatic stare", "celebrity confused", "man celebrating", "awkward silence", "shocked reaction", "guy pretending confident".
- Do not include brand names in foregroundQuery unless the brand itself is a common searchable meme/person.
- BackgroundQuery should be a vibe/place/situation that reinforces the product: "gym locker room", "kitchen meal prep", "office desk", "modern bedroom", "restaurant table", "phone scrolling".
- Captions should be lowercase or casual sentence case, 1-3 short lines, readable at the top of a vertical video.
- Avoid hashtags, emoji, corporate words, long explanations, and claims that need legal substantiation.
- Do not mention APIs, Firecrawl, Claude, KLIPY, Vlipsy, Convex, or implementation details.
- Output only valid JSON. No markdown, no commentary.

Concept scoring:
- score 90-100: product-specific, instantly understandable, funny, clip-searchable, and likely to work in 5-10 seconds.
- score 70-89: good but less sharp or less product-specific.
- score below 70: avoid unless no better option.

For every concept:
- caption: the actual overlay text.
- jokeAngle: why this is funny and how it connects to the product.
- foregroundQuery: search query for the top reaction/GIF/video layer.
- backgroundQuery: search query for the background layer.
- audioMood: the kind of audio if foreground audio is absent.
- score: your ranking score.`
}

async function findForegroundClip(
  query: string,
  log: PipelineLogger,
  usedUrls: Set<string>
): Promise<ClipAsset> {
  await log("asset_search", "Searching foreground reaction clip", { query })
  const clip =
    (await searchVlipsy(query, log, usedUrls)) ??
    (await searchKlipy(query, log, usedUrls)) ??
    fallbackClip(query)
  await log("asset_search", "Foreground clip selected", {
    query,
    source: clip.source,
    title: clip.title,
    url: clip.url,
    previewUrl: clip.previewUrl ?? null,
  })
  return clip
}

async function findBackgroundClip(
  query: string,
  log: PipelineLogger,
  usedUrls: Set<string>
): Promise<ClipAsset> {
  const backgroundQuery = `${query} background`
  await log("asset_search", "Searching background clip", {
    query: backgroundQuery,
  })
  const clip =
    (await searchVlipsy(backgroundQuery, log, usedUrls)) ??
    (await searchKlipy(backgroundQuery, log, usedUrls)) ??
    fallbackClip(query)
  await log("asset_search", "Background clip selected", {
    query: backgroundQuery,
    source: clip.source,
    title: clip.title,
    url: clip.url,
    previewUrl: clip.previewUrl ?? null,
  })
  return clip
}

async function searchKlipy(
  query: string,
  log: PipelineLogger,
  usedUrls: Set<string>
): Promise<ClipAsset | null> {
  const endpoint = resolveKlipyEndpoint()
  const url = new URL(endpoint)
  url.searchParams.set("q", query)
  url.searchParams.set("query", query)
  url.searchParams.set("limit", "10")

  const headers: Record<string, string> = {}
  if (process.env.KLIPY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.KLIPY_API_KEY}`
    headers["x-api-key"] = process.env.KLIPY_API_KEY
  }

  try {
    await log("klipy", "Calling KLIPY clips endpoint", {
      query,
      endpoint: redactUrl(url.toString()),
      hasApiKey: Boolean(process.env.KLIPY_API_KEY),
    })
    const response = await fetch(url, { headers })
    await log("klipy", "KLIPY response received", {
      query,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    })
    if (!response.ok) {
      await log("klipy", "KLIPY request failed", {
        query,
        bodyPreview: (await response.text()).slice(0, 800),
      })
      return null
    }
    const json = await response.json()
    const candidates = collectVideoCandidates(json, query)
      .filter((candidate) => !usedUrls.has(candidate.url))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
    const asset = candidates[0] ?? null
    const isTrendingEndpoint = url.pathname.includes("/trending")
    const shouldRejectAsIrrelevant =
      isTrendingEndpoint && (!asset || asset.relevanceScore <= 0)
    await log(
      "klipy",
      asset && !shouldRejectAsIrrelevant
        ? "KLIPY asset found"
        : "KLIPY returned no query-relevant video asset",
      {
        query,
        endpointType: isTrendingEndpoint ? "trending" : "search",
        candidateCount: candidates.length,
        asset: asset
          ? {
              title: asset.title ?? null,
              url: asset.url,
              previewUrl: asset.previewUrl ?? null,
              relevanceScore: asset.relevanceScore,
            }
          : null,
        topCandidates: candidates.slice(0, 5).map((candidate) => ({
          title: candidate.title ?? null,
          url: candidate.url,
          relevanceScore: candidate.relevanceScore,
          metadataPreview: candidate.metadataText.slice(0, 180),
        })),
      }
    )
    if (!asset || shouldRejectAsIrrelevant) {
      return null
    }
    return asset
      ? {
          source: "klipy",
          title: asset.title ?? query,
          url: asset.url,
          previewUrl: asset.previewUrl,
          hasAudio: true,
          relevanceScore: asset.relevanceScore,
        }
      : null
  } catch (error) {
    await log("klipy", "KLIPY search threw", {
      query,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function resolveKlipyEndpoint() {
  const apiKey = process.env.KLIPY_API_KEY ?? ""
  const configured = process.env.KLIPY_CLIPS_ENDPOINT
  const baseUrl = process.env.KLIPY_BASE_URL ?? "https://api.klipy.com"
  const rawEndpoint = configured
    ? extractUrlFromMaybeCurl(configured)
    : `${baseUrl}/api/v1/${apiKey}/clips/trending?page=1&per_page=10&customer_id=result-dev&locale=en&content_filter=high`

  return rawEndpoint
    .replaceAll("{app_key}", apiKey)
    .replaceAll("{page}", "1")
    .replaceAll("{per_page}", "10")
    .replaceAll("{customer_id}", "result-dev")
    .replaceAll("{locale}", "en")
    .replaceAll("{content_filter}", "high")
}

function extractUrlFromMaybeCurl(value: string) {
  const match = value.match(/https:\/\/[^'"\s]+/)
  return match?.[0] ?? value
}

async function searchVlipsy(
  query: string,
  log: PipelineLogger,
  usedUrls: Set<string>
): Promise<ClipAsset | null> {
  try {
    const url = `https://vlipsy.com/search/${encodeURIComponent(query)}`
    await log("vlipsy", "Fetching Vlipsy search page", { query, url })
    const response = await fetch(url, {
      headers: { "User-Agent": "result-dev-screening-task" },
    })
    await log("vlipsy", "Vlipsy response received", {
      query,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
    })
    if (!response.ok) {
      return null
    }
    const html = await response.text()
    const match =
      html.match(/https:\/\/[^"'<>]+\.mp4[^"'<>]*/i) ??
      html.match(/https:\/\/[^"'<>]+\.webm[^"'<>]*/i)
    if (!match || usedUrls.has(match[0])) {
      await log("vlipsy", "Vlipsy returned no direct video URL", {
        query,
        duplicate: match ? usedUrls.has(match[0]) : false,
        htmlPreview: html.slice(0, 800),
      })
      return null
    }
    const asset = {
      source: "vlipsy",
      title: query,
      url: match[0].replace(/\\u002F/g, "/"),
      hasAudio: true,
      relevanceScore: 1,
    } satisfies ClipAsset
    await log("vlipsy", "Vlipsy asset found", {
      query,
      url: asset.url,
    })
    return asset
  } catch (error) {
    await log("vlipsy", "Vlipsy search threw", {
      query,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function storeRemoteAsset(
  ctx: Pick<ActionCtx, "storage">,
  url: string,
  label: string,
  log: PipelineLogger
) {
  await log("asset_download", "Downloading remote asset", { label, url })
  const response = await fetch(url)
  await log("asset_download", "Remote asset response received", {
    label,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length"),
  })
  if (!response.ok) {
    throw new Error(`Could not download asset ${url}`)
  }
  const blob = await response.blob()
  await log("asset_download", "Remote asset blob ready", {
    label,
    size: blob.size,
    type: blob.type,
  })
  const storageId = await ctx.storage.store(blob)
  const storedUrl = await ctx.storage.getUrl(storageId)
  if (!storedUrl) {
    throw new Error("Could not create Convex asset URL")
  }
  await log("asset_download", "Asset stored in Convex storage", {
    label,
    storageId,
    storedUrl,
  })
  return { storageId, url: storedUrl }
}

function collectVideoCandidates(
  value: unknown,
  query: string
): VideoCandidate[] {
  const candidates: VideoCandidate[] = []
  const queue = [value]
  const seen = new Set<unknown>()

  while (queue.length) {
    const current = queue.shift()
    if (!current || seen.has(current)) continue
    seen.add(current)

    if (typeof current === "string" && isVideoUrl(current)) {
      candidates.push({
        url: current,
        metadataText: "",
        relevanceScore: scoreCandidate(query, ""),
      })
      continue
    }

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    if (typeof current === "object") {
      const record = current as Record<string, unknown>
      const direct =
        firstVideoString(record.url) ??
        firstVideoString(record.mp4) ??
        firstVideoString(record.webm) ??
        firstVideoString(record.video) ??
        firstVideoString(record.media_url) ??
        firstVideoString(record.mediaUrl) ??
        firstVideoString(record.file) ??
        firstVideoString(record.src)

      if (direct) {
        const metadataText = metadataTextForCandidate(record)
        candidates.push({
          url: direct,
          previewUrl:
            firstString(record.preview) ??
            firstString(record.thumbnail) ??
            firstString(record.poster) ??
            undefined,
          title:
            firstString(record.title) ?? firstString(record.name) ?? undefined,
          metadataText,
          relevanceScore: scoreCandidate(query, metadataText),
        })
      }
      queue.push(...Object.values(record))
    }
  }

  const byUrl = new Map<string, VideoCandidate>()
  for (const candidate of candidates) {
    const existing = byUrl.get(candidate.url)
    if (
      !existing ||
      candidate.relevanceScore > existing.relevanceScore ||
      candidate.metadataText.length > existing.metadataText.length
    ) {
      byUrl.set(candidate.url, candidate)
    }
  }
  return [...byUrl.values()]
}

function firstVideoString(value: unknown) {
  const text = firstString(value)
  return text && isVideoUrl(text) ? text : null
}

function firstString(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function isVideoUrl(value: string) {
  return /^https:\/\//.test(value) && /\.(mp4|webm|mov)(\?|#|$)/i.test(value)
}

function metadataTextForCandidate(record: Record<string, unknown>) {
  const parts: string[] = []
  const queue: unknown[] = [record]
  const seen = new Set<unknown>()

  while (queue.length) {
    const current = queue.shift()
    if (!current || seen.has(current)) continue
    seen.add(current)

    if (typeof current === "string") {
      if (!isVideoUrl(current) && current.length <= 220) {
        parts.push(current)
      }
      continue
    }

    if (Array.isArray(current)) {
      queue.push(...current)
      continue
    }

    if (typeof current === "object") {
      queue.push(...Object.values(current as Record<string, unknown>))
    }
  }

  return parts.join(" ").slice(0, 2000)
}

function scoreCandidate(query: string, metadataText: string) {
  const queryTokens = tokenizeForSearch(query)
  const metadata = normalizeForSearch(metadataText)
  if (!queryTokens.length || !metadata) return 0

  let score = 0
  for (const token of queryTokens) {
    if (metadata.includes(token)) score += 1
  }
  const phrase = normalizeForSearch(query)
  if (phrase && metadata.includes(phrase)) score += 4
  return score
}

function tokenizeForSearch(value: string) {
  const stopWords = new Set([
    "the",
    "and",
    "with",
    "for",
    "from",
    "that",
    "this",
    "clip",
    "video",
    "gif",
    "background",
    "reaction",
    "person",
    "people",
    "someone",
    "guy",
    "girl",
    "man",
    "woman",
  ])
  return normalizeForSearch(value)
    .split(" ")
    .filter((token) => token.length > 2 && !stopWords.has(token))
}

function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function parseJsonBlock(text: string): unknown | null {
  const trimmed = text.trim()
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim()
  try {
    return JSON.parse(withoutFence)
  } catch {
    const match = withoutFence.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0])
    } catch {
      return null
    }
  }
}

function extractUrl(text: string) {
  const match = text.match(/https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}/i)
  if (!match) return null
  const value = match[0].replace(/[.,]$/, "")
  return value.startsWith("http") ? value : `https://${value}`
}

function fallbackProfile(prompt: string): CompanyProfile {
  const url = extractUrl(prompt)
  const companyName =
    prompt.match(/building\s+([^,.\n]+)/i)?.[1]?.trim() ??
    prompt.match(/(?:for|called)\s+([^,.\n]+)/i)?.[1]?.trim() ??
    "the product"
  const category =
    prompt.match(/,\s*(?:a|an)\s+([^.\n,]+?)(?:\.|,|$)/i)?.[1]?.trim() ??
    prompt
      .match(/(?:it'?s|it is|this is)\s+(?:a|an)\s+([^.\n,]+)/i)?.[1]
      ?.trim() ??
    "product"
  return {
    companyName,
    productUrl: url,
    category,
    productSummary: prompt,
    targetUser: `people dealing with ${category}`,
    painPoints: [`the annoying parts of ${category}`, "decision fatigue"],
    productBenefits: ["does the annoying part for you", "saves time"],
    keywords: [companyName, category, "shortcut", "confidence"],
  }
}

function fallbackConcept(profile: CompanyProfile): MemeConcept {
  const product = profile.companyName || "this app"
  const category = profile.category || "this"
  return {
    caption: `me pretending i have ${category} under control\nthen opening ${product}`,
    jokeAngle: `fake confidence around ${category} meets the product doing the hard part`,
    foregroundQuery: `${category} confused reaction`,
    backgroundQuery: category,
    audioMood: "awkward",
    score: 55,
  }
}

function fallbackClip(query: string): ClipAsset {
  throw new Error(
    `No KLIPY or Vlipsy clip found for "${query}". Add a KLIPY endpoint/key or try a broader prompt.`
  )
}

function sanitizeForLog(
  value: unknown,
  maxChars = 2000
): Record<string, unknown> {
  const seen = new WeakSet<object>()
  const sanitized = JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (typeof item === "string") {
        return redactSecrets(item).slice(0, maxChars)
      }
      if (typeof item === "object" && item !== null) {
        if (seen.has(item)) return "[Circular]"
        seen.add(item)
      }
      return item
    })
  ) as Record<string, unknown>
  return sanitized
}

function redactUrl(value: string) {
  return value
    .replace(/\/api\/v1\/[^/]+\/clips/g, "/api/v1/[KLIPY_API_KEY]/clips")
    .replace(/(app_key=)[^&]+/g, "$1[REDACTED]")
    .replace(/(key=)[^&]+/g, "$1[REDACTED]")
}

function redactSecrets(value: string) {
  return value
    .replace(/fc-[A-Za-z0-9_-]+/g, "fc-[REDACTED]")
    .replace(/sk-ant-api[0-9A-Za-z_-]+/g, "sk-ant-api[REDACTED]")
    .replace(/[A-Za-z0-9]{32,}/g, (match) =>
      match.length > 48 ? `${match.slice(0, 6)}...[REDACTED]` : match
    )
}
