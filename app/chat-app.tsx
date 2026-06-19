"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowUp, Film, Loader2, Sparkles } from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { VideoRenderer } from "@/components/video-renderer";
import { cn } from "@/lib/utils";

const starter =
  "I'm building CalAI, a calorie-tracking app. Here's the site: calai.app";

export function ChatApp() {
  const [input, setInput] = useState(starter);
  const [activeJobId, setActiveJobId] = useState<Id<"jobs"> | null>(null);
  const sessionId = useMemo(() => {
    if (typeof window === "undefined") return "server";
    const existing = window.localStorage.getItem("result-session-id");
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem("result-session-id", created);
    return created;
  }, []);

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

  return (
    <main className="min-h-svh bg-[#f4f0e7] text-[#15120d]">
      <div className="mx-auto grid min-h-svh max-w-6xl grid-cols-1 gap-6 px-4 py-4 md:grid-cols-[1fr_360px] md:px-6 md:py-6">
        <section className="flex min-h-[calc(100svh-2rem)] flex-col overflow-hidden rounded-lg border border-[#15120d]/15 bg-[#fffaf0] shadow-[0_18px_60px_rgba(54,38,19,0.14)]">
          <header className="flex items-center justify-between border-b border-[#15120d]/10 px-5 py-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#8c321d]">
                result.dev task
              </p>
              <h1 className="font-serif text-2xl font-semibold">
                UGC clip assembler
              </h1>
            </div>
            <div className="flex size-10 items-center justify-center rounded-full bg-[#15120d] text-[#fffaf0]">
              <Film className="size-5" />
            </div>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {!messages?.length ? (
              <div className="flex h-full min-h-80 items-center justify-center">
                <div className="max-w-md text-center">
                  <Sparkles className="mx-auto mb-4 size-8 text-[#c84d2a]" />
                  <h2 className="font-serif text-3xl">
                    Tell it the product. Get back a memeable clip.
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-[#5d554a]">
                    The backend reads the URL, picks a social caption, finds
                    KLIPY/Vlipsy clips, and stores the final render in Convex.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  key={message._id}
                  className={cn(
                    "max-w-[82%] rounded-lg px-4 py-3 text-sm leading-6",
                    message.role === "user"
                      ? "ml-auto bg-[#15120d] text-[#fffaf0]"
                      : "mr-auto border border-[#15120d]/10 bg-white text-[#15120d]",
                  )}
                >
                  <p>{message.content}</p>
                  {message.status &&
                    !["complete", "failed"].includes(message.status) && (
                      <div className="mt-3 flex items-center gap-2 text-xs text-[#8c321d]">
                        <Loader2 className="size-3.5 animate-spin" />
                        {message.status}
                      </div>
                    )}
                  {message.videoUrl && (
                    <video
                      className="mt-3 aspect-[9/16] w-48 rounded border border-black/10 bg-black"
                      src={message.videoUrl}
                      controls
                      playsInline
                    />
                  )}
                </article>
              ))
            )}
          </div>

          <form
            onSubmit={onSubmit}
            className="border-t border-[#15120d]/10 bg-[#fffaf0] p-4"
          >
            <div className="flex items-end gap-3 rounded-lg border border-[#15120d]/15 bg-white p-2 shadow-inner">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                className="min-h-14 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none"
                placeholder="Describe the product and paste the site..."
              />
              <Button
                type="submit"
                size="icon"
                className="size-11 rounded-md bg-[#c84d2a] text-white hover:bg-[#a83e22]"
                disabled={!input.trim()}
                aria-label="Send message"
              >
                <ArrowUp className="size-5" />
              </Button>
            </div>
          </form>
        </section>

        <aside className="rounded-lg border border-[#15120d]/15 bg-[#15120d] p-4 text-[#fffaf0] md:min-h-[calc(100svh-3rem)]">
          <div className="mb-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#f6a06e]">
              render worker
            </p>
            <h2 className="mt-1 font-serif text-2xl">Canvas recorder</h2>
          </div>
          <div className="rounded-md border border-white/10 bg-white/5 p-3 text-sm leading-6 text-white/75">
            {activeJob?.status === "needs_client_render" &&
            activeJob.renderPlan ? (
              <div className="flex items-start gap-4">
                <VideoRenderer
                  jobId={activeJob._id}
                  plan={activeJob.renderPlan}
                />
                <p>
                  Recording 8 seconds from cached Convex assets, then uploading
                  the WebM back to storage.
                </p>
              </div>
            ) : activeJob ? (
              <div>
                <p className="font-medium text-white">{activeJob.status}</p>
                {activeJob.companyProfile && (
                  <pre className="mt-3 max-h-72 overflow-auto rounded bg-black/25 p-3 text-xs text-white/70">
                    {JSON.stringify(activeJob.companyProfile, null, 2)}
                  </pre>
                )}
              </div>
            ) : (
              <p>
                Waiting for a job. The preview panel will show the extracted
                product profile and auto-render when assets are ready.
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
