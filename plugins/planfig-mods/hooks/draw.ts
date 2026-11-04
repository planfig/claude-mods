/**
 * draw.ts — the painel's desktop drawings, each row one SVG (the desktop wraps sibling elements, so a row that must
 * stay on one line is one drawing). Pure: strings in, SVG out.
 *
 * The plan pill, the pixel crabs and their costumes, the agent rows and the header tiles are savvy-progress's
 * (johnnyvizz, MIT; the crab is Pixel Clawd from DockCrab); the round icons of the top row are session-band's
 * (johnnyvizz, MIT). The cache drawing follows prompt-cache-control (claude-code-templates, MIT).
 */
import type { AgentRun, CacheTurn, Plan, PlannedTask } from '../types'
import { fmtClock, fmtTokens, hitRatio, tierOf, usd } from './model.ts'

export const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','SF Pro Text',sans-serif"
export const ACCENT = '#8f8cf4'
export const DONE = '#5fbf8f'
export const WARN = '#e2a94e'
export const ALERT = '#e0846b'
export const TIER_COLOR: Record<string, string> = {
  fable: '#7F77DD',
  heavy: '#D85A30',
  careful: '#BA7517',
  medium: '#378ADD',
  light: '#1D9E75',
  other: '#888780',
}
export const colorOf = (tier: string) => TIER_COLOR[tier] ?? TIER_COLOR.other!

export const xml = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const WIDE =
  /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏！-｠￠-￦\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u
// Rough advance of system UI text, in em: enough to size a slot.
const charEm = (ch: string) => (WIDE.test(ch) ? 1 : /[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-ZÀ-ÝmwM@%]/.test(ch) ? 0.72 : 0.56)
export const textWidth = (s: string, size: number) => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)
export function fitText(s: string, size: number, maxW: number): string {
  if (textWidth(s, size) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (textWidth(out + ch + '…', size) > maxW) break
    out += ch
  }
  return out + '…'
}

// Deterministic noise so the dither does not shimmer between redraws.
const noise = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

// --- Pixel crabs --------------------------------------------------------------------

const CLAY = '#D97757'
const INK = '#1F1E1D'
const CRAB_BOX = 30
const CRAB_SCALE = 1.1

type Fill = (x: number, y: number, w: number, h: number, c: string, cls?: string) => void

const stamp = (f: Fill, x: number, y: number, rows: string[], map: Record<string, string>, cls?: string) =>
  rows.forEach((row, dy) => [...row].forEach((ch, dx) => map[ch] && f(x + dx, y + dy, 1, 1, map[ch] ?? '', cls)))

const crabBody = (f: Fill, armFront = 0, armCls?: string) => {
  f(7, 10, 16, 12, CLAY)
  f(3, 14, 4, 4, CLAY)
  f(23, 14 + armFront, 4, 4, CLAY, armCls)
  f(9, 12, 2, 2, INK)
  f(19, 12, 2, 2, INK)
  f(7, 22, 2, 4, CLAY, 'la')
  f(17, 22, 2, 4, CLAY, 'la')
  f(11, 22, 2, 4, CLAY, 'lb')
  f(21, 22, 2, 4, CLAY, 'lb')
}

