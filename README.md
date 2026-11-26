# Wayfarer — trip planner

A three-pane trip planner: trip list on the left, a day-by-day itinerary drawer, and a full-bleed MapLibre map. Built with Next.js 16 (App Router), Tailwind 4, Zustand, dnd-kit, framer-motion and Supabase.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000.

- **With Supabase:** copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The app reads and writes `public.projects` and `public.project_pins` directly with the anon key. It expects the dev-mode RLS policies to allow anon reads and writes, and there is no login screen.
- **Without env vars:** the app runs in demo mode. Seed trips are kept in `localStorage`, and the reset button in the sidebar footer restores them.

The basemap is CartoDB Dark Matter and place search uses Photon (OpenStreetMap). Neither needs an API key.

## Room codes and guest join

Each trip's invite link carries a short room code (`/join/K7QM-2XPA`). Owners see the code, the link and a QR code in the Share modal. A new person can open the link, scan the QR with a phone camera, or type the code at `/join`. A valid code asks only for a display name (no account), then opens a lobby that shows the trip and who's on it. **Enter trip** goes to the workspace.

One-time Supabase setup:

1. Run [`supabase/migrations/20261122_room_codes.sql`](supabase/migrations/20261122_room_codes.sql) in the SQL editor. It adds `project_share_links.join_code`, a trigger that issues a new code whenever a link's token is reset, the signed-out `resolve_room_code(code)` lookup, a nullable `profiles.email` for guests, and adds `project_members` to the Realtime publication for the live lobby.
2. Turn on **Authentication → Sign In / Providers → Allow anonymous sign-ins**. Guests are Supabase anonymous users, so their access lives in that browser. Signing out loses it, and the sidebar asks for a second click before a guest signs out.

If guest sign-in fails with "Database error saving new user", the new-user trigger that creates `profiles` rows needs to accept a null email.

In demo mode, room codes are stored in `localStorage`, so the whole code → name → lobby flow can be tried in one browser.

## Layout

| Path | What it does |
| --- | --- |
| `types/trip.ts` | `Project`, `ProjectPin`, `PinCategory` and input types, 1:1 with the SQL schema |
| `lib/supabaseClient.ts` | Typed Supabase client, the `TripService` CRUD contract, and the Supabase and localStorage implementations |
| `store/useTripStore.ts` | Zustand store: projects, per-project pins, hover/selection, day filter, camera commands, and optimistic writes through a serialized queue with rollback |
| `lib/itinerary.ts` | Days derived from `start_date`/`end_date` with `eachDayOfInterval`, grouping pins into day and Saved Places buckets, day colors |
| `lib/geocode.ts` | Photon search and reverse geocoding |
| `app/api/cafes/route.ts`, `lib/cafes/*` | OpenStreetMap cafés (`osm.ts`), Eatbook café scraper (`eatbook.ts`), CDC Vouchers directory (`cdc.ts`), merging them (`combine.ts`), text rules (`classify.ts`), geocoding, CSV export |
| `components/workspace/CafesPanel.tsx` | Cafés tab: filters, map focus, add to trip, CSV export |
| `components/PrimarySidebar.tsx` | Trip list (upcoming and past), search, sync status, and the New Trip modal |
| `components/SecondarySidebar.tsx` | Slide-out drawer: header with editable title and dates, and the Itinerary, Saved Places and Budget tabs |
| `components/workspace/*` | Pin cards, the drag-and-drop board, inline place search, budget breakdown |
| `components/MapCanvas.tsx` | Numbered markers, dashed day routes, day filter, click-to-drop popup, ResizeObserver and auto-framing |
| `app/page.tsx` | Three-pane viewport |
| `app/join/page.tsx`, `app/join/[token]/page.tsx` | Room-code entry, and the invite landing page (guest display name or account sign-in) |
| `app/lobby/[projectId]/page.tsx`, `components/join/*` | Lobby with live presence, and the shared join-screen UI |
| `lib/roomCode.ts` | Room-code normalising and formatting (`k7qm 2xpa` → `K7QM-2XPA`) |
| `supabase/migrations/` | SQL to run on the Supabase project |

## Behaviour notes

- New rows use client-generated UUIDs, so optimistic records never need an id swap after the insert.
- Writes run in order through a single queue. If a write fails, the change is rolled back and an error toast appears.
- Shrinking a trip's date range moves pins from the removed days to Saved Places.
- Markers can be dragged to correct a location. Clicking a marker opens and scrolls to its card.
- Responsive layout:
  - **≥1280px:** both sidebars are docked.
  - **1024–1279px:** the trips sidebar starts collapsed and can be docked open.
  - **768–1023px:** the trips sidebar slides over the page.
  - **<768px:** the itinerary is a full-screen sheet, and a floating Map / Itinerary button switches between it and the map.

