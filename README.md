# planfig-mods

*[Português abaixo](#português)*

A pack of [Claude Code](https://claude.com/claude-code) mods in one install, built on one principle:

> **Take as little human attention as possible, and give as much value as possible.**

## What's inside

| Mod | Run | Does |
| --- | --- | --- |
| **savvy-flow-plus** | `/planfig-mods:savvy-flow-plus <task>` | Orchestrator: plans, owns design, delegates to five tiered worker subagents, keeps a resumable ticket ledger, reviews their work adversarially |
| **codex** | `/planfig-mods:codex <request>` | Asks OpenAI's Codex CLI for a second opinion, a review or a delegated task |
| **caca-preco** | `/planfig-mods:caca-preco <item>` | Finds the best purchase price in Portugal, with real listing links and scam flags |
| **publicar-site** | `/planfig-mods:publicar-site` | Publishes a page or a built site and hands back a public link |
| **Minimal-attention rules** | [`templates/CLAUDE.md`](templates/CLAUDE.md) | Paste into `~/.claude/CLAUDE.md` so every session works this way |

## Install

In Claude Code:

```
/plugin marketplace add planfig/claude-mods
/plugin install planfig-mods@planfig-mods
```

## savvy-flow-plus

A derivative of [savvy-flow](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-flow) by johnnyvizz, with ideas from DeepSeek's [dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype) research prototype:

- **Ticket ledger.** Tasks are written to `.claude/tickets.md` in the project (`todo` / `running` / `done` / `draft` / `blocked`), so a new session resumes instead of re-planning.
- **Follow-ups to the worker that has the context.** Return rounds go to the same worker with SendMessage instead of a fresh spawn that re-reads everything.
- **Stop by impact, not effort.** Local changes go all the way to a verified result. Decisions of direction stop with one concrete question.
- **Probe first, one question at a time.** Each question comes with a recommended answer. The full plan is shown once.
- **Honest reports.** "Done and verified" is kept apart from "draft" and "blocked". Workers fix routine problems themselves and never bypass a limit to avoid asking.

| Worker | Model / effort | For |
| --- | --- | --- |
| `savvy-fable` | Fable / high | the hardest logic and bugs; design features on request |
| `savvy-heavy` | Opus / xhigh | unfamiliar code, unclear root cause |
| `savvy-careful` | Opus / high | delicate but well-understood changes |
| `savvy-medium` | Opus / medium | standard feature work |
| `savvy-light` | Opus / low | mechanical edits, builds, tests |

Without access to Fable, change `model:` in `plugins/planfig-mods/agents/savvy-fable.md` (for example, to `opus`). Plugin agents are namespaced, so this pack can sit next to the original savvy-flow.

## Works well with (not included, by other authors)

- [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress): live progress bar and agents panel for the orchestrator.
- [prompt-cache-control](https://github.com/davila7/claude-code-templates): prompt-cache meter and countdown above the prompt.

## Credits and license

MIT. savvy-flow-plus is based on savvy-flow © johnnyvizz (MIT). The minimal-attention principles are adapted from DeepSeek's dsh-superagent prototype (MIT). This project is not affiliated with either.

---

## Português

Um pacote de mods para o Claude Code, num só lugar, com um princípio: **gastar o mínimo de atenção humana e dar o máximo de valor.**

**O que vem dentro:**
- **savvy-flow-plus**: um orquestrador que planeja, passa o trabalho para cinco ajudantes (subagentes) de níveis diferentes, guarda as tarefas em `.claude/tickets.md` para outra sessão continuar e confere tudo antes de entregar.
- **codex**: pede uma segunda opinião ao Codex, da OpenAI.
- **caca-preco**: procura o melhor preço em Portugal, com o link de cada anúncio.
- **publicar-site**: publica uma página e devolve um link público.
- **Regras de atenção mínima**: cole [`templates/CLAUDE.pt-BR.md`](templates/CLAUDE.pt-BR.md) no seu `~/.claude/CLAUDE.md`.

**Instalar:** no Claude Code, rode `/plugin marketplace add planfig/claude-mods` e depois `/plugin install planfig-mods@planfig-mods`.
