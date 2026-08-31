# WorkPA — your personal work assistant

A lightweight, single-user work & team manager for a tech lead / project manager. No Jira, no Azure DevOps — just the things you actually need every day:

| Area | What it does |
| --- | --- |
| **Dashboard** | Today's list, follow-ups due, overdue/due-soon tasks, in-progress work, team targets this week, recent notes |
| **Today** | Per-day to-do list with a "main focus", progress bar, carry-over of unfinished items from previous days, 3-week history. Each item can have a **date + time**; you get a reminder **30 min before** (or 10/15/60 min, at the time, or none) |
| **Work Items** (projects) | Priority board: columns **P1 / P2 / P3 / Unprioritised** plus a **Done** lane — drag a work item between lanes (or use its ⋯ menu; phones get lane chips). Each card shows task counts, progress, PBI/sprint state. Create / edit / delete work items (name + description + priority) "View tasks" filters the board; "+ Task" adds a task straight into the work item. Deleting a work item keeps its tasks (unlinked) unless you choose "Delete with tasks" |
| **My Tasks** | Kanban board (drag & drop) or list view. Statuses: To Do / In Progress / On Hold / Done. Priority, **optional work item**, tags, due date. Multiple **dated notes** per task and a full status-change history |
| **Notes** | Standalone journal — meeting notes, decisions, ideas. Grouped by date, searchable, taggable, pinnable |
| **Team & Targets** | Team members + targets assigned to them. Each target has a target date, a **follow-up reminder** (once → date & time; daily → time + optional start/until; weekly → weekday + time + optional range), and a dated follow-up log (on track / at risk / blocked) |
| **Reminders** | Ad-hoc "remind me…" nudges: once (date & time), daily / weekdays (time), weekly (weekday + time), monthly (day + time), each with optional start/until. Snoozing a repeating reminder only delays that occurrence — the schedule is untouched |
| **Notifications** | A server-side scheduler fires reminders as in-app toasts + bell badge + browser notifications (with a short beep). Snooze from the bell |
| **Zendesk** | Client support view: tickets per client (organization), inline status + assignee updates, and per-client SLA — applicable policies with targets plus live breached / at-risk tickets |
| **Expenses** | Personal expense manager: reads bank / card / UPI alert mails from your inbox (IMAP, read-only) and turns them into transactions, plus manual add/edit. Monthly summary by category, merchant and account, 6-month trend, rule-based overspend alerts, and (with your OpenAI key) a written spending review with alerts, tips and suggested budgets |

**Stack:** Node.js + Express + Mongoose (MongoDB) · React 18 + Vite + Tailwind CSS · single deployable service.

**Naming:** the app calls projects **Work Items** in the UI; the API (`/api/projects`), data model and Azure DevOps mapping keep the name *project*.

**Auth:** single user stored in MongoDB (bcrypt password hash), JWT sessions valid for 30 days. Credentials are never kept in env files.

---

## Run locally

```bash
# 1. Install everything (root + client)
npm install

# 2. Configure
cp .env.example .env      # then edit MONGO_URI and JWT_SECRET

# 3. Create your login (stored in MongoDB as a bcrypt hash — nothing in env files)
npm run create-user -- yourname yourpassword

# 4. Dev mode (API on :5000, Vite dev server on :5173 with proxy)
npm run dev
```

Open http://localhost:5173.

Production-style run (serves the built React app from Express on one port):

```bash
npm run build
npm start          # http://localhost:5000
```

### Environment variables

