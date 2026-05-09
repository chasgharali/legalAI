# MedChron AI

> AI-powered medical chronology and case intelligence platform for UK personal injury and clinical negligence law firms.

## Features

- **Medical Chronology Generation** — Upload GP notes, hospital records, consultant reports and more. GPT-4o extracts every clinical event, date-ordered with relevance flags (causation critical, incident-related, pre-existing).
- **Case Summary & Causation Analysis** — AI generates a structured medico-legal case summary with causation chain analysis, suitable for instructions to counsel or a medical expert.
- **Barrister-Ready Bundle** — One-click generation of a complete bundle (cover page, table of contents, full chronology, document index) in printable HTML format.
- **Per-Matter Chat Interface** — Ask questions about the medical records; the AI cites specific chronology entries and source pages.
- **Fee Earner Verification Workflow** — Every AI-generated entry can be individually verified. Bundle is watermarked "AI-Generated — Review Required" until verified.
- **GDPR/SRA Compliant** — Data stored in AWS eu-west-2 (London), row-level security per firm, 8-hour session timeout, full audit log.

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| AI | OpenAI GPT-4o |
| PDF Parsing | `pdf-parse` |
| Auth | `next-auth` v4 (credentials) |
| Database | Prisma 7 + MongoDB (Atlas) |
| Storage | AWS S3 (eu-west-2) |
| Styling | Tailwind CSS |

## Getting Started

### 1. Clone and install

```bash
cd /path/to/project
npm install
```

### 2. Environment variables

Copy `.env.local.example` to `.env.local` and fill in all values:

```bash
cp .env.local.example .env.local
```

Required variables:
- `OPENAI_API_KEY` — your OpenAI API key
- `DATABASE_URL` — MongoDB connection string (MongoDB Atlas recommended, use EU region: `mongodb+srv://...`)
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `NEXTAUTH_URL` — `http://localhost:3000` in dev
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `AWS_S3_BUCKET` — for PDF storage

### 3. Set up the database

MongoDB does not use migrations — Prisma will create collections automatically on first write.

```bash
# Push the schema to MongoDB (creates indexes, no migrations needed)
npx prisma db push

# (Optional) Open Prisma Studio
npx prisma studio
```

### 4. Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to `/login`. Register your firm first at `/register`.

### 5. Demo workflow

1. Register a firm account at `/register`
2. Create a new matter (`/matters/new`)
3. Upload PDF medical records on the Documents tab — tag each file (GP Notes, Hospital Inpatient, etc.)
4. Click **Generate Chronology** on each document
5. Review the colour-coded timeline on the Chronology tab
6. Generate the Case Summary
7. Download the Barrister Bundle (HTML → print to PDF)
8. Use the Chat tab to query the records: *"Was there a pre-existing back condition?"*

## Project Structure

```
src/
├── app/
│   ├── (auth)/             # Login & register pages
│   ├── (dashboard)/        # All authenticated pages
│   │   ├── page.tsx        # Dashboard home
│   │   ├── matters/        # Matter list & new matter form
│   │   └── matters/[matterId]/
│   │       ├── documents/  # Upload + document management
│   │       ├── chronology/ # Interactive timeline
│   │       ├── summary/    # AI case summary
│   │       ├── bundle/     # PDF bundle builder
│   │       └── chat/       # Query interface
│   └── api/                # REST API routes
├── components/             # React components
├── lib/                    # Utilities, prompts, DB client
└── types/                  # TypeScript types
```

## Compliance Notes

- All medical data is **special category data** under GDPR Article 9 — ensure your DPA with hosting providers covers this.
- The SRA expects solicitors to understand AI tool limitations — the in-app disclosure language is included on all AI outputs.
- Never disclose AI-generated bundles without fee earner verification — use the verify checkbox workflow.
- All data is stored in `eu-west-2` (London) for UK data residency compliance.

## Monetisation

| Tier | Price |
|---|---|
| Pay-per-case | £75/matter |
| Starter (10/mo) | £500/mo |
| Growth (50/mo) | £1,800/mo |
| Enterprise | Custom |
