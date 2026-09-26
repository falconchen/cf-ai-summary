# cf ai summary

## Introduction

This is a summary of the cloudflare ai project which aims to develop a cloudflare worker that can generate summaries of web pages by cloudflare AI.

modified from <https://mabbs.github.io/2024/07/03/ai-summary.html>

see a [demo online](https://d.cellmean.com/p/0a49bcf29f6c)

![demo image](https://photo.cellmean.com/i/2024/08/25/prqju8-0.png)

## Workers AI model

The production summary routes use `@cf/qwen/qwen3-30b-a3b-fp8`. The previous Qwen 1.5 model was retired by Cloudflare on 2025-10-01 and caused new summary requests to fail. The user message ends with `/no_think` so a short summary is returned without spending the output budget on reasoning. Empty model responses are not cached.

Before deployment, check that `main` in `wrangler.toml` points to the intended Worker entry point. The live Worker was running `src/index.js` when the Qwen 1.5 failure was diagnosed.