| Var | Purpose |
| --- | --- |
| `MONGO_URI` | MongoDB connection string (Atlas `mongodb+srv://…` or plain `mongodb://…`) |
| `JWT_SECRET` | Long random string used to sign session tokens (30-day sessions) |
| `TZ` | Timezone for the scheduler & "today" calculations, e.g. `Asia/Kolkata` |
| `PORT` | HTTP port (Railway injects this) |
| `DNS_SERVERS` | Optional. Comma-separated DNS servers for the `+srv` lookup. The app automatically falls back to `8.8.8.8,1.1.1.1` if the OS resolver fails (common on VPN / FortiClient machines) |
| `APP_ENCRYPTION_KEY` | Optional. Long random string used to encrypt the mailbox password / OpenAI key at rest (defaults to `JWT_SECRET`) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional fallback when no key is saved in Expenses → Settings |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Enables **Connect Gmail** (Google OAuth, scope `gmail.readonly`). Optional `GOOGLE_REDIRECT_URI` / `APP_URL` to pin the callback URL |
| `AZDO_PBI_DONE_STATE`, `AZDO_CARRY_OVER_OPEN_TASKS` | Sprint-end behaviour of PBIs (see Azure DevOps sync) |

---

## Deploy to Railway (single service)

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo. Railway detects Node via Nixpacks and uses `railway.json`:
   - build: `npm run build` (installs client deps and builds React into `client/dist`)
   - start: `npm start` (Express serves API + static React)
   - healthcheck: `/api/health`
3. Add variables in the service's **Variables** tab:
   - `MONGO_URI` — your Atlas string, **or** add Railway's MongoDB plugin and set `MONGO_URI=${{MongoDB.MONGO_URL}}`
   - `JWT_SECRET` — long random string
   - `TZ=Asia/Kolkata`
4. **Settings → Networking → Generate Domain**.
5. Your login user lives in MongoDB. If you created it locally against the same Atlas cluster, it already works on Railway. Otherwise run once via the Railway CLI: `railway run npm run create-user -- yourname yourpassword`.

You can change your password anytime from the sidebar (**Change password**).

Atlas note: whitelist `0.0.0.0/0` in Atlas Network Access (Railway egress IPs are dynamic), or use Railway's MongoDB plugin.

---

## Azure DevOps sync (optional)

Works with Azure DevOps Services **and on-prem TFS / Azure DevOps Server** (the REST `api-version` is auto-detected, 7.1 down to 3.0). Set these on the server:

```
AZDO_ORG_URL=http://your-tfs:8080/tfs/DefaultCollection   # or https://dev.azure.com/<org>
AZDO_PROJECT=<project name>
AZDO_USERNAME=DOMAIN\user                                 # optional with a PAT
AZDO_PAT=<personal access token with "Work Items: Read & write">
```

| WorkPA | Azure DevOps |
| --- | --- |
| Project (name, description) | **Product Backlog Item** in state **Approved** (`AZDO_PBI_STATE`), placed in the sprint that is current when it's created |
| Task (title, description, priority, tags, due date) | **Task**, child of the project's PBI, placed in the **sprint whose dates contain the task's due date** (creation date if no due date; a weekend gap rolls to the next sprint; dates beyond the last defined sprint stay in the backlog). Tasks with no project become standalone Tasks (`AZDO_SYNC_ORPHAN_TASKS=false` to disable) |
| Task status | `System.State`: todo → *To Do*, inprogress → *In Progress*, done → *Done*, hold → *To Do* + tag `On Hold` |
| Task note | Discussion entry (`System.History`) |
| Assigned To | The PAT's own user (override with `AZDO_ASSIGN_TO="Name <DOMAIN\user>"`) — set on creation only, so re-assigning in ADO sticks |
| Backlog position | New items go to the **top** of their sprint backlog (`AZDO_PLACE_ON_TOP=false` to disable) |
| Task moved to another project | Re-parented under the new PBI |
| Deleting in WorkPA | Nothing is deleted in ADO (a deleted project just un-parents its tasks) |

Defaults are for the **Scrum** process. For **Agile** set `AZDO_PBI_TYPE=User Story` and `AZDO_STATE_MAP={"todo":"New","inprogress":"Active","hold":"New","done":"Closed"}`. Optional `AZDO_AREA_PATH` / `AZDO_ITERATION_PATH` are applied to everything created.