// Pure CSS, run by the compositor. Every crab walks; each costume adds its prop's motion.
export const CRAB_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.run g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.c-fable.run{animation:float 1s ease-in-out infinite}
.c-fable.run .la,.c-fable.run .lb,.c-fable.run .bd{animation:none}
.c-fable.run .ant{animation:blink 1s steps(1) infinite}
.c-fable.run .star{animation:blink .5s steps(1) infinite -.25s}
@keyframes float{50%{transform:translateY(-2px)}}@keyframes blink{50%{opacity:.15}}
.c-heavy.run .it{animation:scan 1s steps(1) infinite}
.c-heavy.run .gl{animation:blink 1s steps(1) infinite -.5s}
@keyframes scan{25%{transform:translate(-1px,1px)}50%{transform:translate(-2px,2px)}75%{transform:translate(-1px,1px)}}
.c-careful.run .it{transform-origin:100% 100%;animation:twist .5s ease-in-out infinite}
@keyframes twist{50%{transform:rotate(-35deg)}}
.c-medium.run .pan{transform-origin:0 50%;animation:tilt 1s ease-in-out infinite}
.c-medium.run .egg{animation:flip 1s ease-in-out infinite}
@keyframes tilt{20%,40%{transform:rotate(-12deg)}}@keyframes flip{30%{transform:translateY(-5px) scaleY(-1)}60%{transform:translateY(0)}}
.c-light.run .la{animation-duration:.25s}.c-light.run .lb{animation-duration:.25s;animation-delay:-.125s}
.c-light.run .flag{transform-origin:0 50%;animation:wave .25s steps(1) infinite}
@keyframes wave{50%{transform:skewY(-12deg) scaleX(.85)}}
.c-explore.run .it{transform-origin:50% 100%;animation:fence .5s ease-in-out infinite}
@keyframes fence{50%{transform:rotate(25deg)}}
@media (prefers-reduced-motion: reduce){.run,.run g{animation:none!important}}
</style>`

const COSTUMES: Record<string, (f: Fill, t: string) => void> = {
  // Fable: astronaut in a glass dome; floats, the antenna and the star blink.
  fable: (f, t) => {
    crabBody(f)
    f(6, 7, 18, 1, '#E6E8EE'); f(5, 8, 1, 14, '#E6E8EE'); f(24, 8, 1, 14, '#E6E8EE'); f(6, 22, 18, 1, '#C9CCD2')
    f(6, 8, 18, 14, 'rgba(169,214,245,.32)'); f(8, 9, 2, 1, '#fff'); f(8, 10, 1, 2, '#fff')
    f(14, 4, 2, 3, '#C9CCD2'); f(14, 2, 2, 2, t, 'ant'); f(13, 18, 4, 2, t)
    f(27, 3, 1, 3, '#F5C542', 'star'); f(26, 4, 3, 1, '#F5C542', 'star')
  },
  // Heavy: detective in a deerstalker; the magnifier sweeps and glints.
  heavy: (f, t) => {
    crabBody(f, -4, 'it')
    stamp(f, 6, 3, ['......bbbbbb......', '....bbcbbcbbbb....', '...bbbbbbbbbbbb...', '..bcbbcbbcbbcbbb..', '.bbbbbbbbbbbbbbbb.', 'dddddddddddddddddd'], { b: '#7A4A26', c: '#A0703F', d: '#5A3519' })
    f(6, 9, 18, 1, t)
    stamp(f, 23, 1, ['.kkk.', 'k...k', 'k...k', 'k...k', '.kkk.'], { k: '#3A3A3C' }, 'it')
    f(24, 2, 3, 3, 'rgba(169,214,245,.7)', 'it'); f(25, 6, 1, 4, '#7A4A26', 'it'); f(24, 2, 1, 1, '#fff', 'gl')
  },
  // Careful: engineer in a hard hat; the wrench turns a bolt.
  careful: (f, t) => {
    crabBody(f)
    stamp(f, 6, 4, ['.....yyyyyyyy.....', '...yyyyyhhyyyyy...', '..yyyyyyhhyyyyyy..', '..yyyyyyhhyyyyyy..', '.yyyyyyyhhyyyyyyy.', 'dddddddddddddddddd'], { y: '#F5C542', h: '#FBE08A', d: '#C99A1E' })
    f(13, 5, 4, 2, t)
    stamp(f, 0, 10, ['.s.s', 'sss.', '.s..', '.s..'], { s: '#8E929A' }, 'it')
  },
  // Medium: chef in a toque; tosses the omelette.
  medium: (f, t) => {
    crabBody(f, -4, 'pan')
    stamp(f, 6, 0, ['........lll.......', '.......lllll......', '.wwwwgwwwwwwgwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwww', 'wwwwwgwwwwwggwwwww', '.wwwwgwwwwwggwwwww', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.', '.dddbbbbbbbbbbbbb.'], { w: '#F4F3EE', l: '#F7F6F2', g: '#D2D1C8', b: t, d: '#B45F43' })
    f(22, 8, 7, 2, '#4A4A48', 'pan'); f(26, 10, 1, 1, '#4A4A48', 'pan'); f(24, 7, 3, 1, '#F5B731', 'egg')
  },
  // Light: racer in a helmet; runs at double pace, the checkered flag flutters.
  light: (f, t) => {
    crabBody(f, -4)
    stamp(f, 6, 5, ['....rrrrrrrrrr....', '..rrrrrrwwrrrrrr..', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.rrrrrrrwwrrrrrrr.', '.kkkkkkkkkkkkkkkkr'], { r: t, w: '#F8F6F1', k: INK })
    f(25, 1, 1, 9, '#8E929A')
    stamp(f, 26, 1, ['wkwk', 'kwkw', 'wkwk'], { w: '#F8F6F1', k: INK }, 'flag')
  },
  // Explore: pirate scouting the code; the cutlass fences.
  explore: f => {
    crabBody(f)
    stamp(f, 5, 3, ['.kk..............kk.', '.kkk....kkkk....kkk.', '..kkkkkkkwwkkkkkkk..', '..kkkkkkkkkkkkkkkk..', '.gggggggggggggggggg.'], { k: '#55514C', w: '#F8F6F1', g: '#F5C542' })
    f(7, 11, 11, 1, INK); f(18, 11, 4, 3, INK)
    f(27, 6, 1, 9, '#C9CCD2', 'it'); f(26, 15, 3, 1, '#7A4A26', 'it')
  },
  other: f => crabBody(f),
}

export const costumeOf = (type: string) => (type.replace(/^[^:]*:/, '') === 'Explore' ? 'explore' : tierOf(type) || 'other')

export function crab(x: number, y: number, costume: string, dim = false, isWalking = false, scale = CRAB_SCALE): string {
  const groups = new Map<string, string[]>([['bd', []]])
  const f: Fill = (cx, cy, w, h, c, cls = 'bd') => {
    if (!groups.has(cls)) groups.set(cls, [])
    groups.get(cls)?.push(`<rect x="${cx}" y="${cy}" width="${w}" height="${h}" fill="${c}"/>`)
  }
  ;(COSTUMES[costume] ?? COSTUMES.other!)(f, colorOf(costume))
  const group = (cls: string) => `<g class="${cls}">${(groups.get(cls) ?? []).join('')}</g>`
  const props = [...groups.keys()].filter(k => k !== 'bd' && k !== 'la' && k !== 'lb')
  const body = `<g class="bd">${(groups.get('bd') ?? []).join('')}${props.map(group).join('')}</g>`
  return `<g transform="translate(${x},${y}) scale(${scale})" opacity="${dim ? 0.45 : 1}" shape-rendering="crispEdges"><g class="c-${costume}${isWalking ? ' run' : ''}">${body}${group('la')}${group('lb')}</g></g>`
}

// --- The band: the plan pill ----------------------------------------------------------

export const BAND_H = 22
const BAR_H = 16
const CELL = 3
const CRAB_W = 26

/**
 * The plan row: dot, title, a dithered bar with the count in a pill riding the fill, the percent and a crab
 * that walks while agents work. `running` adds a faint layer for tasks handed out and not yet accepted.
 */
export function planRowSvg(p: Plan, W: number, label: string, done: number, total: number, running: number, isWorking: boolean): string {
  const isDone = p.state === 'done'
  const color = isDone ? DONE : p.state === 'error' ? ALERT : p.state === 'needs_input' ? WARN : ACCENT
  const ratio = isDone ? 1 : total ? done / total : 0
  const title = fitText(p.title, 13, Math.max(60, W * 0.4))
  const BAR_X = Math.round(16 + textWidth(title, 13) + 12)
  const BAR_W = Math.max(60, W - BAR_X - 46 - CRAB_W)
  const y0 = (BAND_H - BAR_H) / 2
  const fillW = Math.round(BAR_W * ratio)
  const runW = total ? Math.round((BAR_W * Math.min(total, done + running)) / total) : 0
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  const dots: string[] = []
  for (let c = 0; c < cols; c++) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  const faint: string[] = []
  for (let c = cols; c < Math.floor(runW / CELL); c++) {
    for (let r = 0; r < rows; r++) {
      if (noise(c + 7, r + 3) < 0.2) faint.push(`<rect x="${c * CELL + 1}" y="${r * CELL + 1}" width="1.7" height="1.7"/>`)
    }
  }
  const ticks: string[] = []
  for (let i = 1; i < total && total <= 40; i++) {
    const x = Math.round((BAR_W * i) / total)
    if (x > fillW + 4) ticks.push(`<rect x="${x}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`)
  }
  const pillW = Math.round(18 + textWidth(label, 11) + 4)
  const pillX = Math.max(0, Math.min(BAR_W - pillW, fillW - pillW))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAND_H}" viewBox="0 0 ${W} ${BAND_H}">
