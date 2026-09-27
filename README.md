# cf-ai-summary

A Cloudflare Worker that stores article text in D1 and generates Chinese summaries with Workers AI. The project is based on [this article](https://mabbs.github.io/2024/07/03/ai-summary.html).

- [Live demo](https://d.cellmean.com/p/0a49bcf29f6c)
- The production summary model is `@cf/qwen/qwen3-30b-a3b-fp8`.
- Summary prompts end with `/no_think` to keep responses concise. Empty model responses are not cached.

![Demo](https://photo.cellmean.com/i/2024/08/25/prqju8-0.png)

## Requirements

- Node.js and npm
- A Cloudflare account with Workers, D1, and Workers AI enabled
- Wrangler authenticated with the Cloudflare account for remote deployment

## Configuration

`wrangler.toml` configures the Worker entry point (`src/hono.js`) and the `AI` and `DB` bindings. The D1 database is named `blog_summary`; update its `database_id` in `wrangler.toml` if deploying to a different database.

`schema.sql` defines the two tables used by the Worker:

- `blog_summary`: article ID, source content, and cached summary
- `counter`: hashed article ID and click count

The schema file creates missing tables but does not change tables that already exist. The Worker also supports existing production tables without unique constraints on `blog_summary.id` or `counter.url`.

## Local development

Install dependencies and initialize the local D1 database:

```sh
npm install
npx wrangler d1 execute blog_summary --local --file=./schema.sql
```

Start the local Worker:

```sh
npm run dev
```

This starts Wrangler's local development server. Requests that generate summaries call Workers AI and use the account's Workers AI allowance. The test suite mocks D1 and AI, so it does not make model calls:

```sh
npm test -- --run
```

## Deploy

After configuring the D1 database ID and authenticating Wrangler, deploy the Worker with:

```sh
npm run deploy
```

## API

Summary, upload, and counter routes accept an `id` query parameter. Article routes use the ID as the D1 key. The Worker enables cross-origin requests.

| Method and route | Description | Response |
| --- | --- | --- |
| `GET /summary?id=<id>` | Generate and stream a summary. Article input is limited to the first 5,000 characters. | Server-sent events, or `No Record` if the article is missing. |
| `GET /get_summary?id=<id>&sign=<sha256>` | Check the content signature, then return a cached summary or generate and cache one. | Summary text, or `no` if the article is missing or the signature does not match. |
| `GET /is_uploaded?id=<id>&sign=<sha256>` | Check whether the uploaded article matches the supplied content signature. | `yes` or `no`. |
| `POST /upload_blog?id=<id>` | Upload the raw article text as the request body. Changing the content clears its cached summary. | `OK`; non-POST requests return `need post`. |
| `GET /count_click?id=<id>` | Read the click count. | A decimal count, or `0`. |
| `GET /count_click_add?id=<id>` | Increment the click count and return it. | A decimal count. |

For `sign`, send the lowercase hexadecimal SHA-256 digest of the exact UTF-8 article text uploaded to `/upload_blog`. The click counter stores an MD5 hash of the article ID rather than the original ID.

`GET /` without an `id` returns basic request and Cloudflare location details for diagnostics. The root route with an `id`, and unrecognized paths, redirect to Google.
