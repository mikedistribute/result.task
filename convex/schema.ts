import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  messages: defineTable({
    sessionId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    jobId: v.optional(v.id("jobs")),
    videoUrl: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("queued"),
        v.literal("researching"),
        v.literal("planning"),
        v.literal("needs_client_render"),
        v.literal("rendering"),
        v.literal("complete"),
        v.literal("failed")
      )
    ),
    createdAt: v.number(),
  }).index("by_sessionId_and_createdAt", ["sessionId", "createdAt"]),

  jobs: defineTable({
    sessionId: v.string(),
    prompt: v.string(),
    userMessageId: v.id("messages"),
    assistantMessageId: v.id("messages"),
    status: v.union(
      v.literal("queued"),
      v.literal("researching"),
      v.literal("planning"),
      v.literal("needs_client_render"),
      v.literal("rendering"),
      v.literal("complete"),
      v.literal("failed")
    ),
    companyProfile: v.optional(v.any()),
    renderPlan: v.optional(v.any()),
    videoStorageId: v.optional(v.id("_storage")),
    videoUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sessionId_and_createdAt", ["sessionId", "createdAt"])
    .index("by_status", ["status"]),

  pipelineLogs: defineTable({
    jobId: v.id("jobs"),
    step: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
    createdAt: v.number(),
  }).index("by_jobId_and_createdAt", ["jobId", "createdAt"]),
})