<style>
.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}
.t0,.t1,.t2,.t3{animation:tw ${isDone ? 3.2 : 2.2}s ease-in-out infinite}
.t1{animation-duration:${isDone ? 3.8 : 2.8}s;animation-delay:-.7s}.t2{animation-duration:${isDone ? 4.4 : 1.9}s;animation-delay:-1.3s}.t3{animation-duration:${isDone ? 3.5 : 3.3}s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:${isDone ? 0.8 : 0.3}}}
@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}
</style>
<defs><clipPath id="c"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>
<circle cx="5" cy="${BAND_H / 2}" r="4" fill="${color}"/>
<text class="t" x="16" y="${BAND_H / 2 + 4.5}" font-family="${FONT}" font-size="13" font-weight="500">${xml(title)}</text>
<g transform="translate(${BAR_X},${y0})">
<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>
<g clip-path="url(#c)">
<g fill="${color}">${dots.join('')}</g>
<g fill="${color}" opacity="0.45">${faint.join('')}</g>
<g class="tk">${ticks.join('')}</g>
</g>
<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>
<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="#ffffff">${xml(label)}</text>
</g>
<text class="m" x="${W - CRAB_W - 6}" y="${BAND_H / 2 + 4.5}" text-anchor="end" font-family="${FONT}" font-size="12.5" font-variant-numeric="tabular-nums">${Math.round(ratio * 100)}%</text>
${CRAB_CSS}${crab(W - CRAB_W + 1, 0, 'other', false, isWorking, 0.8)}
</svg>`
}

// --- The band: session-band's round icons ----------------------------------------------

export const SPEED = '#8b8cf8'
export const MONEY = '#4caf6e'
export const CONTEXT = '#5fa8d3'
export const CACHE = '#4fb3a9'
const MUTED = '#8a8f8c'

const ring = (color: string, glyph: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="10" fill="none" stroke="${color}" stroke-width="2"/>${glyph}</svg>`

