# Crooked (CRKD)

POS, inventory, and stock-forecasting system for a clothing store. A single ASP.NET Core 8 app serves both the JSON API and the static HTML/CSS/JS frontend. Data lives in PostgreSQL (Supabase), accessed with raw SQL through Npgsql. Entity Framework is referenced but not used. ClosedXML reads and writes the Excel (.xlsx) files.

## Layout

```
Dockerfile, .dockerignore, railway.json   # deploy config (build context = repo root)
src/
  CrookedAPI.sln
  CrookedAPI/
    CrookedAPI.csproj
    appsettings.json            # ThresholdForecast options
    Database/
      DatabaseConfig.cs         # connection string (env DB_CONNECTION_STRING overrides)
      DatabaseSetup.cs          # runs schema.sql at startup
      schema.sql                # idempotent schema updates + row level security (embedded in the build)
    api/
      Program.cs                # service registration, schema setup call, static file serving
      Controllers/              # one controller per domain: Auth, POS, Transaction, Exchange, Products, Forecasting, Realtime
      Models/                   # request DTOs, read models (TransactionViews), sheet rows, value lists, ExchangePolicy
      Services/                 # ThresholdForecastService, TransactionStore (shared reads),
                                # TransactionExcel (xlsx export/import), ShopClock (UTC <-> PH time),
                                # LiveUpdates + [LiveUpdate] (Supabase Realtime broadcasts),
                                # ProductImages (restores committed photos into the Railway volume)
    Frontend/
      page/                     # one .html per page
      design/                   # one .css per page, plus dashboard.css (admin base) and components.css (shared components)
      javascript/               # one .js per page, plus shared ui.js, live.js, layout.js and theme.js
      assets/                   # static images and logo
    wwwroot/images/products/    # uploaded product images (written at runtime)
```

Pages:
- `index` is the login page.
- `PointofSale` is the cashier view.
- The admin pages share a sidebar: `dashboard`, `products`, `inventory`, `transaction-logs`, `exchange`, `sales-history`, `staff-management`, and `forecasting`. Pages marked `data-owner-only` are restricted to the owner role.

## Conventions

- Follow the existing structure. Don't add new top-level folders when an existing layer fits.
- A new page needs three files that share its name: `page/<name>.html`, `design/<name>.css`, and `javascript/<name>.js`, using kebab-case for new names. Add its link to the sidebar on every admin page.
- Reuse the shared pieces instead of copying them:
  - `ui.js` (the `UI` namespace) with `components.css`: skeleton loaders (`tableSkeleton`, `cardSkeletons`, `textSkeleton`), table empty/error states (`tableMessage`), `fillTable`, badges (`statusBadge`), `pagination`, toasts, `setLoading` for buttons, `fetchJson`, `download`, `detailPair`, and formatters (`formatPeso`, `variantLabel`, `variantName`, and `compareSizes` for sorting sizes). It also adds the small-screen blocker (pages are hidden below 768px wide) and turns `<input type="file" data-file-picker="Label">` into a button-only file picker. Every page loads it, including the login page and the POS.
  - The confirmation dialog (`showDialog`) is styled once in `components.css`: blurred backdrop, centred text and buttons.
  - `live.js` (the `Live` namespace): `Live.on(topics, reload)` reloads a view when the server broadcasts that those topics changed. Loaders take `{ quiet: true }` for these refreshes so they skip skeletons and keep the current rows until new ones arrive.
  - `layout.js` provides `apiBase`, dialogs (`showDialog`), `showToast`, modals with focus trapping, the profile card, logout, the owner-only redirect, and forecast notifications.
  - `theme.js` handles light and dark mode.
  - `dashboard.css` holds the shared admin styles and colour tokens.
  - Admin pages load `theme.js` in `<head>`, then `ui.js`, `live.js`, `layout.js` and the page's own script at the end of `<body>`. The POS loads `ui.js` and `live.js`; the login page loads `ui.js`.
  - Show a skeleton while data loads and a `tableMessage` (with a retry action) when a request fails, instead of leaving a table blank.
  - Build rows with DOM methods and `textContent` (`UI.cell`, `UI.el`), not `innerHTML` with server data.
  - `index.js` and `PointOfSale.js` still keep their own copies of the `showDialog` and `trapFocus` helpers. Don't add more copies like them.
