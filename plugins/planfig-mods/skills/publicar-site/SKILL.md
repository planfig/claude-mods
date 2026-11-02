---
name: publicar-site
description: Publish a site and hand back a public link everyone can open. Use when the user says "publica", "faz um link", "quero que todos vejam", "publish it", "make a link".
---

# Publicar site

The user wants a **public link**, not a local file, and usually without paying for a domain.

## Which path
- **One-page site** (landing page, menu, flyer): publish as a Claude Artifact and return the claude.ai link.
- **Built project** (a folder such as `out/` or `dist/`): if the project already has a deploy script or a linked Netlify / Cloudflare / Vercel site, use that. Otherwise: `npx netlify deploy --prod --dir=<folder>`, or `npx wrangler pages deploy <folder> --project-name <name>` on Cloudflare Pages. Signing in to those CLIs is the user's step: give them the command.
- Never publish to a different site or project name than the one already in use; a new URL breaks links people already shared.
- Manual fallback: drag the folder onto app.netlify.com → Deploys.

## After publishing
Open the link, check that it loads and that the change is there. Hand back only the link and one line on what changed.
