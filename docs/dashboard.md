# The stats dashboard

`https://linebattle.net/admin.html` shows, in one page:

- **Right now:** people with the game open, players in online matches, CPU,
  RAM, disk, network, event-loop delay, the match server's memory and the
  database size.
- **Server, last 24 hours:** a sample every minute (kept 14 days).
- **Players:** visitors per day (new and returning), how many played,
  games, minutes on the page, sign-ups and online matches.
- **Where they came from:** by `?ref=` / `?utm_source=` tag or the referring
  site (facebook, youtube, tiktok, itch, voz, google...), with how many of them
  played and for how long.
- **What they play:** games per mode, finished vs quit, average length.
- **What they press:** clicks per button.

The page sends anonymous events to `/api/track`: a random visitor id kept in
the browser, no names, IP addresses or keystrokes. Raw events are kept 120 days.

## Turning it on

The dashboard is off until it has a password. On the server, add to
`~/line-battle/.env`:

    ADMIN_KEY=<a long random password>

(`openssl rand -hex 24` makes one), then `docker compose up -d`. The server
log says `Dashboard on`. Open `/admin.html` and enter that password; the
browser remembers it.

For links you share, add a tag so the dashboard can tell them apart, e.g.
`https://linebattle.net/?ref=tiktok-bio` or `?ref=voz`.

## admin.linebattle.net

Caddy serves the dashboard at the root of `admin.linebattle.net`. To turn it on:

1. Cloudflare DNS: add an `A` record `admin` pointing at the same address as
   `linebattle.net`, **DNS only** (grey cloud), like the others, so Caddy can
   get its certificate.
2. On the server, add it to `SITE_ADDRESS` in `~/line-battle/.env`, e.g.
   `SITE_ADDRESS=linebattle.net, www.linebattle.net, admin.linebattle.net`,
   then `docker compose up -d`.