- Pages link to resources with `../design/`, `../javascript/`, `../assets/`, and `../page/`. Program.cs serves `Frontend/page` and `Frontend` from the site root so those links resolve.
- Call the API with same-origin paths (`/api/...` or `${apiBase}/api/...`). Never hardcode `localhost:5055`, because it breaks the deployed site.
- Bump the `?v=` number on a script or stylesheet link when you change that file, so browsers don't keep the old copy.
- New backend features go in a controller for their domain under `api/Controllers`, with models in `api/Models`. Schema changes go in `Database/schema.sql` as idempotent SQL (`IF NOT EXISTS`).
- Mark every endpoint that changes data with `[LiveUpdate(LiveTopics.X, ...)]` so open pages refresh, and register matching `Live.on([...])` reloads on the pages that show that data.
- Times are stored in UTC. Convert them with `ShopClock` (Philippine time, UTC+8) instead of `ToLocalTime()`, because the server runs on UTC.

## Transactions and exchanges

- Sale records are read-only in the Audit Logs (the `transaction-logs` page). The page lists 10 per page from `GET /api/POS/Transaction/search` (search, status, payment and date filters). Export and import use `/export`, `/import-template` and `/import` with `.xlsx` files only. Import matches sales by Reference ID: new ones are added, existing ones are updated when any field (or, if the file lists them, any item) differs, and unchanged ones are skipped. It never changes stock.
- `transactions.payment_method` is `Cash`, `GCash` or `Unknown`.
- An exchanged sale keeps `status = 'Completed'` (so it still counts as revenue) and gets `has_exchange = TRUE`. The API shows it as "Exchanged".
- Exchanges go through `ExchangeController` and follow `ExchangePolicy`: only items bought as a single piece (quantity 1), only within 3 days of the sale (Philippine dates), for the same product (name and category) at the same price in a different size and/or color. Items bought in larger quantities are not shown. Each exchange:
  - puts the returned variant back into stock and takes the replacement out of stock;
  - moves the sale's `product_daily_sales` count to the new variant;
  - updates `transaction_items` to match what the customer now has;
  - records the change in `exchanges` and `exchange_items`, and writes an `activity_logs` entry.

## Live updates (Supabase Realtime)

- Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` on the server (Railway variables) to turn them on; without them nothing changes.
- The server broadcasts `{ topics: [...] }` on the public channel `crkd-live` through Supabase's REST broadcast API after a data change. Pages get the URL and anon key from `GET /api/Realtime/config` and subscribe with supabase-js. Messages never contain table data.
- Because the anon key is public, `schema.sql` enables row level security on every table the app owns, so the key can't read or change data through Supabase's REST API. The app connects as the table owner, which RLS doesn't restrict.

## Run and deploy

- Local: `dotnet run --project src/CrookedAPI`, then open http://localhost:5055.
- Railway builds the root `Dockerfile`. The Dockerfile finds `CrookedAPI.csproj` itself, so the build works whether the service's Root Directory is empty or `src`. The app listens on Railway's `PORT` variable, and Program.cs handles that.
- Production runs on Linux, so file names are case-sensitive. Links must match file names exactly; for example, `PointofSale.html` and `PointofSale.css` but `PointOfSale.js`.
- Uploaded product images are kept in a Railway volume mounted at `/app/wwwroot/images/products`; without it they are lost on every redeploy. The volume hides the images committed to git, so the Dockerfile keeps a copy in `/app/product-images` and `ProductImages.RestoreBuiltIn` (called from Program.cs) copies any missing ones into the volume at startup.
