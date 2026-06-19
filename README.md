# Next.js template

This is a Next.js template with shadcn/ui.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button";
```
# result.task

## UGC clip assembler

This app is a small Next.js + Convex implementation of the founding engineer
task. The chat message creates a Convex job that:

1. extracts the product URL from the prompt,
2. scrapes the site with Firecrawl,
3. asks Claude for a product profile plus meme concepts,
4. searches KLIPY first and Vlipsy second for foreground/background clips,
5. stores chosen remote assets in Convex storage,
6. records the final 9:16 WebM in the browser,
7. uploads the final video to Convex storage and posts the URL back to chat.

### Required Convex environment variables

Set these on the Convex deployment, not in committed source:

```bash
npx convex env set FIRECRAWL_API_KEY "<firecrawl-key>"
npx convex env set ANTHROPIC_API_KEY "<anthropic-key>"
```

Optional KLIPY configuration:

```bash
npx convex env set KLIPY_API_KEY "<klipy-key>"
npx convex env set KLIPY_BASE_URL "https://api.klipy.com/api/v1"
npx convex env set KLIPY_CLIPS_ENDPOINT "<provider-specific-search-endpoint>"
```

Vlipsy is used as a best-effort public search fallback. No background remover or
AI video generation is used; all visual media comes from KLIPY/Vlipsy clip
sources.