export const SPEED_ICON = ring(
  SPEED,
  `<path d="M6.5 15a6 6 0 0 1 11 0" fill="none" stroke="${SPEED}" stroke-width="1.8" stroke-linecap="round"/><path d="M12 15l3-4" stroke="${SPEED}" stroke-width="1.8" stroke-linecap="round"/>`,
)
export const MONEY_ICON = ring(
  MONEY,
  `<text x="12" y="16.5" text-anchor="middle" font-family="${FONT}" font-size="13" font-weight="600" fill="${MONEY}">$</text>`,
)
export const TURN_ICON = ring(
  MUTED,
  `<path d="M8 12a4 4 0 1 0 1.2-2.9" fill="none" stroke="${MUTED}" stroke-width="1.8" stroke-linecap="round"/><path d="M8.6 6.6v2.8h2.8" fill="none" stroke="${MUTED}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
)

// The ring itself fills with the context, around a page of lines.
export function contextIcon(percent: number): string {
  const c = 2 * Math.PI * 10
  const filled = (Math.min(100, percent) / 100) * c
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
<circle cx="12" cy="12" r="10" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2"/>
<circle cx="12" cy="12" r="10" fill="none" stroke="${CONTEXT}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 12 12)"/>
<g stroke="${CONTEXT}" stroke-width="1.6" stroke-linecap="round"><path d="M8.5 9h7M8.5 12h7M8.5 15h4.5"/></g></svg>`
}

// An hourglass: the prompt cache running out; the ring drains with the time left.
export function cacheIcon(color: string, life: number): string {
  const c = 2 * Math.PI * 10
  const filled = Math.min(1, Math.max(0, life)) * c
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
<circle cx="12" cy="12" r="10" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2"/>
<circle cx="12" cy="12" r="10" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 12 12)"/>
<g fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M8.5 6.5h7M8.5 17.5h7"/><path d="M9.5 6.5c0 3 5 3.5 5 5.5s-5 2.5-5 5.5M14.5 6.5c0 3-5 3.5-5 5.5s5 2.5 5 5.5"/></g></svg>`
}

