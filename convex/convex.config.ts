import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    ANTHROPIC_API_KEY: v.optional(v.string()),
    FIRECRAWL_API_KEY: v.optional(v.string()),
    KLIPY_API_KEY: v.optional(v.string()),
    KLIPY_BASE_URL: v.optional(v.string()),
    KLIPY_CLIPS_ENDPOINT: v.optional(v.string()),
  },
});

export default app;
