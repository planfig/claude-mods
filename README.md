# planfig-mods

*[Português abaixo](#português)*

A pack of [Claude Code](https://claude.com/claude-code) mods in one install, built on one principle:

> **Take as little human attention as possible, and give as much value as possible.**

The pack takes open tools other people wrote, adapts them, merges what they learned and credits them.

## What's inside

| Mod | Run | Does |
| --- | --- | --- |
| **painel** | `/painel` | One band above the prompt: turn, tok/s, turn and session cost, context, prompt-cache hit and countdown; under it the plan and one row per subagent. `/painel` opens the detail pane |
| **savvy-flow-plus** | `/planfig-mods:savvy-flow-plus <task>` | Orchestrator: plans, owns design, delegates to five tiered worker subagents, keeps a resumable ticket ledger, reviews their work adversarially |
| **codex** | `/planfig-mods:codex <request>` | Asks OpenAI's Codex CLI for a second opinion, a review or a delegated task |
| **Minimal-attention rules** | [`templates/CLAUDE.md`](templates/CLAUDE.md) | Paste into `~/.claude/CLAUDE.md` so every session works this way |

## Install

In Claude Code:

```
/plugin marketplace add planfig/claude-mods
/plugin install planfig-mods@planfig-mods
```

## painel

One band above the prompt, built from four MIT mods by other people and merged so nothing shows twice: one cache clock, one plan, one list of agents.

```
Turn 12  ⚡ 84 tok/s  $0.42 | $3.10  ctx 34%  ⧗ cache 92% 54:12              ▤ ×
● Ship the parser · Wire the CLI  3/7  ██████████░░░░░░░░░░░░░░
 ● Careful  Write the parser          2/5 · $0.31
 ✓ Light    Run the tests             3/3 · $0.04
```

- **Top row**: turn number, output speed of the last answer, cost of the last turn and of the session (Claude Code's own figures), context fill, the share of the last prompt read from the cache, and a countdown to the cache's expiry. The countdown turns amber with a third of the lifetime left and red with a sixth (20 and 10 minutes on the 1-hour cache), and the band gets a frame of that colour; a toast warns at red and when it lapses. Details drop out as the window narrows instead of wrapping.
- **Cache lifetime**: follows Claude Code's own rules (`FORCE_PROMPT_CACHING_5M`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, the `promptCacheTtl` setting, `ENABLE_PROMPT_CACHING_1H`, then 1 hour on a Claude subscription and 5 minutes on an API key or usage credits) and corrects itself from request timing.
- **Under it, only while there is something to show**: the plan (title, active step, done/total and a bar) and one row per subagent (tier, task, the steps it reported, estimated cost). Finished agents turn green and leave the band at the next prompt; the pane keeps them.
- **`/painel`** opens the pane: session figures, the cache per turn (requests, read, wrote, new, hit), every plan with its steps and planned tasks, and every agent with model, effort, steps, context, tokens, cost and time. `/painel band` hides or shows the band; on the band, `▤` opens the pane and `×` hides the band.
- **Sounds**: a soft sound when Claude asks you a question, when a plan step fails and when a plan finishes.

Tools it gives Claude:

- `mcp__planfig-mods__painel_plan`: create a plan with stages (or with an orchestrator's worker tasks and their tiers), then move it with short calls: `next`, `done`, `active`, `failed`, `state`. A short rule in the system prompt tells Claude to use it for multi-step work.
- `mcp__planfig-mods__painel_step`: a subagent reports its own steps. `savvy-*` workers are asked to in their brief.

While savvy-progress or plan-progress is still installed, the painel also shows what their tools report. Agent costs are estimates from token counts and list prices; the session cost is Claude Code's own.

Settings (`/config`, or `pluginConfigs["planfig-mods"].options` in `~/.claude/settings.json`): `language` (`auto`, `en`, `pt`), `ttl` (`auto`, `5m`, `1h`), `toast`, `sounds`, `rules`.

### Moving from the four originals

The painel replaces session-band, savvy-progress, plan-progress and prompt-cache-control. With this pack installed, turn the four off so their bands do not stack with it:

```
/plugin disable session-band@claude-kit
/plugin disable savvy-progress@claude-kit
/plugin disable plan-progress@zycck-mods
```

prompt-cache-control is a skills-folder mod: move `~/.claude/skills/prompt-cache-control` out of `skills` to turn it off. Then run `/reload-plugins`. To go back, enable them again.

Tests: `claude plugin test plugins/planfig-mods` (plan ops, cache lifetime, prices, and the band and the pane on the terminal and the desktop).

## savvy-flow-plus

A derivative of [savvy-flow](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-flow) by johnnyvizz, with ideas from DeepSeek's [dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype) research prototype:

- **Ticket ledger.** Tasks are written to `.claude/tickets.md` in the project (`todo` / `running` / `done` / `draft` / `blocked`), so a new session resumes instead of re-planning.
- **Follow-ups to the worker that has the context.** Return rounds go to the same worker with SendMessage instead of a fresh spawn that re-reads everything.
- **Stop by impact, not effort.** Local changes go all the way to a verified result. Decisions of direction stop with one concrete question.
- **Probe first, one question at a time.** Each question comes with a recommended answer. The full plan is shown once.
- **Honest reports.** "Done and verified" is kept apart from "draft" and "blocked". Workers fix routine problems themselves and never bypass a limit to avoid asking.
- **Progress on the painel.** The plan and each worker's steps show above the prompt (savvy-progress is used instead when the painel is absent).

| Worker | Model / effort | For |
| --- | --- | --- |
| `savvy-fable` | Fable / high | the hardest logic and bugs; design features on request |
| `savvy-heavy` | Opus / xhigh | unfamiliar code, unclear root cause |
| `savvy-careful` | Opus / high | delicate but well-understood changes |
| `savvy-medium` | Opus / medium | standard feature work |
| `savvy-light` | Opus / low | mechanical edits, builds, tests |

Without access to Fable, change `model:` in `plugins/planfig-mods/agents/savvy-fable.md` (for example, to `opus`). Plugin agents are namespaced, so this pack can sit next to the original savvy-flow.

## Credits and license

MIT. Built on other people's open work, with thanks:

- **savvy-flow-plus** is based on [savvy-flow](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-flow) © johnnyvizz (MIT). The minimal-attention principles are adapted from DeepSeek's [dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype) prototype (MIT).
- **painel** adapts and merges four MIT mods:
  - [session-band](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/session-band) © johnnyvizz: turn, speed, cost, context and the cache countdown with its amber/red frame;
  - [savvy-progress](https://github.com/johnnyvizz/claude-kit/tree/main/plugins/savvy-progress) © johnnyvizz: the subagent rows, the step tool and the price table;
  - [plan-progress](https://github.com/zycck/claude-mods) © Kirill Serditov (zycck): the plan ops, carrying finished steps over, and the three sounds in `sounds/`;
  - [prompt-cache-control](https://github.com/davila7/claude-code-templates) © claude-code-templates: the cache lifetime rules, reading the lifetime from request timing, and the per-turn cache table.

Their copyright notices are in [LICENSE](LICENSE). This project is not affiliated with any of them.

---

## Português

Um pacote de mods para o Claude Code, num só lugar, com um princípio: **gastar o mínimo de atenção humana e dar o máximo de valor.** O pacote pega ferramentas abertas de outras pessoas, adapta, junta o que elas aprenderam e dá o crédito.

**O que vem dentro:**
- **painel**: uma faixa acima do prompt com turno, velocidade (tok/s), custo do último turno e da sessão, contexto, quanto do prompt veio do cache e quanto falta para ele expirar (fica âmbar, depois vermelho, com aviso). Embaixo, só quando existe, o plano (passo atual, n/total e uma barra) e uma linha por subagente (nível, tarefa, passos, custo; os concluídos ficam verdes). `/painel` abre o painel completo: cache por turno, custos, todos os planos e todos os agentes. `/painel band` esconde ou mostra a faixa.
- **savvy-flow-plus**: um orquestrador que planeja, passa o trabalho para cinco ajudantes (subagentes) de níveis diferentes, guarda as tarefas em `.claude/tickets.md` para outra sessão continuar e confere tudo antes de entregar. O progresso aparece no painel.
- **codex**: pede uma segunda opinião ao Codex, da OpenAI.
- **Regras de atenção mínima**: cole [`templates/CLAUDE.pt-BR.md`](templates/CLAUDE.pt-BR.md) no seu `~/.claude/CLAUDE.md`.

**Instalar:** no Claude Code, rode `/plugin marketplace add planfig/claude-mods` e depois `/plugin install planfig-mods@planfig-mods`.

**Trocar os quatro mods antigos pelo painel:** depois de instalar o pacote, desligue os originais para as faixas não se empilharem: `/plugin disable session-band@claude-kit`, `/plugin disable savvy-progress@claude-kit` e `/plugin disable plan-progress@zycck-mods`; mova a pasta `~/.claude/skills/prompt-cache-control` para fora de `skills`. Depois rode `/reload-plugins`. Para voltar atrás, é só ligar de novo.

**Créditos e licença:** MIT. O painel junta e adapta quatro mods abertos (MIT): session-band e savvy-progress, de johnnyvizz; plan-progress, de Kirill Serditov (zycck); e prompt-cache-control, do claude-code-templates. O savvy-flow-plus vem do savvy-flow, de johnnyvizz, e as regras de atenção mínima, do dsh-superagent da DeepSeek. Os avisos de copyright estão no [LICENSE](LICENSE).