export function contextBar(percent: number): string {
  const color = percent >= 85 ? ALERT : percent >= 65 ? WARN : MONEY
  const w = Math.round((Math.min(100, percent) / 100) * 80)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 6" width="80" height="6"><rect width="80" height="6" rx="3" fill="${MUTED}" fill-opacity="0.3"/><rect width="${w}" height="6" rx="3" fill="${color}"/></svg>`
}

// --- The pane ---------------------------------------------------------------------------

const PANE_CSS = `<style>
.t{fill:#1f1f1f}.s{fill:#6b6b68}.m{fill:#9a9a96}.k{fill:#ecebe8}.ln{stroke:#e4e4e1}.tile{fill:#f4f3f0}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.s{fill:#a8a8a4}.m{fill:#7d7d79}.k{fill:#2c2c2b}.ln{stroke:#333331}.tile{fill:#262625}}
.live{animation:p 1.6s ease-in-out infinite}@keyframes p{50%{opacity:.3}}
@media (prefers-reduced-motion: reduce){.live{animation:none}}
</style>`

const svg = (W: number, H: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${PANE_CSS}${CRAB_CSS}${body}</svg>`

const statusMark = (x: number, y: number, status: string, color: string) => {
  if (status === 'running') return `<circle class="live" cx="${x}" cy="${y}" r="3.5" fill="${color}"/>`
  if (status === 'done') return `<path d="M${x - 5} ${y}l3.5 3.5 6.5-7" fill="none" stroke="#3B9C5F" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  if (status === 'failed') return `<path d="M${x - 4} ${y - 4}l8 8M${x + 4} ${y - 4}l-8 8" stroke="#D0453F" stroke-width="1.8" stroke-linecap="round"/>`
  return `<circle cx="${x}" cy="${y}" r="5" fill="none" stroke="#9a9a96" stroke-width="1.4"/><path d="M${x} ${y - 2.5}v2.8l1.8 1.2" fill="none" stroke="#9a9a96" stroke-width="1.4" stroke-linecap="round"/>`
}

export type Tile = { label: string; value: string; color?: string }

/** A title (optional) over a row of tiles, each a label above a value. */
export const tilesHeight = (title: string) => (title ? 72 : 44)
export function tilesSvg(W: number, title: string, tiles: readonly Tile[]): string {
  const gap = 6
  const tw = (W - gap * (tiles.length - 1)) / tiles.length
  const top = title ? 28 : 0
  const tile = (i: number, t: Tile) =>
    `<rect class="tile" x="${i * (tw + gap)}" y="${top}" width="${tw}" height="40" rx="8"/>
<text class="s" x="${i * (tw + gap) + 9}" y="${top + 16}" font-family="${FONT}" font-size="11">${xml(fitText(t.label, 11, tw - 14))}</text>
<text class="t" x="${i * (tw + gap) + 9}" y="${top + 33}" font-family="${FONT}" font-size="15" font-weight="600" font-variant-numeric="tabular-nums"${t.color ? ` style="fill:${t.color}"` : ''}>${xml(fitText(t.value, 15, tw - 14))}</text>`
  return svg(
    W,
    tilesHeight(title),
    `${title ? `<text class="t" x="0" y="15" font-family="${FONT}" font-size="14" font-weight="600">${xml(fitText(title, 14, W))}</text>` : ''}${tiles.map((t, i) => tile(i, t)).join('')}`,
  )
}

export const ctxOf = (a: AgentRun) => (a.contextMax ? Math.min(100, Math.round((a.contextTokens / a.contextMax) * 100)) : 0)
export const elapsedOf = (a: AgentRun, at: number) => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt
const agentProgress = (a: AgentRun): number | null => (a.status === 'done' ? 1 : a.stepTotal ? Math.min(1, (a.stepDone ?? 0) / a.stepTotal) : null)

export type Words = { tier: (t: string) => string; model: string; ctx: string; failed: string; after: string }

