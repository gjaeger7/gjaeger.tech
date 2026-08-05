# Foambid Pro — Promotional Site

The public marketing site for **Foambid Pro**, the SPF contractor platform in development by
Gage Jaeger (Kearney, NE). A static, single-page site — no build step, no framework, no dependencies.

**Positioning:** *Estimating software that knows how foam actually behaves — built by a contractor who sprays it.*

---

## Structure

```
├─ index.html            The entire site (markup, styles, and a small script inline)
├─ favicon.png           Round Foambid mark, 64px
├─ apple-touch-icon.png  Round Foambid mark, 180px
├─ og.png                1200×630 social preview card
├─ vercel.json           Cache headers for fonts/images
├─ robots.txt
├─ fonts/                Clash Grotesk (display) + Inter (UI/body), woff2, self-hosted
└─ img/                  Product screenshots (webp) + logo
    ├─ dashboard, bidbuilder, pricebook, reconciliation, proposal,
    │  proposalbuilder, templateeditor          ← real product screens
    ├─ perfplans, perfcrew, perfaward,
    │  payrollexport                            ← DESIGN PREVIEWS (unbuilt feature)
    └─ ph_*                                     ← field app phone screens
```

## Deploy (GitHub → Vercel)

1. Push this folder to a GitHub repository (this folder = repo root).
2. In Vercel: **Add New → Project → Import** the repo.
3. Framework preset: **Other**. Build command: *none*. Output directory: *root* (defaults are fine).
4. Deploy. Every push to `main` redeploys automatically.

The social preview image is set to the live domain:
`https://www.gjaeger.tech/og.png`. If the site moves, update the `og:image` and `twitter:image`
values in `index.html` to the new absolute URL.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` directly from disk also works.)

## Updating screenshots

Screens are exported at 1680px wide and saved as WebP (quality ~86). To refresh one, overwrite the
file in `img/` keeping the same name — no other changes needed. Very tall screens (proposals,
template editor, performance plans) are cropped to their top ~1500px for the page.

## Editing guardrails — read before changing copy

This site is written against the project's claims rules (promo brief, 5 Aug 2026). Keep these
invariants when editing:

- **No pricing for Pro.** It hasn't been set. (Foambid's $39.99/mo for the live mobile app is fine.)
- **No accuracy or savings statistics.** No "95% accurate," no "saves X hours," nothing.
- **No AI takeoff / plan reading** — not even "coming soon."
- **Performance pay and payroll are DESIGN PREVIEWS.** Never caption them as shipping. Keep the
  amber "Design preview" badges attached to those four screenshots.
- **No integration claims** (no QuickBooks, CRM, accounting).
- **No manufacturer endorsement implied.** "260 products from 74 manufacturers, from published
  technical data sheets" is factual coverage; keep the disclaimer beneath the catalog section.
- **No launch date.**
- **Trade vocabulary is precise** — a set is two drums, never "a drum"; SPF, not generic
  "insulation"; board feet, lifts, max lift, gun time used correctly.
- Every screenshot shows a **demonstration shop** — keep the "Sample data" chips.
- Design bar: WCAG AA contrast at zero failures, Clash Grotesk for display, Inter for UI,
  tabular figures for all numbers, the Foambid palette only (see CSS custom properties in
  `index.html`).

## License / ownership

All content, design, and imagery © Gage Jaeger / Foambid. Not licensed for reuse.