Sync happens in the background right after each save — creates **and every later edit** (title, description, priority, tags, due date → sprint, project → parent, status → state, notes). Each change is flagged `pendingSync` until TFS confirms it, so nothing is lost across restarts. The ADO id (link) or the error shows as a badge on the project/task. The **Projects** page shows connection status, validates the state mapping against your process, and has **Sync all now** to backfill existing items. Failed items retry automatically every 5 minutes. Get a PAT at `https://dev.azure.com/<org>/_usersSettings/tokens`.

### One PBI per sprint, and "create the PBI later"

- **New project** has a checkbox *Create a Product Backlog Item in the current sprint* (ticked by default). Untick it and no work item is created; the project shows **No PBI yet** and its tasks are held back from TFS. Create it later from the project's ⋯ menu (**Create PBI in current sprint**) or from *Edit project* — the waiting tasks are pushed right after.
- **Sprint end**: when the sprint a PBI lives in finishes, the scheduler moves the PBI to `AZDO_PBI_DONE_STATE` (default `Done`) within a few minutes. This happens once; if you reopen it in TFS it is left alone.
- **Next task after that** (or after the PBI was closed in TFS): a fresh PBI is created in the sprint running now, the previous one is kept in the project's history (`+1 earlier PBI` on the card) and, with `AZDO_CARRY_OVER_OPEN_TASKS=true` (default), the project's still-open tasks are re-parented under the new PBI and moved to the current sprint. Done tasks stay under the old PBI.

### Attach a task to an existing sprint PBI

When creating (or editing) a task, the **Work Item** dropdown also lists the **open PBIs of the current sprint** pulled from Azure DevOps. Pick one and the ADO task is created as a child of that existing PBI instead of a WorkPA work item. WorkPA never closes or rolls over a PBI linked this way - it belongs to your team backlog; only the task itself is synced (state, title, notes, ...). Endpoint: GET /integrations/azdo/sprint-pbis.

### Two-way: changes made in TFS come back
Every 5 minutes (and on **Sync now**) WorkPA reads all linked work items and applies remote changes:
- state → task status (*Done* → done, *In Progress* → inprogress, *To Do* → todo, or hold when the `On Hold` tag is present), with a status-history entry marked "from TFS" and a notification ("TFS: <task> → Done · changed by Ravi")
- assignee and sprint are stored and shown on the task; a sprint moved in TFS is kept until you change the task's due date in WorkPA
- items deleted in TFS get a red badge so you notice

Local edits waiting to be pushed always win over a pull.

## Personal Expense Manager

Open **Expenses** in the sidebar (phone: More → Expenses). Everything is configured in the app under **Expenses → ⋯ → Settings**; the mailbox password and the OpenAI key are stored **encrypted in MongoDB** (AES-256-GCM, key derived from `APP_ENCRYPTION_KEY`, falling back to `JWT_SECRET`) and are never returned by the API.

**Gmail (recommended)** — Google sign-in. One-time server setup: in Google Cloud Console create a project, enable the **Gmail API**, configure the OAuth consent screen (External; add your Google account as a test user, and *Publish* the app so the token does not expire after 7 days) and create an **OAuth client ID → Web application** with the authorised redirect URI `https://<your-domain>/api/expenses/gmail/callback` (e.g. `https://workmanager.up.railway.app/api/expenses/gmail/callback`). Put the client ID/secret in the service's variables as `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Then in the app: Expenses → Settings → **Connect Gmail** → approve the read-only `gmail.readonly` scope on Google's screen → you land back on Expenses and the first sync starts. The refresh token is stored encrypted; *Disconnect* revokes it.

**Other mailboxes (IMAP)** — any IMAP provider with an app password (Gmail, Outlook/M365, Yahoo, Zoho, iCloud, other). WorkPA logs in read-only, lists mails since the look-back window (first sync) / since the last seen UID (later syncs), keeps only mails that look like transaction alerts (sender + subject heuristics, optional sender whitelist) and parses them:

