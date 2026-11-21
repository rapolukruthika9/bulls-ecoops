# BULLS ECOOPS — System Architecture

_Images for slides: [`architecture-overview.png`](architecture-overview.png) and [`architecture-ai-guardrail.png`](architecture-ai-guardrail.png)._

Evidence-first pipeline: **code measures, Gemini explains, a checker verifies, a human decides.**

## 1. System overview

```mermaid
flowchart TB
  subgraph DATA["1. Public data"]
    direction LR
    D1["USF ArcGIS<br/>boundary, buildings, parking"]
    D2["USF Water Institute 2021<br/>canopy, planting, heat + legend"]
    D3["Cached snapshots<br/>optional fallback"]
  end

  subgraph BROWSER["2. Browser: React + MapLibre + Turf.js"]
    direction LR
    B1["Validate<br/>GeoJSON"] --> B2["EcoScan<br/>solar, water, planting"] --> B3["EcoPrioritize<br/>weights, ranking"] --> B4["Priority map<br/>heat-map, pop-up"]
    B3 --> B5["EcoPlan<br/>up to 6 sites"] --> B6["Evidence pack<br/>metrics + sources"]
  end

  subgraph SERVER["3. Server: Express - API keys stay here"]
    direction LR
    S1["API: proposal, ideas, PVWatts<br/>Zod checks, rate limits"] --> S2["Google Gemini<br/>explains supplied metrics only"] --> S3["Verifier<br/>IDs, sources, URLs, numbers"]
    S3 -->|verified| S6["PDF builder<br/>Letter or A4"]
    S3 -->|fails| S4["Fallback report"]
    S4 --> S6
  end

  OUT(["Report + PDF<br/>reviewed by humans"])

  DATA -->|"via allow-listed GIS proxy"| BROWSER
  BROWSER -->|"evidence pack, PVWatts request"| SERVER
  SERVER -->|"verified text or fallback, as PDF"| OUT
```

> **Human decision at every step:** you choose the mission, the weights and the assumptions, and professionals review the report before anything is built.

## 2. The AI guardrail (why Gemini cannot invent numbers)

```mermaid
sequenceDiagram
  autonumber
  actor U as Human
  participant W as Browser
  participant API as Express API
  participant G as Gemini
  participant V as Verifier

  U->>W: choose mission, weights, assumptions
  W->>W: Turf.js measures, scenario code calculates
  W->>API: evidence pack (metrics, source IDs, assumptions)
  API->>API: Zod validation, sanitize text, rate limit
  API->>G: only the supplied metrics and approved sources
  G-->>API: structured JSON proposal
  API->>V: check IDs, sources, URLs, every number
  alt verified
    V-->>W: proposal marked machine-verified
  else invalid
    V->>G: one retry with the exact errors
    G-->>V: corrected JSON
    V-->>W: verified proposal or deterministic fallback
  end
  W-->>U: report with headline, sources, assumptions
  U->>U: professionals review before anything is built
```

## 3. What lives where

| Layer | Folder | Responsibility |
|---|---|---|
| Shared logic | `shared/` | Source registry, scenario math, scoring, evidence pack, portfolio, proposal and brainstorm schemas, verifier, fallbacks |
| GIS engine | `src/lib/gis.js` | Buffers, canopy overlap, solar and water screening, open-space finder |
| Data loading | `src/lib/data.js` | ArcGIS queries, pagination, snapshot fallback, heat legend |
| UI | `src/components/` | Map, scan panel, planner, ideas, report |
| API server | `server/` | Express app, Gemini and PVWatts services, GIS proxy, PDF renderer |
| Tests | `tests/` | Math, GIS, guardrails, API, PDF |
| Snapshots | `scripts/snapshot.mjs` | Cache public GeoJSON with provenance |

## 4. Trust boundaries

- **Keys** (Gemini, NLR) exist only in the server environment, never in browser code.
- **Gemini** receives computed metrics and approved sources only. It never sees raw geometry and never calculates.
- **Every number** in a proposal must match a supplied metric or assumption, or the text is rejected.
- **Source registry** (`shared/sources.js`) is the only list of URLs a report may cite.
- **Scenario outputs** are labelled SCENARIO ESTIMATE. There is no cost, ROI or measured-benefit claim.
- **Data** is public and dated (2021 study layers); measurements are geodesic screening metrics, not surveyed.
