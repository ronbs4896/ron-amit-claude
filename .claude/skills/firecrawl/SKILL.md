---
name: firecrawl
description: >
  Scrape, crawl, map, search and extract structured data from any website using the
  Firecrawl API (api.firecrawl.dev). Use this skill whenever the user asks to scrape a
  webpage, crawl a site, get a page as markdown, discover all URLs on a domain, search
  the web with full page content, or extract structured data (prices, competitors,
  landing-page copy) from URLs. Triggers include: "scrape", "crawl", "firecrawl",
  "תסרוק", "תמשוך את התוכן מהאתר", "תוציא לי את הדף כטקסט", "מה כתוב באתר",
  "תעשה מחקר מתחרים על האתר", or any request to pull live content from a URL.
---

# Firecrawl

Firecrawl converts websites into LLM-ready data (markdown / JSON / screenshots). It
handles JavaScript rendering, proxies and rate limits for you.

## Setup

All requests need an API key in the `FIRECRAWL_API_KEY` environment variable
(get one at https://www.firecrawl.dev — keys start with `fc-`).

Check before doing anything:

```bash
[ -n "$FIRECRAWL_API_KEY" ] && echo "key present" || echo "MISSING KEY"
```

If the key is missing, stop and tell the user to add `FIRECRAWL_API_KEY` to the
environment (locally: shell profile or `.env`; Claude Code on the web: the
environment's variables settings). Never hardcode or commit the key.

Base URL: `https://api.firecrawl.dev/v2` — every call is a POST with:

```
Authorization: Bearer $FIRECRAWL_API_KEY
Content-Type: application/json
```

## Which endpoint to use

| Need | Endpoint |
|---|---|
| One page as markdown/HTML | `/v2/scrape` |
| A whole site (many pages) | `/v2/crawl` (async, poll for status) |
| List of all URLs on a domain | `/v2/map` |
| Web search with page content | `/v2/search` |
| Structured data (JSON) from pages | `/v2/extract` |

## Scrape — single page

```bash
curl -s https://api.firecrawl.dev/v2/scrape \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "formats": ["markdown"]}'
```

The markdown is in `.data.markdown` of the response. Other formats: `"html"`,
`"links"`, `"screenshot"`, and `{"type": "json", "prompt": "..."}` for one-page
structured extraction.

## Crawl — whole site (async)

Start the crawl:

```bash
curl -s https://api.firecrawl.dev/v2/crawl \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "limit": 20}'
```

The response contains an `id`. Poll until `status` is `completed`:

```bash
curl -s https://api.firecrawl.dev/v2/crawl/<id> \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY"
```

Pages are in `.data[]` (each with `.markdown` and `.metadata`). Keep `limit` small
(10–30) unless the user asks for more — crawls cost credits per page. Poll every few
seconds, not in a tight loop.

## Map — discover URLs

```bash
curl -s https://api.firecrawl.dev/v2/map \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

Fast and cheap — prefer map + targeted scrapes over a blind crawl when the user only
needs specific pages.

## Search — web search with content

```bash
curl -s https://api.firecrawl.dev/v2/search \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "your query", "limit": 5}'
```

Add `"scrapeOptions": {"formats": ["markdown"]}` to get full page content for each
result instead of just snippets.

## Extract — structured data from URLs

```bash
curl -s https://api.firecrawl.dev/v2/extract \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com/pricing"],
    "prompt": "Extract all plan names and monthly prices",
    "schema": {
      "type": "object",
      "properties": {
        "plans": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {"type": "string"},
              "price": {"type": "string"}
            }
          }
        }
      }
    }
  }'
```

Extract is also async when given many URLs — the response may return an `id` to poll
at `/v2/extract/<id>`.

## Working rules

- Parse responses with `jq` (or Python) — never dump raw JSON at the user; summarize
  the content they asked for.
- On HTTP 402 (payment required / out of credits) or 429 (rate limit), report it
  plainly and stop retrying.
- Respect scope: scrape only what the user asked for; don't crawl a whole domain when
  one page answers the question.
- For Hebrew sites the markdown comes back in Hebrew as-is — no special handling
  needed.
