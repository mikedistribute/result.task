"use client"

import { FormEvent, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { ArrowUp, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { RenderPlan, VideoRenderer } from "@/components/video-renderer"
import { api } from "@/convex/_generated/api"
import { Id } from "@/convex/_generated/dataModel"
import { cn } from "@/lib/utils"

const starter =
  "I'm building CalAI, a calorie-tracking app. Here's the site: calai.app"

export function ChatApp() {
  const [input, setInput] = useState(starter)
  const [activeJobId, setActiveJobId] = useState<Id<"jobs"> | null>(null)
  const [sessionId, setSessionId] = useState(() => {
    if (typeof window === "undefined") return "server"
    const existing = window.localStorage.getItem("result-session-id")
    if (existing) return existing
    const created = crypto.randomUUID()
    window.localStorage.setItem("result-session-id", created)
    return created
  })

  const messages = useQuery(api.chat.listMessages, { sessionId })
  const latestMessageJobId = messages?.filter((message) => message.jobId).at(-1)
    ?.jobId as Id<"jobs"> | undefined
  const displayedJobId = activeJobId ?? latestMessageJobId ?? null
  const activeJob = useQuery(
    api.chat.getJob,
    displayedJobId ? { jobId: displayedJobId } : "skip"
  )
  const renderPlans = getRenderPlans(activeJob)
  const outputVideoUrls = getVideoUrls(activeJob)
  const jobLogs = useQuery(
    api.chat.listJobLogs,
    displayedJobId ? { jobId: displayedJobId } : "skip"
  )
  const sendMessage = useMutation(api.chat.sendMessage)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = input.trim()
    if (!content) return
    setInput("")
    const result = await sendMessage({ sessionId, content })
    setActiveJobId(result.jobId)
  }

  function startNewSession() {
    const nextSessionId = crypto.randomUUID()
    window.localStorage.setItem("result-session-id", nextSessionId)
    setSessionId(nextSessionId)
    setActiveJobId(null)
    setInput(starter)
  }

  return (
    <main className="min-h-svh bg-white text-black">
      <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col px-4">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-black">
          <div className="text-sm font-semibold">result.dev</div>
          <Button
            type="button"
            variant="outline"
            onClick={startNewSession}
            className="h-8 rounded-none border-black bg-white px-3 text-xs tracking-[0.16em] text-black uppercase hover:bg-black hover:text-white"
          >
            New session
          </Button>
        </header>

        <section className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto py-6">
            {!messages?.length ? (
              <div className="flex h-full min-h-72 items-center justify-center">
                <p className="text-center text-3xl font-semibold tracking-tight sm:text-5xl">
                  What are you building?
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message._id}
                  className={cn(
                    "max-w-[86%] border border-black px-4 py-3 text-sm leading-6 whitespace-pre-wrap",
                    message.role === "user"
                      ? "ml-auto bg-black text-white"
                      : "mr-auto bg-white text-black"
                  )}
                >
                  <p>{message.content}</p>
                  {message.status &&
                    !["complete", "failed"].includes(message.status) && (
                      <div className="mt-3 flex items-center gap-2 text-xs tracking-[0.14em] text-black/55 uppercase mix-blend-difference">
                        <Loader2 className="size-3.5 animate-spin" />
                        {message.status}
                      </div>
                    )}
                  {message.videoUrl && (
                    <video
                      className="mt-3 aspect-[9/16] w-56 border border-black bg-black"
                      src={message.videoUrl}
                      controls
                      playsInline
                    />
                  )}
                </article>
              ))
            )}
          </div>

          {activeJob &&
            ["needs_client_render", "rendering"].includes(activeJob.status) &&
            renderPlans.length > 0 && (
              <div className="border-t border-black py-3">
                <div className="flex flex-wrap items-center gap-3 text-xs tracking-[0.14em] text-black/55 uppercase">
                  {renderPlans.map((plan, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <VideoRenderer
                        jobId={activeJob._id}
                        plan={plan}
                        renderIndex={index}
                        totalVideos={renderPlans.length}
                      />
                      {index + 1}/{renderPlans.length}
                    </div>
                  ))}
                  Rendering videos
                </div>
              </div>
            )}

          {outputVideoUrls.length > 1 && (
            <section className="border-t border-black py-3">
              <div className="grid grid-cols-3 gap-3">
                {outputVideoUrls.map((url, index) => (
                  <video
                    key={url}
                    className="aspect-[9/16] w-full border border-black bg-black"
                    src={url}
                    controls
                    playsInline
                    aria-label={`Generated video ${index + 1}`}
                  />
                ))}
              </div>
            </section>
          )}

          {displayedJobId && (
            <section className="border-t border-black py-3">
              <details open>
                <summary className="cursor-pointer list-none text-xs font-semibold tracking-[0.14em] text-black uppercase">
                  Pipeline logs
                </summary>
                <div className="mt-3 max-h-64 space-y-2 overflow-y-auto border border-black bg-white p-3">
                  {!jobLogs ? (
                    <p className="text-xs tracking-[0.14em] text-black/50 uppercase">
                      Loading logs
                    </p>
                  ) : jobLogs.length === 0 ? (
                    <p className="text-xs tracking-[0.14em] text-black/50 uppercase">
                      No logs yet
                    </p>
                  ) : (
                    jobLogs.map((log) => (
                      <article
                        key={log._id}
                        className="border-b border-black/15 pb-2 last:border-b-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
                          <span className="font-mono text-black/45">
                            {new Date(log.createdAt).toLocaleTimeString()}
                          </span>
                          <span className="font-semibold tracking-[0.12em] uppercase">
                            {log.step}
                          </span>
                          <span>{log.message}</span>
                        </div>
                        {log.data !== undefined && (
                          <pre className="mt-1 font-mono text-[11px] leading-5 break-words whitespace-pre-wrap text-black/65">
                            {formatLogData(log.data)}
                          </pre>
                        )}
                      </article>
                    ))
                  )}
                </div>
              </details>
            </section>
          )}

          <form onSubmit={onSubmit} className="border-t border-black py-4">
            <div className="flex items-end gap-3">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="min-h-20 resize-none rounded-none border-black bg-white px-0 py-0 text-base leading-7 shadow-none focus-visible:ring-0"
                placeholder="Describe the product and paste the site..."
              />
              <Button
                type="submit"
                size="icon"
                className="size-12 shrink-0 rounded-none border border-black bg-black text-white hover:bg-white hover:text-black"
                disabled={!input.trim()}
                aria-label="Send message"
              >
                <ArrowUp className="size-5" />
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}

function formatLogData(data: unknown) {
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function getRenderPlans(job: unknown): RenderPlan[] {
  const record = job as
    | { renderPlans?: unknown; renderPlan?: unknown }
    | null
    | undefined
  if (Array.isArray(record?.renderPlans)) {
    return record.renderPlans.filter(isRenderPlan)
  }
  return isRenderPlan(record?.renderPlan) ? [record.renderPlan] : []
}

function getVideoUrls(job: unknown) {
  const record = job as
    | { videoUrls?: unknown; videoUrl?: unknown }
    | null
    | undefined
  if (Array.isArray(record?.videoUrls)) {
    return record.videoUrls.filter(
      (url): url is string => typeof url === "string"
    )
  }
  return typeof record?.videoUrl === "string" ? [record.videoUrl] : []
}

function isRenderPlan(value: unknown): value is RenderPlan {
  return Boolean(
    value &&
    typeof value === "object" &&
    "caption" in value &&
    "foreground" in value &&
    "background" in value
  )
}