1. **Rules** (offline): amount, debit/credit, merchant, account (bank + last 4 digits), method (UPI / card / NEFT…), category from a merchant keyword table. OTPs, due-date reminders, statements, offers and failed attempts are ignored.
2. **OpenAI** (when a key is saved): mails are sent in batches of 8 and the model returns clean JSON (merchant, category, account, method, date). Falls back to rules per batch on error.

Duplicates are skipped by e-mail `Message-ID` and by a fingerprint (type + amount + day + merchant). Sync runs on demand (**Sync mailbox**) and automatically every N hours (default 6). A full re-scan of the last 90 days is in the ⋯ menu.

**Alerts** (work without AI, delivered as notifications + shown on the page):
- a category on track to exceed your 3-month average by more than the configured ratio (default +30 %), once per category per month
- the whole month on track to overspend by 20 %+
- a single payment ≥ the large-payment threshold (default ₹10,000)

**AI insights** — *Regenerate AI insights* (or automatically every Monday morning) sends aggregated statistics (monthly totals per category, last-90-day patterns, top / recurring merchants, largest payments — never raw mails) to OpenAI and shows a spending-health score, a summary, alerts, concrete tips and suggested monthly budgets. The weekly review is posted as a notification.

Manual entries: **Add expense** (also in the phone's + sheet). Any transaction can be edited, re-categorised inline, excluded from totals (e.g. transfers to your own account) or deleted.

## Zendesk (optional)

A **Zendesk** screen for client support work, configured only by env vars (`ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN`):

- **Tickets by client** — pick a client (Zendesk organization) or all; filter by status (Unsolved / New / Open / Pending / On hold / Solved), search, open any ticket in the Zendesk agent view.
- **Update from WorkPA** — change status and assignee inline (agents + admins listed); closed tickets are read-only, exactly as in Zendesk.
- **SLA per client** — the policies that apply to the selected client with their targets, plus the live state of its open tickets: breached SLAs and ones breaching within 4h, with countdown chips per ticket.

**Restricted accounts:** `node server/scripts/createUser.js <username> <password> [display name] --role=zendesk` creates a login that can only use the Zendesk screen. The API enforces it server-side (everything except `/api/zendesk` and `/api/auth` returns 403); such accounts see only Zendesk-kind notifications and no push/digest.

API: `/api/zendesk/status`, `/orgs`, `/agents`, `/tickets` (`?org=&status=&q=`), `PUT /tickets/:id` (`{status, assigneeId}`), `/sla?org=`.

## Design system (Tailwind)
The client is styled with **Tailwind CSS v3** (`client/tailwind.config.js`, PostCSS). `client/src/styles.css` holds a small `@layer components` vocabulary (`btn`, `input`, `card`, `badge-*`, `chip`, `segmented`, overlays, phone sheet) built with `@apply`; pages compose everything else from utilities. Palette: slate neutrals + `primary` (indigo) with a `bg-brand` indigo→violet gradient for the active nav item, primary buttons, dashboard hero and FAB; typeface Plus Jakarta Sans; borderless soft-shadow cards; secondary actions live in a ⋯ menu (`components/Menu.jsx`). Sizing follows platform norms: 36–40px controls on desktop, 44–48px touch targets and 16px inputs on phones (`max-md:` variants), `md` (768px) is the phone/desktop breakpoint, 256px sidebar, 64px header, 56px tab bar + safe-area. Icons are inline SVG (`components/icons.jsx`). Note: avoid class names that collide with Tailwind utilities (e.g. `list-item`, `container`).

## Phone app (PWA) & mobile layout
WorkPA is fully usable on a phone: bottom tab bar (Home · Today · Tasks · Team · More), a **+** button for quick-add (task, to-do, reminder, note, target, project), full-screen forms, a one-column board with status chips (tap a task to change status — there's no drag & drop on touch), card lists instead of tables, and hover-only actions always visible.

**Add to home screen / install:** a banner (and *More → Add to home screen*, or the sidebar's **Install app** on desktop) triggers the browser install prompt on Android Chrome/Edge/Samsung and desktop Chrome/Edge. iOS never offers a prompt, so WorkPA shows the steps instead: Safari → Share → *Add to Home Screen*. The service worker has a fetch handler + offline page, which Chrome requires before it treats a site as installable; `sw.js`, the manifest and `offline.html` are served with `Cache-Control: no-cache` so phones never keep a stale one.

## Push notifications (phone & desktop)
WorkPA is an installable PWA with Web Push. In the bell menu click **Enable push** — reminders, follow-ups, TFS changes and the morning digest then arrive as system notifications even when the app is closed. VAPID keys are generated automatically and stored in the DB (or set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`).

- Android / desktop Chrome, Edge, Firefox: works directly.
- iPhone / iPad (iOS 16.4+): first **Share → Add to Home Screen**, open WorkPA from the icon, then enable push.

## Morning digest
At **09:00 on weekdays** (`DIGEST_HOUR`, `DIGEST_MINUTE`, `DIGEST_WEEKDAYS_ONLY=false` for every day) you get one notification with: today's focus, to-dos (first timed one), follow-ups due, overdue and due-today tasks, team targets due, reminders, and what's in progress. Preview or send it any time from the bell menu (**Today's digest**).

## How reminders work

- Every 30 s the server checks for: team targets whose `followUpAt` (or snooze) has passed, reminders whose `remindAt` (or snooze) has passed, to-do items whose `scheduledAt − remindBefore` has passed, and tasks due today/overdue (once a day, after 9 AM).
- Each creates a **Notification**. The browser polls every 30 s (and immediately when the tab regains focus), shows a toast, plays a beep, and — if you've allowed it — a native browser notification.
- Snoozing re-arms the follow-up/reminder for later. Repeating items advance to their next occurrence automatically.
- Keep the app open in a pinned browser tab during the day and it behaves like a PA. (There's no email/SMS channel — this is intentionally simple.)

---

## Project layout

```
server/
  index.js            Express app, serves client/dist in production
  config/db.js        Mongo connection (+ SRV DNS fallback)
  middleware/auth.js  Single-user JWT auth
  models/             User, Project, Task, Note, DailyTodo, Member, Target, Reminder, Notification
  routes/             REST endpoints per model + /dashboard
  services/scheduler.js  Reminder engine (+ sprint-end PBI closing, mailbox sync, spending alerts)
  services/mail.js, expenseParser.js, expenses.js, ai.js, secrets.js  Expense manager (IMAP reader, parser, summary/alerts/insights, OpenAI client, encryption)
client/
  src/pages/          Dashboard, Today, Tasks, Notes, Team, Reminders, Expenses, Login
  src/components/     Layout (sidebar + phone tab bar/FAB), NotificationBell, Toast, Modal/Drawer/Sheet, ui helpers
  src/lib/api.js      Axios client + typed helpers
  src/lib/install.js  Add-to-home-screen (beforeinstallprompt) support · useMedia.js phone breakpoint hook
  public/             manifest.webmanifest, sw.js (push + offline fallback), offline.html, icons/
```

## API (all under `/api`, bearer token required except `/auth/*` and `/health`)

`/projects` · `/tasks?project=<id|none>` `/tasks/:id/notes` `/tasks/:id/status` · `/notes` · `/daily?date=` `/daily/:date/items` `/daily/:date/carryover` · `/members` · `/targets` `/targets/:id/followups` `/targets/:id/snooze` · `/reminders` `/reminders/:id/snooze` · `/notifications` · `/dashboard` · `/expenses` (`?month=`), `/expenses/summary`, `/expenses/meta`, `/expenses/settings` (+ `/test-mail`, `/test-ai`), `/expenses/sync`, `/expenses/insights` · `/integrations/azdo/sync/project/:id` (also creates a deferred PBI), `/integrations/azdo/close-ended-sprints, /integrations/azdo/sprint-pbis`
