"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUp,
  CircleDot,
  Film,
  Loader2,
  MessageSquare,
  Play,
  Sparkles,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
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
    <main className="min-h-svh bg-[#f7f6f0] text-[#090909]">
      <div className="mx-auto flex min-h-svh w-full max-w-7xl flex-col px-4 py-4 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-black/10 py-4">
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-full border border-black bg-black text-white">
              <Film className="size-4" />
            </div>
            <span className="font-serif text-xl font-bold tracking-tight">
              ClipScope
            </span>
          </div>
          <nav className="hidden items-center gap-7 text-sm font-medium text-black/60 md:flex">
            <a href="#workspace" className="transition-colors hover:text-black">
              Workspace
            </a>
            <a href="#render" className="transition-colors hover:text-black">
              Render
            </a>
            <span>Convex</span>
          </nav>
          <Button className="h-9 rounded-full bg-black px-5 text-xs font-semibold uppercase tracking-[0.16em] text-white hover:bg-black/80">
            Early access
          </Button>
        </header>

        <section className="grid flex-1 grid-cols-1 gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:py-10">
          <div className="flex min-h-0 flex-col gap-6">
            <div className="max-w-4xl">
              <Badge
                variant="outline"
                className="h-8 rounded-full border-black/15 bg-white px-3 text-black"
              >
                <CircleDot className="size-3 fill-[#ff5a1f] text-[#ff5a1f]" />
                NEW Assemble trend clips from chat
              </Badge>
              <h1 className="mt-5 max-w-4xl font-serif text-5xl font-bold leading-[0.96] tracking-[-0.02em] sm:text-6xl lg:text-7xl">
                The UGC clip assembler for products that need a better joke.
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-black/60">
                Product context in. KLIPY/Vlipsy clips out. Caption, collage,
                audio, and final Convex URL in the same thread.
              </p>
            </div>

            <section
              id="workspace"
              className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-md border border-black/12 bg-white shadow-[0_28px_80px_rgba(0,0,0,0.08)]"
            >
              <div className="flex items-center justify-between border-b border-black/10 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-full bg-black text-white">
                    <MessageSquare className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-black/45">
                      Chat run
                    </p>
                    <h2 className="font-serif text-xl font-bold">
                      Product to clip
                    </h2>
                  </div>
                </div>
                <Badge className="rounded-full bg-[#ff5a1f] text-white">
                  live
                </Badge>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto bg-[#fbfaf6] px-5 py-5">
                {!messages?.length ? (
                  <div className="grid h-full min-h-72 place-items-center">
                    <div className="max-w-xl text-center">
                      <Sparkles className="mx-auto mb-4 size-8 text-[#ff5a1f]" />
                      <h3 className="font-serif text-3xl font-bold tracking-tight">
                        Drop a product. Get the social punchline.
                      </h3>
                      <p className="mt-3 text-sm leading-6 text-black/55">
                        Try the CalAI prompt below, or paste another product
                        URL.
                      </p>
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <article
                      key={message._id}
                      className={cn(
                        "max-w-[84%] rounded-md px-4 py-3 text-sm leading-6 shadow-sm",
                        message.role === "user"
                          ? "ml-auto bg-black text-white"
                          : "mr-auto border border-black/10 bg-white text-black",
                      )}
                    >
                      <p>{message.content}</p>
                      {message.status &&
                        !["complete", "failed"].includes(message.status) && (
                          <div className="mt-3 flex items-center gap-2 text-xs font-medium text-[#ff5a1f]">
                            <Loader2 className="size-3.5 animate-spin" />
                            {message.status}
                          </div>
                        )}
                      {message.videoUrl && (
                        <video
                          className="mt-3 aspect-[9/16] w-48 rounded-md border border-black/10 bg-black"
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
                className="border-t border-black/10 bg-white p-4"
              >
                <div className="flex items-end gap-3 rounded-md border border-black/12 bg-[#fbfaf6] p-2">
                  <Textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    className="min-h-16 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm leading-6 shadow-none focus-visible:ring-0"
                    placeholder="Describe the product and paste the site..."
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="size-11 rounded-full bg-black text-white hover:bg-black/80"
                    disabled={!input.trim()}
                    aria-label="Send message"
                  >
                    <ArrowUp className="size-5" />
                  </Button>
                </div>
              </form>
            </section>
          </div>

          <aside id="render" className="space-y-4 lg:pt-28">
            <Card className="rounded-md border-black/12 bg-black py-0 text-white ring-0">
              <CardHeader className="border-b border-white/10 px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardDescription className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                      Render worker
                    </CardDescription>
                    <CardTitle className="mt-1 font-serif text-2xl font-bold text-white">
                      Canvas recorder
                    </CardTitle>
                  </div>
                  <div className="grid size-10 place-items-center rounded-full bg-white text-black">
                    <Play className="size-4 fill-black" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-5 py-5">
                {activeJob?.status === "needs_client_render" &&
                activeJob.renderPlan ? (
                  <div className="flex items-start gap-4">
                    <VideoRenderer
                      jobId={activeJob._id}
                      plan={activeJob.renderPlan}
                    />
                    <p className="text-sm leading-6 text-white/65">
                      Recording from cached Convex assets and attaching clip
                      audio when available.
                    </p>
                  </div>
                ) : activeJob ? (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-white">
                        {activeJob.status}
                      </p>
                      <Badge
                        variant="outline"
                        className="rounded-full border-white/15 text-white"
                      >
                        job
                      </Badge>
                    </div>
                    {activeJob.companyProfile && (
                      <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-white/[0.06] p-3 text-xs leading-5 text-white/65">
                        {JSON.stringify(activeJob.companyProfile, null, 2)}
                      </pre>
                    )}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-white/65">
                    Waiting for a product prompt.
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="flex overflow-hidden rounded-md border border-black/12 bg-white">
              <div className="min-w-0 flex-1 p-4">
                <p className="font-serif text-3xl font-bold">9:16</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-black/45">
                  Frame
                </p>
              </div>
              <Separator orientation="vertical" className="h-auto bg-black/10" />
              <div className="min-w-0 flex-1 p-4">
                <p className="font-serif text-3xl font-bold">5-10s</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-black/45">
                  Output
                </p>
              </div>
              <Separator orientation="vertical" className="h-auto bg-black/10" />
              <div className="min-w-0 flex-1 p-4">
                <p className="font-serif text-3xl font-bold">2</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-black/45">
                  Clip APIs
                </p>
              </div>
            </div>

            <Card className="rounded-md border-black/12 bg-white py-0 ring-0">
              <CardHeader className="px-5 py-5">
                <CardDescription className="text-xs font-bold uppercase tracking-[0.18em] text-black/45">
                  Sources
                </CardDescription>
                <CardTitle className="font-serif text-2xl font-bold">
                  KLIPY first. Vlipsy second.
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5 text-sm leading-6 text-black/60">
                <p>
                  No background remover. No generated video. The assembly uses
                  real clips, cached assets, and the browser recorder.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="rounded-full">
                    Firecrawl
                  </Badge>
                  <Badge variant="secondary" className="rounded-full">
                    Claude
                  </Badge>
                  <Badge variant="secondary" className="rounded-full">
                    Convex Storage
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  );
}
