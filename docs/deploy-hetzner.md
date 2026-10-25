# Running a Line Battle test server on Hetzner (Singapore)

One small cloud server runs everything: Caddy serves the game page on port 80
and passes the game's traffic to the match server, both in Docker
(`docker-compose.yml` in the repo root). Players just open `http://<server IP>`.

Steps 1 to 3 are yours (they need your account and payment details). After
that, send Claude the server's IP address and it can do step 4 from your PC,
or you can follow it yourself.

## 1. Make an SSH key on your PC (once)

The key lets your PC log in to the server without a password. In PowerShell:

```powershell
ssh-keygen -t ed25519            # press Enter at every question
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copy the line it prints (it starts with `ssh-ed25519`). That is the public
half; the private file never leaves your PC.

## 2. Create a Hetzner Cloud account and project

1. Sign up at https://console.hetzner.com. Hetzner may ask for ID or a payment
   method before it lets you create servers; that check can take a little while.
2. Create a project, for example **Line Battle**.

## 3. Create the server

In the project, click **Add server** and pick:

| Setting | Choose |
| --- | --- |
| Location | **Singapore** |
| Image | **Ubuntu 24.04** |
| Type | **Shared vCPU**, the smallest one offered in Singapore (2 vCPU, 2-4 GB RAM is plenty for testing) |
| Networking | Public IPv4 on |
| SSH keys | **Add SSH key**, paste the line from step 1 |
| Firewalls | **Create firewall**: allow inbound TCP 22 (SSH), 80 (HTTP) and 443 (HTTPS, for later), plus ICMP |
| Name | `line-battle-sg-1` |

Create it and note its **public IPv4 address**. Billing is by the hour; deleting
the server stops it.

## 4. Put the game on it

From the repo folder on your PC, in PowerShell (replace `SERVER_IP`):

```powershell
git archive --format=tar -o line-battle.tar master
scp line-battle.tar root@SERVER_IP:
ssh root@SERVER_IP
```

Then, logged in to the server:

```bash
curl -fsSL https://get.docker.com | sh          # installs Docker (first time only)
mkdir -p line-battle && tar -xf line-battle.tar -C line-battle
cd line-battle && docker compose up -d --build   # takes a few minutes the first time
docker compose ps                                # both services should be "Up"
```

Open `http://SERVER_IP` in a browser and play with a friend: **Create room**
and send them the code, or both click **Quick match**.

## Updating it later

Repeat step 4 (the `docker compose up -d --build` rebuilds only what changed).
Logs: `docker compose logs -f server`.

Accounts, ratings and match history live in the `game-data` Docker volume, so
rebuilds and restarts keep them. `docker compose down -v` deletes volumes:
don't use `-v` unless you mean to wipe every account. To take a backup:

```bash
docker compose exec server node -e "new (require('node:sqlite').DatabaseSync)('/data/line-battle.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp server:/data/backup.db ./line-battle-backup.db
```

## Later: a domain and HTTPS

Point a domain's DNS A record at the server's IP, then on the server create
`line-battle/.env` containing `SITE_ADDRESS=play.example.com` and run
`docker compose up -d`. Caddy gets an HTTPS certificate on its own.
