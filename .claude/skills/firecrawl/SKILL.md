---
name: firecrawl
description: >
  Scrape, crawl, map, search and extract structured data from any website using the
  Firecrawl CLI (firecrawl-cli). Use this skill whenever the user asks to scrape a
  webpage, crawl a site, get a page as markdown, discover all URLs on a domain, search
  the web with full page content, or extract structured data (prices, competitors,
  landing-page copy) from URLs. Triggers include: "scrape", "crawl", "firecrawl",
  "תסרוק", "תמשוך את התוכן מהאתר", "תוציא לי את הדף כטקסט", "מה כתוב באתר",
  "תעשה מחקר מתחרים על האתר", or any request to pull live content from a URL.
---

# Firecrawl

Firecrawl converts websites into LLM-ready data (markdown / JSON / screenshots). It
handles JavaScript rendering, proxies and rate limits for you. Work through the
official CLI (`firecrawl`).

## Setup

One-time install and authentication:

```bash
npm install -g firecrawl-cli
firecrawl login --api-key fc-YOUR_API_KEY
```

Check availability before doing anything:

```bash
command -v firecrawl || npm install -g firecrawl-cli
```

Authentication resolves in this order — any one of these works:
1. Already logged in (`firecrawl login` was run before)
2. `FIRECRAWL_API_KEY` environment variable
3. Per-command flag: `--api-key fc-...`

If none is available, stop and ask the user for their API key (from
https://www.firecrawl.dev, starts with `fc-`). Never hardcode or commit the key.

## Which command to use

| Need | Command |
|---|---|
| One page as markdown/HTML | `firecrawl scrape <url>` |
| Web search (optionally with content) | `firecrawl search "<query>"` |
| List of all URLs on a domain | `firecrawl map <url>` |
| A whole site (many pages) | `firecrawl crawl <url> --wait` |
| Autonomous extraction by prompt | `firecrawl agent "<prompt>" --wait` |
| Remaining credits | `firecrawl credit-usage` |

## Scrape — single page

```bash
# Markdown (default)
firecrawl scrape https://example.com

# Only the main content, without navs/footers
firecrawl scrape https://example.com --only-main-content

# JS-heavy page — wait for render
firecrawl scrape https://spa-app.com --wait-for 3000

# Other formats: html, links, images, summary, screenshot
firecrawl scrape https://example.com --format markdown,links

# Structured extraction with a JSON schema
firecrawl scrape https://example.com/pricing --schema '{"type":"object","properties":{"plans":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"string"}}}}}}'

# Save to file
firecrawl scrape https://example.com -o page.md
```

Multiple URLs in one call are scraped concurrently and saved under `.firecrawl/`.

## Search — web search

```bash
firecrawl search "your query" --limit 5

# Full page content for each result, not just snippets
firecrawl search "your query" --scrape --scrape-formats markdown

# Fresh results: qdr:h / qdr:d / qdr:w / qdr:m / qdr:y
firecrawl search "AI news" --tbs qdr:w

# News / images sources, GitHub or PDF categories
firecrawl search "tech startups" --sources news
firecrawl search "web data library" --categories github
```

For programming questions (issues, PRs, docs): `firecrawl developer "<query>"`.
For academic papers: `firecrawl research search-papers "<query>"`.

## Map — discover URLs

```bash
firecrawl map https://example.com --limit 500

# Filter to relevant pages
firecrawl map https://example.com --search "blog"
```

Fast and cheap — prefer map + targeted scrapes over a blind crawl when the user only
needs specific pages.

## Crawl — whole site

```bash
firecrawl crawl https://example.com --limit 20 --wait --progress

# Scope it
firecrawl crawl https://example.com --include-paths /blog --exclude-paths /admin

# Check / cancel a job by id
firecrawl crawl <job-id>
firecrawl crawl <job-id> --cancel
```

Keep `--limit` small (10–30) unless the user asks for more — crawls cost credits per
page. Always pass `--limit`.

## Agent — autonomous extraction

```bash
firecrawl agent "Find the pricing plans for Notion" --wait --max-credits 100
```

Takes 2–5 minutes and costs more — use only when scrape/search can't answer, and
always cap with `--max-credits`. Supports `--schema` / `--schema-file` for structured
output and `--urls` to focus it.

## Fallback — direct API

If the CLI can't be installed, the same operations work as raw HTTP against
`https://api.firecrawl.dev/v2/{scrape,search,map,crawl,extract}` with
`Authorization: Bearer $FIRECRAWL_API_KEY` and a JSON body, e.g.:

```bash
curl -s https://api.firecrawl.dev/v2/scrape \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "formats": ["markdown"]}'
```

(`crawl` is async: the POST returns an `id`; poll `GET /v2/crawl/<id>` until
`status` is `completed`.)

## Working rules

- Summarize the content the user asked for — never dump raw JSON or full page
  markdown at them unless they asked for the raw output.
- Use `-o file` for large outputs and read the file, instead of flooding the
  terminal.
- On payment/credit errors (HTTP 402) or rate limits (429), report plainly and stop
  retrying; suggest `firecrawl credit-usage` to check the balance.
- Respect scope: scrape only what the user asked for; don't crawl a whole domain when
  one page answers the question.
- For Hebrew sites the markdown comes back in Hebrew as-is — no special handling
  needed.
