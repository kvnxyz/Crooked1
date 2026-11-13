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
      Controllers/              # one controller per domain: Auth, POS, Transaction, Exchange, Products, Discounts, Activity, Forecasting, Realtime
      Models/                   # request DTOs, read models (TransactionViews), sheet rows, value lists, ExchangePolicy
      Services/                 # ThresholdForecastService + SalesForecaster (ML.NET forecasting), TransactionStore (shared reads),
                                # DiscountStore (coupon reads, subtotal, usage), AccountSessions (ends outdated sessions),
                                # ActivityLog (writes activity_logs entries), Money (peso formatting),
                                # TransactionExcel (xlsx export), ShopClock (UTC <-> PH time),
                                # LiveUpdates + [LiveUpdate] (Supabase Realtime broadcasts),
                                # ProductImages (restores committed photos into the Railway volume)
    Frontend/
      page/                     # one .html per page
      design/                   # one .css per page, plus dashboard.css (admin base) and components.css (shared components)
      javascript/               # one .js per page, plus shared ui.js, live.js, layout.js, account.js, theme.js and session.js
      assets/                   # static images and logo
    wwwroot/images/products/    # uploaded product images (written at runtime)
```

Pages:
- `index` is the login page.
- `PointofSale` is the cashier view.
- `receipt` is the printable receipt. The POS leaves the sale in localStorage and opens the page in a small window; `receipt.js` reads and clears the sale, fills in the page and prints it.
- The admin pages share a sidebar: `dashboard`, `products`, `inventory`, `transaction-logs`, `activity-logs`, `exchange`, `sales-history`, `discounts`, `staff-management` (shown as Accounts), and `forecasting`. Pages marked `data-owner-only` are restricted to the owner role.
- Each size and color of a product is its own row in `products`. The `products` page and the POS show one card per product (same name and category). On the `products` page, the card shows the count of sizes, colors and units in stock, and its Manage window lists each size and color with Edit, Archive and "Add size or color". The `inventory` page keeps one row per size and color, with a "Sort by" choice: out of stock last (the default) or low stock first.
  - The name, category, price and photo are shared by every size and color of a product. Change them with "Edit details" in the Manage window (`PUT /api/Products/update-details/{id}`, which updates every active row with that row's name and category). A size's own Edit changes only its size, color and stock (`update-product/{id}`, sending the shared details unchanged).
  - Add Product takes the shared details and a list of size-and-color rows (`<template id="variantRowTemplate">`), and "Add size or color" uses the same form with the details left out. Both send `POST /api/Products/add-variants`, which adds every row in one transaction. It refuses a size and color the product already has, active or archived (ignoring case), and gives added sizes the product's existing photo (`PhotoFromId`).
  - The card's Archive archives every size and color with one request and one log entry (`POST /api/Products/archive-group/{id}`). The rules and limits are in `ProductRules` (api/Models/ProductForms.cs).
- `transaction-logs` (Audit Logs, the sale records) and `activity-logs` (who did what) each have a one-line `.page-description` under the heading so they're easy to tell apart. The style is in `dashboard.css`, and any page can use it.

## Conventions

- Follow the existing structure. Don't add new top-level folders when an existing layer fits.
- Keep HTML, CSS and JavaScript in their own files:
  - HTML has no `style=` or `on...=` attributes and no inline `<style>` or `<script>` blocks. Scripts find elements by id or `data-action` and use `addEventListener`.
  - JavaScript has no HTML strings (`innerHTML`, `document.write`) and doesn't set styles (`element.style.display`). Show and hide things with the `hidden` attribute, and change their look with a class. A value only known at runtime can be passed as a CSS variable.
  - Markup a script repeats goes in a `<template>` in the page's HTML, as in `products.html` and `receipt.html`. Small pieces can be built with `UI.el` and `UI.cell`.
- A new page needs three files that share its name: `page/<name>.html`, `design/<name>.css`, and `javascript/<name>.js`, using kebab-case for new names. Add its link to the sidebar on every admin page.
- Reuse the shared pieces instead of copying them:
  - `ui.js` (the `UI` namespace) with `components.css`: skeleton loaders (`tableSkeleton`, `cardSkeletons`, `textSkeleton`), table empty/error states (`tableMessage`), `fillTable`, `labelCells`, badges (`statusBadge`, and `stockBadge` for a product's `stock_status`), `pagination`, toasts, `setLoading` for buttons, `fetchJson`, `download`, `detailPair`, and formatters (`formatPeso`, `variantLabel`, `variantName`, and `compareSizes` for sorting sizes). It also turns `<input type="file" data-file-picker="Label">` into a button-only file picker. Every page loads it, including the login page and the POS.
  - The confirmation dialog (`showDialog`) is styled once in `components.css`: blurred backdrop, centred text and buttons.
  - `live.js` (the `Live` namespace): `Live.on(topics, reload)` reloads a view when the server broadcasts that those topics changed. Loaders take `{ quiet: true }` for these refreshes so they skip skeletons and keep the current rows until new ones arrive.
  - `layout.js` provides `apiBase`, dialogs (`showDialog`), `showToast`, modals with focus trapping, the navigation drawer, the profile card, logout, the owner-only redirect, and forecast notifications.
  - `theme.js` handles light and dark mode.
  - `session.js` (the `Session` namespace) guards every page behind the login. It sends signed-out visitors to `index.html` (also when Back/Forward shows a page from the browser's memory), sends the browser to the login page whenever our API answers 401, and provides `Session.signOut()` for the logout buttons.
  - `account.js` holds the Change Password form (`openPasswordForm`) and the profile menu's `changeOwnPassword`. It uses the `trapFocus`, `restoreFocus`, `showDialog` and `setProfileCardOpen` helpers that both `layout.js` and `PointOfSale.js` define. Staff Management uses the same form for the owner to set a staff member's password.
  - `dashboard.css` holds the shared admin styles and colour tokens.
  - Admin pages load `theme.js` and `session.js` in `<head>`, then `ui.js`, `live.js`, `layout.js`, `account.js` and the page's own script at the end of `<body>`. The POS loads `theme.js` and `session.js` in `<head>`, then `ui.js`, `live.js`, `PointOfSale.js` and `account.js`; the login page loads `theme.js` and `ui.js` (never `session.js`); the receipt loads `session.js` in `<head>`, then `ui.js` and `receipt.js`.
  - Show a skeleton while data loads and a `tableMessage` (with a retry action) when a request fails, instead of leaving a table blank.
  - Build rows with DOM methods and `textContent` (`UI.cell`, `UI.el`), not `innerHTML` with server data.
  - `index.js` and `PointOfSale.js` still keep their own copies of the `showDialog` and `trapFocus` helpers. Don't add more copies like them.
- Pages link to resources with `../design/`, `../javascript/`, `../assets/`, and `../page/`. Program.cs serves `Frontend/page` and `Frontend` from the site root so those links resolve.
- Call the API with same-origin paths (`/api/...` or `${apiBase}/api/...`). Never hardcode `localhost:5055`, because it breaks the deployed site.
- Bump the `?v=` number on a script or stylesheet link when you change that file, so browsers don't keep the old copy.
- New backend features go in a controller for their domain under `api/Controllers`, with models in `api/Models`. Schema changes go in `Database/schema.sql` as idempotent SQL (`IF NOT EXISTS`).
- Login uses ASP.NET Core cookie authentication: `POST /api/Auth/login` sets the HttpOnly `crkd_session` cookie (with the user's username, role and full name), and `POST /api/Auth/logout` deletes it. Program.cs makes every API endpoint require a signed-in user. Add `[Authorize(Roles = UserRoles.Owner)]` to endpoints that only owner pages use, and `[AllowAnonymous]` only to endpoints the login page needs (login, logout, owner recovery). The `userRole` in localStorage only decides what the UI shows; the server never trusts it.
- `AccountSessions.ValidateAsync` (Program.cs, `OnValidatePrincipal`) ends a session when its account has been archived or given a different role since login, so the API answers 401 and session.js sends that browser to the login page. Roles are cached for 30 seconds; call `AccountSessions.Forget(username)` after changing an account's role or archiving it.
- Every endpoint that changes data writes an activity log entry with `ActivityLog.WriteAsync` (or `Write`), passing the open database transaction, the signed-in person's name (`SessionClaims.FullNameOf(User)`, never a name the browser sends) and an `ActivityTypes` value, and adds `LiveTopics.Activity` to its `[LiveUpdate]`.
- Mark every endpoint that changes data with `[LiveUpdate(LiveTopics.X, ...)]` so open pages refresh, and register matching `Live.on([...])` reloads on the pages that show that data.
- Times are stored in UTC. Convert them with `ShopClock` (Philippine time, UTC+8) instead of `ToLocalTime()`, because the server runs on UTC.

## Responsive layout

Every page works from small phones (320px wide) up to desktops, so there is no minimum screen size. Check new pages at phone, tablet and laptop widths.

- Admin pages keep the fixed sidebar above 1100px. At 1100px and below, `initializeNavDrawer` in `layout.js` adds a menu button and logo to the top bar and the sidebar becomes a slide-in drawer.
- Table cells wrap when a row doesn't fit, so tables fit their panel on tablets and laptops instead of scrolling sideways.
- At 760px and below, each table row becomes a small card of labelled values (`dashboard.css`). `UI.fillTable` labels the cells from the `<th>` text; a table filled another way must call `UI.labelCells(tbody)`. The first cell, cells with the `col-wrap` class, and columns with a `.visually-hidden` heading get a full line.
- POS: at 760px and below, or under 560px tall, the products fill the page and a bar at the bottom shows the item count and total. The bar slides the checkout up as a sheet (`setCartOpen` in `PointOfSale.js`). `sheetLayout` in `PointOfSale.js` must match the media query in `PointofSale.css`.
- Follow `100vh` with `100dvh` for full-height elements, because phone browser bars change the visible height.
- On touch screens `components.css` makes form fields 16px, because phone browsers zoom in on smaller text when a field gets focus.

## Transactions and exchanges

- Sale records are read-only in the Audit Logs (the `transaction-logs` page). The page lists 10 per page from `GET /api/POS/Transaction/search` (search, status, payment and date filters). The owner can export the filtered sales and their items to `.xlsx` with `/export`. There is no import: sales only come from the POS, so no file can add or change a sale.
- The `sales-history` page reads the same `/search` endpoint, 10 sales per page, with search (reference ID, staff or product) and a date range, and shows who made each sale. Its summary line shows the count and the total revenue of every matching sale ("85 sales in total • Total Revenue: ₱42,500.00"). `/search` returns that as `totalRevenue`: completed sales only (exchanged ones included, voided and pending left out), and `null` for staff, because revenue is owner-only.
- `transactions.payment_method` is `Cash`, `GCash` or `Unknown`.
- An exchanged sale keeps `status = 'Completed'` (so it still counts as revenue) and gets `has_exchange = TRUE`. The API shows it as "Exchanged".
- Exchanges go through `ExchangeController` and follow `ExchangePolicy`: only items bought as a single piece (quantity 1), only within 3 days of the sale (Philippine dates), for the same product (name and category) at the same price in a different size and/or color. Items bought in larger quantities are not shown. Each exchange:
  - puts the returned variant back into stock and takes the replacement out of stock;
  - moves the sale's `product_daily_sales` count to the new variant;
  - updates `transaction_items` to match what the customer now has;
  - records the change in `exchanges` and `exchange_items`, and writes an `activity_logs` entry.

## Accounts and roles

- The Accounts page (`staff-management`) lists every account from `GET /api/Auth/get-staff` (owners first, `isSelf` marks the signed-in one). Active accounts have Role (an Owner/Staff dropdown, `POST /api/Auth/role/{id}`), Password (`staff-password/{id}`) and Archive (`toggle-archive/{id}`) columns.
- The signed-in owner can't change their own role or archive their own account, so there is always an active owner. Their own Password button opens the Change Password form that asks for the current password.

## Discounts

- The owner creates coupons on the `discounts` page (`DiscountsController`, table `discounts`). A coupon is a whole-number percentage (1 to 100) or a fixed peso amount, with an optional minimum purchase, usage limit and start/end dates (Philippine dates). Codes are saved in capitals and match ignoring case. Coupons can be disabled, enabled and deleted; deleting one doesn't change sales that used it.
- `StoredDiscount` (api/Models/Discount.cs) holds the rules: its status (Active, Scheduled, Expired, Used up, Disabled), why it can't be used (`Problem`) and the amount off (`AmountOff`: percentages round to the centavo, fixed amounts never exceed the subtotal). `discountAmount` in `PointOfSale.js` must follow the same rule.
- At the POS any cashier can apply a coupon, picked from a dropdown of the ones usable today (`GET /api/Discounts/available`, reloaded for each new checkout and on live updates). `POST /api/Discounts/apply` checks it against the checkout's items without changing anything. The POS checks it again just before stock is taken, then sends `discountCode` with the sale. `SaveTransaction` locks the coupon row, checks it once more, works out the subtotal from product prices, stores `total_amount` (after the discount), `discount_code` and `discount_amount`, and adds one to `times_used`. For these sales the browser's total is ignored.
- Instead of a coupon, a cashier can give a manual discount: "Manual discount" at the end of the POS dropdown asks for a whole-number percentage. Owners can give up to 100%; staff up to the limit the owner sets in the Manual Discounts card on the `discounts` page (`discount_settings.staff_max_percent`, default 10, where 0 turns them off for staff). The rules are in `ManualDiscount` (api/Models/Discount.cs), and `DiscountStore.ManualMaxPercentAsync` decides the limit from the session's role, never from the browser.
  - `GET /api/Discounts/manual` gives the signed-in person's limit (`maxPercent`) and the staff limit; `POST /api/Discounts/manual` (owner) changes the staff limit; `POST /api/Discounts/apply-manual` checks a manual discount without changing anything. The POS checks it again just before stock is taken.
  - `SaveTransaction` checks it again, works out the total from product prices, and stores `manual_discount_percent` and `discount_amount` with `discount_code` left NULL. A sale can't have both a coupon and a manual discount. The sale's activity log entry includes the percentage and amount.
- The receipt and the Audit Logs details show the discount. The Excel export doesn't include it.

## Activity logs

- `activity_logs` records who did what: sales ("Processed sale ..."), exchanges, product, discount and account changes, and logins and logouts. `activity_type` holds the kind (`ActivityTypes` in api/Models/Activity.cs); schema.sql sorts entries written before that column existed by their wording, and ones it doesn't recognise become `Other`. The `Import` type is only for older entries from the Excel import, which was removed.
- The owner-only `activity-logs` page lists every entry, newest first, 20 per page, from `GET /api/Activity` (search, type, staff and date filters), with the Staff filter's names from `GET /api/Activity/staff`. It replaced the dashboard's old Recent Activity card.

## Sales forecasting

- `ThresholdForecastService` checks every hour and updates each active product at most once per `DebounceHours` (24), using the `ThresholdForecast` settings in appsettings.json. Products with no stored forecast are updated on the next check.
- `SalesForecaster` forecasts the next 7 days for each product (name and category) from `product_daily_sales`, using complete Philippine days only. With at least `MinHistoryDays` (28) since the first sale, it backtests ML.NET's SSA time-series model against the 7-day average on the last 1 to 3 weeks and uses whichever missed by less. Otherwise it uses the 7-day average. If ML.NET fails (for example, native libraries won't load), it logs a warning and falls back to the average.
- Sizes and colors share a product's forecast, split by each one's share of the last 28 days' sales. Each one's low-stock threshold covers `CoverageDays` of predicted sales, and its Fast/Moderate/Slow rating comes from predicted units a day (3 or more, 1 or more).
- Forecasts are stored in `product_forecasts`. `GET /api/Forecasting/daily-sales` adds them to each product, along with the days of stock left and a restock suggestion (`RestockDays`) worked out from the current stock.

## Live updates (Supabase Realtime)

- Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` on the server (Railway variables) to turn them on; without them nothing changes.
- The server broadcasts `{ topics: [...] }` on the public channel `crkd-live` through Supabase's REST broadcast API after a data change. Pages get the URL and anon key from `GET /api/Realtime/config` and subscribe with supabase-js. Messages never contain table data.
- Because the anon key is public, `schema.sql` enables row level security on every table the app owns, so the key can't read or change data through Supabase's REST API. The app connects as the table owner, which RLS doesn't restrict.

## Run and deploy

- Local: `dotnet run --project src/CrookedAPI`, then open http://localhost:5055.
- Railway builds the root `Dockerfile`. The Dockerfile finds `CrookedAPI.csproj` itself, so the build works whether the service's Root Directory is empty or `src`. The app listens on Railway's `PORT` variable, and Program.cs handles that.
- Production runs on Linux, so file names are case-sensitive. Links must match file names exactly; for example, `PointofSale.html` and `PointofSale.css` but `PointOfSale.js`.
- Uploaded product images are kept in a Railway volume mounted at `/app/wwwroot/images/products`; without it they are lost on every redeploy. The volume hides the images committed to git, so the Dockerfile keeps a copy in `/app/product-images` and `ProductImages.RestoreBuiltIn` (called from Program.cs) copies any missing ones into the volume at startup.
- A photo uploaded from a local copy of the app (`dotnet run`) is saved on that computer, but its path goes into the shared database, so the live site can't show it. Upload photos on the live site.
- A product without a photo has an empty `image_url`, which the pages show as their placeholder. There is no default image file.
- Program.cs sends HTML pages with `Cache-Control: no-cache`, so browsers check for a new page on every visit and pick up the new `?v=` links right after a deploy.
