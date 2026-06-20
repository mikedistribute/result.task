import { v } from "convex/values"
import { internal } from "./_generated/api"
import { Id } from "./_generated/dataModel"
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"

const jobStatus = v.union(
  v.literal("queued"),
  v.literal("researching"),
  v.literal("planning"),
  v.literal("needs_client_render"),
  v.literal("rendering"),
  v.literal("complete"),
  v.literal("failed")
)

export const listMessages = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_sessionId_and_createdAt", (q) =>
        q.eq("sessionId", args.sessionId)
      )
      .order("asc")
      .take(100)
  },
})

export const getJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) {
      return null
    }
    const videoUrl = job.videoStorageId
      ? await ctx.storage.getUrl(job.videoStorageId)
      : (job.videoUrl ?? null)

    const videoUrls =
      job.videoStorageIds && job.videoStorageIds.length > 0
        ? await Promise.all(
            job.videoStorageIds.map(async (storageId) => {
              return await ctx.storage.getUrl(storageId)
            })
          )
        : (job.videoUrls ?? [])

    return {
      ...job,
      videoUrl,
      videoUrls: videoUrls.filter((url): url is string => Boolean(url)),
    }
  },
})

export const listJobLogs = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pipelineLogs")
      .withIndex("by_jobId_and_createdAt", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .take(200)
  },
})

export const sendMessage = mutation({
  args: {
    sessionId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const userMessageId = await ctx.db.insert("messages", {
      sessionId: args.sessionId,
      role: "user",
      content: args.content,
      createdAt: now,
    })
    const assistantMessageId = await ctx.db.insert("messages", {
      sessionId: args.sessionId,
      role: "assistant",
      content: "Researching the product and picking clips...",
      status: "queued",
      createdAt: now + 1,
    })
    const jobId = await ctx.db.insert("jobs", {
      sessionId: args.sessionId,
      prompt: args.content,
      userMessageId,
      assistantMessageId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    })

    await ctx.db.patch(assistantMessageId, { jobId })
    await ctx.scheduler.runAfter(0, internal.pipeline.processJob, { jobId })

    return { jobId }
  },
})

export const markClientRendering = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (
      !job ||
      (job.status !== "needs_client_render" && job.status !== "rendering")
    ) {
      return null
    }
    if (job.status === "rendering") {
      return null
    }
    await ctx.db.patch(args.jobId, {
      status: "rendering",
      updatedAt: Date.now(),
    })
    await ctx.db.patch(job.assistantMessageId, {
      status: "rendering",
      content: "Compositing the clip in your browser...",
    })
    return null
  },
})

export const generateVideoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl()
  },
})

export const finishClientRender = mutation({
  args: {
    jobId: v.id("jobs"),
    storageId: v.id("_storage"),
    renderIndex: v.optional(v.number()),
    totalVideos: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) {
      throw new Error("Job not found")
    }
    const videoUrl = await ctx.storage.getUrl(args.storageId)
    const totalVideos = args.totalVideos ?? 1
    const renderIndex = args.renderIndex ?? 0
    const videoStorageIds = [...(job.videoStorageIds ?? [])]
    const videoUrls = [...(job.videoUrls ?? [])]
    videoStorageIds[renderIndex] = args.storageId
    if (videoUrl) {
      videoUrls[renderIndex] = videoUrl
    }
    const completedUrls = videoUrls.filter(Boolean)
    const isComplete = completedUrls.length >= totalVideos
    const content = isComplete
      ? `Done. Here are the 3 assembled UGC videos:\n${completedUrls
          .map((url, index) => `${index + 1}. ${url}`)
          .join("\n")}`
      : `Rendered video ${completedUrls.length}/${totalVideos}...`

    await ctx.db.patch(args.jobId, {
      status: isComplete ? "complete" : "rendering",
      videoStorageId: videoStorageIds[0],
      videoStorageIds,
      videoUrl: videoUrl ?? undefined,
      videoUrls,
      updatedAt: Date.now(),
    })
    await ctx.db.patch(job.assistantMessageId, {
      status: isComplete ? "complete" : "rendering",
      content,
      videoUrl: videoUrls[0],
    })
    return { videoUrl }
  },
})

export const failClientRender = mutation({
  args: {
    jobId: v.id("jobs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) {
      return null
    }
    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: args.error,
      updatedAt: Date.now(),
    })
    await ctx.db.patch(job.assistantMessageId, {
      status: "failed",
      content: `I found a video concept, but rendering failed: ${args.error}`,
    })
    return null
  },
})

export const updatePipelineState = internalMutation({
  args: {
    jobId: v.id("jobs"),
    status: jobStatus,
    content: v.optional(v.string()),
    companyProfile: v.optional(v.any()),
    renderPlan: v.optional(v.any()),
    renderPlans: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId)
    if (!job) {
      return null
    }

    const patch: {
      status: typeof args.status
      updatedAt: number
      companyProfile?: unknown
      renderPlan?: unknown
      renderPlans?: unknown
      error?: string
    } = {
      status: args.status,
      updatedAt: Date.now(),
    }

    if (args.companyProfile !== undefined) {
      patch.companyProfile = args.companyProfile
    }
    if (args.renderPlan !== undefined) {
      patch.renderPlan = args.renderPlan
    }
    if (args.renderPlans !== undefined) {
      patch.renderPlans = args.renderPlans
    }
    if (args.error !== undefined) {
      patch.error = args.error
    }

    await ctx.db.patch(args.jobId, patch)
    await ctx.db.patch(job.assistantMessageId, {
      status: args.status,
      content: args.content ?? statusCopy(args.status),
    })

    return null
  },
})

export const addJobLog = internalMutation({
  args: {
    jobId: v.id("jobs"),
    step: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("pipelineLogs", {
      jobId: args.jobId,
      step: args.step,
      message: args.message,
      data: args.data,
      createdAt: Date.now(),
    })
    return null
  },
})

export const getJobForPipeline = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId)
  },
})

function statusCopy(status: string) {
  if (status === "researching") return "Reading the product site..."
  if (status === "planning") return "Writing meme concepts and finding clips..."
  if (status === "needs_client_render") return "Assets picked. Rendering now..."
  if (status === "failed") return "Something failed while assembling the video."
  return "Working on it..."
}

export type JobId = Id<"jobs">
