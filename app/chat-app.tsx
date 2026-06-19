"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { VideoRenderer } from "@/components/video-renderer";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

const starter =
  "I'm building CalAI, a calorie-tracking app. Here's the site: calai.app";

export function ChatApp() {
  const [input, setInput] = useState(starter);
  const [activeJobId, setActiveJobId] = useState<Id<"jobs"> | null>(null);
  const [sessionId, setSessionId] = useState(() => {
    if (typeof window === "undefined") return "server";
    const existing = window.localStorage.getItem("result-session-id");
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem("result-session-id", created);
    return created;
  });

  const messages = useQuery(api.chat.listMessages, { sessionId });
  const latestMessageJobId = messages
    ?.filter((message) => message.jobId)
    .at(-1)?.jobId as Id<"jobs"> | undefined;
  const displayedJobId = activeJobId ?? latestMessageJobId ?? null;
  const activeJob = useQuery(
    api.chat.getJob,
    displayedJobId ? { jobId: displayedJobId } : "skip",
  );
  const sendMessage = useMutation(api.chat.sendMessage);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;
    setInput("");
    const result = await sendMessage({ sessionId, content });
    setActiveJobId(result.jobId);
  }

  function startNewSession() {
    const nextSessionId = crypto.randomUUID();
    window.localStorage.setItem("result-session-id", nextSessionId);
    setSessionId(nextSessionId);
    setActiveJobId(null);
    setInput(starter);
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
            className="h-8 rounded-none border-black bg-white px-3 text-xs uppercase tracking-[0.16em] text-black hover:bg-black hover:text-white"
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
                    "max-w-[86%] whitespace-pre-wrap border border-black px-4 py-3 text-sm leading-6",
                    message.role === "user"
                      ? "ml-auto bg-black text-white"
                      : "mr-auto bg-white text-black",
                  )}
                >
                  <p>{message.content}</p>
                  {message.status &&
                    !["complete", "failed"].includes(message.status) && (
                      <div className="mt-3 flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-black/55 mix-blend-difference">
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

          {activeJob?.status === "needs_client_render" &&
            activeJob.renderPlan && (
              <div className="border-t border-black py-3">
                <div className="flex items-center gap-3 text-xs uppercase tracking-[0.14em] text-black/55">
                  <VideoRenderer
                    jobId={activeJob._id}
                    plan={activeJob.renderPlan}
                  />
                  Rendering
                </div>
              </div>
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
  );
}
