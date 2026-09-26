# cf ai summary

## Introduction

This is a summary of the cloudflare ai project which aims to develop a cloudflare worker that can generate summaries of web pages by cloudflare AI.

modified from <https://mabbs.github.io/2024/07/03/ai-summary.html>

see a [demo online](https://d.cellmean.com/p/0a49bcf29f6c)

![demo image](https://photo.cellmean.com/i/2024/08/25/prqju8-0.png)

## Workers AI model

The production summary routes use `@cf/qwen/qwen3-30b-a3b-fp8`. The previous Qwen 1.5 model was retired by Cloudflare on 2025-10-01 and caused new summary requests to fail. The user message ends with `/no_think` so a short summary is returned without spending the output budget on reasoning. Empty model responses are not cached.

Before deployment, check that `main` in `wrangler.toml` points to the intended Worker entry point. The live Worker was running `src/index.js` when the Qwen 1.5 failure was diagnosed.

## Hono worker

The configured entry point is `src/hono.js`. It provides `/summary`, `/get_summary`, `/is_uploaded`, `/upload_blog`, `/count_click`, and `/count_click_add`, while retaining the root diagnostic response and redirect for unknown paths. Upload and counter writes work with both the indexed schema in `schema.sql` and the existing production tables, which do not have unique constraints. The D1 tables are defined in `schema.sql`; apply it to a local database before local development with `wrangler d1 execute blog_summary --local --file schema.sql`.

Run `npm test -- --run` for route tests. Run `wrangler dev` to exercise the Worker against local D1 and Cloudflare Workers AI; AI calls made during local development consume the account's Workers AI allowance. The tests mock D1 and AI, so they do not make paid model calls.
