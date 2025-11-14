# EDA Resource Browser - Visual Architecture

## System Overview

Resource Browser is a compact SvelteKit application that reads CRD manifests stored in the repo (under `static/resources/<release>/...`) and exposes:

- A release-aware resource browser and search index
- Per-resource pages showing YAML and OpenAPI-style schema details
- Lightweight version comparison and diff views

The app is built with SvelteKit + Vite and can be deployed as a static site (for example, Cloudflare Pages).
<!-- prettier-ignore -->
# 🚀 EDA Resource Browser

A compact, fast web UI for exploring Nokia EDA Custom Resource Definitions (CRDs) and release manifests.

Clean, focused features:

- 🔎 Search and browse CRDs by release
- 📄 View YAML and OpenAPI-style schemas for each resource
- 🔁 Compare versions across releases and inspect diffs

Quick start

1. Install dependencies:

```bash
pnpm install
```

2. Run the development server (hot-reload):

```bash
pnpm run dev
```

3. Build for production:

```bash
pnpm run prepare
pnpm run build
```

Preview the production build locally:

```bash
pnpm run preview
```

Notes and tips

- Demo data: sample CRD manifests are placed under `static/resources/<release>/...` — the app reads these for the release browser.
- CI tip: if `pnpm install` in CI errors with a frozen-lockfile mismatch, regenerate the lockfile locally with:

```bash
pnpm install --no-frozen-lockfile
git add pnpm-lock.yaml
git commit -m "chore: update pnpm-lock.yaml"
```

Developer notes

- Built with SvelteKit + Vite and styled with TailwindCSS. Routes expose a home listing and per-resource detail pages.
- Keep changes small and UI-focused. If you add a new release, drop its manifest under `static/resources/<release>/manifest.json`.

Contributing

- Open issues and PRs welcome. Please include a short description and screenshots where helpful.