## Singapore cafés

Trips centred in Singapore get a **Cafés** tab. It merges three sources into one list:

- **[OpenStreetMap](https://www.openstreetmap.org/copyright)**, the base list: every mapped café, bakery, ice cream shop and coffee shop in Singapore (about 2,100 after leaving out bubble tea shops, which are often tagged as cafés), with exact coordinates and, where mappers added them, address, opening hours and website.
- **Eatbook guides**, the curated picks: [best cafés](https://eatbook.sg/best-cafes-singapore/), [quiet cafés](https://eatbook.sg/quiet-cafes/) for charging ports, and [cafés that accept CDC Vouchers](https://eatbook.sg/cafes-cdc-vouchers-singapore/). These bring prices, hours, types and charging ports, and are listed first.
- **The official [CDC Vouchers merchant directory](https://www.gowhere.gov.sg/cdcvouchers)**, which says which cafés take CDC Vouchers and adds heartland cafés OpenStreetMap lacks.

Each café shows its area, address, opening hours, price range, café type, whether it has charging ports, and whether it takes CDC Vouchers. Filter by type (including **Kopi & toast**), price tier, charging ports or **CDC vouchers**, **hide chains**, or search by name, area or street. The listed cafés also appear as amber dots on the map, and clicking a café (in the list or on the map) highlights it in both places and flies the map to it. **Add to Saved Places** turns a café into a trip pin. **Export CSV** downloads the filtered list.

- `GET /api/cafes` fetches all three sources on the server, merges them, and caches the result in memory for 24 hours. `?refresh=1` re-scrapes, at most once every 10 minutes. Each source can fail on its own: a list missing one is cached for 30 minutes so it fills in sooner. If a refresh fails outright, the last good list is served with `stale: true`.
- **OpenStreetMap** comes from the public Overpass API, which is often at capacity. Overpass rejects browser-like User-Agents (HTTP 406), so it gets a plain one. The first fetch retries with backoff; after that, the last good result is kept in memory and in `.next/cache/wayfarer-osm-cafes.json`, so a busy Overpass means one quick attempt and then the saved result (cached for 3 hours). The data is © OpenStreetMap contributors under the ODbL, credited in the panel.
- **Addresses.** About half of OSM's cafés are mapped as a bare point with no address, often inside a mall or block whose outline has one. A second, lighter Overpass query fetches the addressed building outlines within 15 m of cafés mapped as points without a postcode; such a café borrows the house number, street, postcode and building name of the building it sits in (or whose wall is within 10 m), but never mixes in a building on a different street. It's a separate request so a slow building query never costs the café list; if it fails, addresses filled on an earlier run are kept.
- **Merging.** A guide café found in OpenStreetMap (same business by fuzzy name, at the same postcode or within 200 m of its postcode's building) takes OSM's coordinates and replaces the OSM entry; same-named cafés elsewhere stay separate branches. OSM features mapped twice (same name within 40 m) are dropped. OSM cafés without a postcode take their area from the nearest known postcode within 1 km.
- **Chains.** A café is a chain if its OSM brand has a Wikidata entry, or if its brand or name has four or more outlets in the list (Starbucks, Toast Box, Ya Kun, Fun Toast, Swee Heng…). **Hide chains** filters them out.
- **CDC Vouchers.** The directory is the data file behind gowhere.gov.sg/cdcvouchers: every participating hawker and heartland merchant with its address and coordinates, but no category. A café from the other sources is marked as taking CDC Vouchers when the directory lists the same business at the same postcode or within 100 m, or when it's in the CDC guide. Directory merchants whose names say café, coffee, kopi, bakery or dessert, and that matched nothing, are added as cafés of their own; coffeeshop operators, drink stalls, hawker dishes and generic names ("Coffee & Tea", "Kopi 273") are left out.
- **Geocoding** (guide cafés not found in OpenStreetMap). A Singapore postal code is one building, so they're first placed from the coordinates the CDC directory or OSM has for the same postcode. The rest go to OneMap and then Photon. OneMap's search now answers 401 without a token, so it is skipped after the first refusal; a geocoder that keeps failing is skipped for the rest of that refresh, and its misses aren't cached.
- Only facts are kept: name, address, hours, prices, type, charging ports, halal status and a link back to the guide entry. No article text is copied.
- Values are derived from each café's write-up. The price range spans the dish prices quoted, and the `$`/`$$`/`$$$` tier comes from the median dish (≤ S$10, ≤ S$25, above). Types come from keyword rules. Charging ports are yes or no only when the guide says so, and unknown otherwise (including "only at other branches").
- If Eatbook changes its page layout and the parser finds no cafés, the server logs a warning and the list comes from the other sources; only when every source comes back empty does the API return an error.