/** One agent: crab, task, tier and model, its steps, context, tokens, cost and time, a bar in the tier's colour. */
export const AGENT_H = 66
export function agentSvg(W: number, a: AgentRun, at: number, words: Words): string {
  const tier = tierOf(a.type) || 'other'
  const color = colorOf(tier)
  const ctx = ctxOf(a)
  const textW = W - 42 - 22
  const meta = [words.model]
  if (a.status === 'failed') meta.push(words.failed)
  const progress = agentProgress(a)
  const stats = `${words.ctx} ${ctx}% · ${fmtTokens(a.tokens)}  ≈${usd(a.costUsd)}  ${fmtClock(elapsedOf(a, at) / 1000)}`
  const steps = a.stepTotal ? `${a.stepDone ?? 0}/${a.stepTotal}${a.stepNote ? ' · ' + a.stepNote : ''}` : ''
  const stepsW = Math.max(0, textW - textWidth(stats, 11) - 12)
  // Without reported steps the bar falls back to the context, drawn grey.
  const fillW = Math.round(textW * (progress ?? ctx / 100))
  return svg(
    W,
    AGENT_H,
    `${crab(0, 14, costumeOf(a.type), false, a.status === 'running')}
<text class="t" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(a.description || a.type, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(words.tier(a.type))}</tspan><tspan class="s">  ${xml(meta.join('  ·  '))}</tspan></text>
${steps && stepsW > 30 ? `<text class="t" x="42" y="49" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(fitText(steps, 11, stepsW))}</text>` : ''}
<text class="s" x="${42 + textW}" y="49" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${xml(stats)}</text>
<rect class="k" x="42" y="55" width="${textW}" height="4" rx="2"/><rect${progress === null ? ' class="m"' : ''} x="42" y="55" width="${fillW}" height="4" rx="2"${progress === null ? '' : ` fill="${color}"`}/>
${statusMark(W - 8, 16, a.status, color)}
<line class="ln" x1="0" y1="${AGENT_H - 0.5}" x2="${W}" y2="${AGENT_H - 0.5}"/>`,
  )
}

/** A planned task no agent has started yet: a dim crab in the tier's costume and what it waits for. */
export const PLANNED_H = 46
export function plannedSvg(W: number, n: number, p: PlannedTask, words: Words): string {
  const tier = p.tier || 'other'
  const color = colorOf(tier)
  const textW = W - 42 - 22
  const meta = [words.model]
  if (p.after.length) meta.push(`${words.after} ${p.after.join(', ')}`)
  return svg(
    W,
    PLANNED_H,
    `${crab(0, 6, tier, true)}
<text class="s" x="42" y="18" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(`${n}. ${p.title}`, 13, textW))}</text>
<text x="42" y="34" font-family="${FONT}" font-size="11"><tspan fill="${color}">${xml(words.tier(`savvy-${tier}`))}</tspan><tspan class="m">  ${xml(meta.filter(Boolean).join('  ·  '))}</tspan></text>
${statusMark(W - 8, 16, 'planned', color)}
<line class="ln" x1="0" y1="${PLANNED_H - 0.5}" x2="${W}" y2="${PLANNED_H - 0.5}"/>`,
  )
}

/** One plan in the pane: its title, count and bar, then one line per step. */
export function planSvg(W: number, p: Plan, done: number, total: number, steps: readonly { title: string; status: string }[]): { source: string; height: number } {
  const color = p.state === 'done' ? DONE : p.state === 'error' ? ALERT : p.state === 'needs_input' ? WARN : ACCENT
  const H = 40 + steps.length * 18 + 8
  const barW = W - 0
  const fillW = Math.round(barW * (total ? done / total : 0))
  const glyph = (s: string) => (s === 'done' || s === 'skipped' ? '✓' : s === 'active' ? '▸' : s === 'error' ? '✗' : '·')
  const stepColor = (s: string) => (s === 'done' || s === 'skipped' ? DONE : s === 'active' ? ACCENT : s === 'error' ? ALERT : '')
  const lines = steps
    .map((st, i) => {
      const c = stepColor(st.status)
      return `<text x="4" y="${52 + i * 18}" font-family="${FONT}" font-size="12"${c ? ` fill="${c}"` : ' class="m"'}>${glyph(st.status)}  ${xml(fitText(st.title, 12, W - 24))}</text>`
    })
    .join('')
  return {
    height: H,
    source: svg(
      W,
      H,
      `<circle cx="5" cy="11" r="4" fill="${color}"/>
<text class="t" x="16" y="15" font-family="${FONT}" font-size="13" font-weight="600">${xml(fitText(p.title + (p.note ? ` · ${p.note}` : ''), 13, W - 70))}</text>
<text class="s" x="${W}" y="15" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">${done}/${total}</text>
<rect class="k" x="0" y="24" width="${barW}" height="5" rx="2.5"/><rect x="0" y="24" width="${fillW}" height="5" rx="2.5" fill="${color}"/>
${lines}
<line class="ln" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"/>`,
    ),
  }
}

