---
name: codex
description: Ask OpenAI's Codex CLI for help — a second opinion, a code review or a delegated task. Use when the user says "/codex", "ask Codex", "have Codex do it" or "second opinion".
---

# Codex

Requires the Codex CLI (`npm i -g @openai/codex`) signed in with `codex login`.
If it is missing or signed out, tell the user the exact command to run in their own terminal; never sign in for them.
Call it from the command line.

## How to call

- Question / second opinion (read-only):
  `codex exec --skip-git-repo-check -s read-only "<request>"`
- Task that edits files in a folder:
  `codex exec --skip-git-repo-check -s workspace-write -C "<folder>" "<request>"`
- Code review in a git repository: `codex review` inside the folder.

Write the request to Codex with all the context it needs: it cannot see this conversation.
Run it in the background if it may take longer than 2 minutes.
`ERROR rmcp ... Auth required` lines at the start are harmless (Codex's internal MCP).
The final answer is the last block after `codex` / before `tokens used`.

Show the user, in their language, what Codex answered, and your own opinion where you disagree.