export type CacheWords = { turn: string; reqs: string; read: string; wrote: string; fresh: string; hit: string; none: string }

/** The cache per turn: a stacked bar of read / wrote / new per row, and the hit share. */
export function cacheTableSvg(W: number, turns: readonly CacheTurn[], words: CacheWords): { source: string; height: number } {
  const rowH = 22
  const H = 26 + Math.max(1, turns.length) * rowH + 30
  const barX = 44
  const barW = Math.max(60, W - barX - 150)
  const head = `<text class="s" x="0" y="14" font-family="${FONT}" font-size="11">${xml(words.turn)}</text>
<text class="s" x="${barX}" y="14" font-family="${FONT}" font-size="11">${xml(words.read)} · ${xml(words.wrote)} · ${xml(words.fresh)}</text>
<text class="s" x="${W - 52}" y="14" text-anchor="end" font-family="${FONT}" font-size="11">tok</text>
<text class="s" x="${W}" y="14" text-anchor="end" font-family="${FONT}" font-size="11">${xml(words.hit)}</text>`
  const body = turns.length
    ? turns
        .map((r, i) => {
          const y = 26 + i * rowH
          const total = r.read + r.write + r.fresh
          const seg = (v: number) => (total ? (barW * v) / total : 0)
          const pct = Math.round(hitRatio(r) * 100)
          const hc = pct >= 80 ? DONE : pct >= 40 ? WARN : ALERT
          return `<text class="t" x="0" y="${y + 13}" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums">${r.turn}</text>
<rect class="k" x="${barX}" y="${y + 4}" width="${barW}" height="10" rx="3"/>
<rect x="${barX}" y="${y + 4}" width="${seg(r.read).toFixed(1)}" height="10" fill="${DONE}"/>
<rect x="${(barX + seg(r.read)).toFixed(1)}" y="${y + 4}" width="${seg(r.write).toFixed(1)}" height="10" fill="${WARN}"/>
<rect x="${(barX + seg(r.read) + seg(r.write)).toFixed(1)}" y="${y + 4}" width="${seg(r.fresh).toFixed(1)}" height="10" fill="${CONTEXT}"/>
<text class="s" x="${W - 52}" y="${y + 13}" text-anchor="end" font-family="${FONT}" font-size="11" font-variant-numeric="tabular-nums">${fmtTokens(total)} · ${r.requests} ${xml(words.reqs)}</text>
<text x="${W}" y="${y + 13}" text-anchor="end" font-family="${FONT}" font-size="12" font-weight="600" fill="${hc}" font-variant-numeric="tabular-nums">${pct}%</text>`
        })
        .join('')
    : `<text class="m" x="0" y="40" font-family="${FONT}" font-size="12">${xml(words.none)}</text>`
  const ly = H - 10
  const legend = `<rect x="0" y="${ly - 8}" width="8" height="8" rx="2" fill="${DONE}"/><text class="s" x="12" y="${ly}" font-family="${FONT}" font-size="11">${xml(words.read)}</text>
<rect x="80" y="${ly - 8}" width="8" height="8" rx="2" fill="${WARN}"/><text class="s" x="92" y="${ly}" font-family="${FONT}" font-size="11">${xml(words.wrote)}</text>
<rect x="170" y="${ly - 8}" width="8" height="8" rx="2" fill="${CONTEXT}"/><text class="s" x="182" y="${ly}" font-family="${FONT}" font-size="11">${xml(words.fresh)}</text>`
  return { height: H, source: svg(W, H, head + body + legend) }
}
