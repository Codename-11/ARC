# Running `arc-daemon` in Docker

The ARC daemon ships as a container image at
`ghcr.io/axiom-labs/arc-daemon`. It's intended for headless hosts
(workstations, home servers, small teams) where a long-running daemon
serves one or more ARC clients over the binary-mux WebSocket protocol.

The CLI itself — `arc ...` commands, TUI, chat, etc. — is **not**
included. Install it separately from npm on your client machines.

## Quick start

```bash
docker run -d \
  --name arc-daemon \
  --restart unless-stopped \
  -p 127.0.0.1:7272:7272 \
  -v arc-state:/home/arc/.arc \
  ghcr.io/axiom-labs/arc-daemon:latest
```

Then from your host:

```bash
curl http://127.0.0.1:7272/health
# → {"ok":true,"version":"...","protocol":1, ...}
```

Or via `docker compose` — an example lives in
[`docker-compose.yml`](./docker-compose.yml) alongside this file:

```bash
cd packages/daemon
docker compose up -d
```

## Port mapping

The daemon listens on port **7272** inside the container. The default
is unchanged from a local (`arc daemon start`) install so tooling
keeps working.

| Flag | Effect |
| --- | --- |
| `-p 127.0.0.1:7272:7272` | Loopback only (default, safest) |
| `-p 7272:7272` | All interfaces — see security note below |
| `-p 1.2.3.4:7272:7272` | Bind to a specific host NIC |

Override the in-container port with `ARC_PORT=<n>` if you need to
avoid a collision inside a pod/network (the `HEALTHCHECK` picks it up).

## Volume semantics

State lives under `/home/arc/.arc` inside the container — profiles,
the SQLite DB (`arc.db`), auth keypair, and the daemon log.
Persist it with either a named volume (preferred) or a bind mount:

```bash
# Named volume — Docker-managed, survives container replacement.
-v arc-state:/home/arc/.arc

# Bind mount — maps onto the host filesystem. The directory must be
# owned by uid 1000 (the `arc` user inside the image).
-v /srv/arc:/home/arc/.arc
```

If you bind-mount and see permission errors, `chown -R 1000:1000 /srv/arc`.

## Security notes

* **Default bind is 0.0.0.0:7272 inside the container.** This is safe
  when the host-side `-p` flag maps to `127.0.0.1` (as in the quick
  start). The daemon itself only accepts connections whose HTTP `Host`
  header resolves to a loopback address.
* **Exposing to a LAN requires a reverse proxy.** The daemon's pairing
  flow is designed for trusted networks. If you want remote clients,
  terminate TLS and mTLS (or an OIDC proxy) *in front* of the
  container — don't publish port 7272 to the public internet.
* **Non-root.** The process runs as uid 1000 (`arc`). All capabilities
  are dropped in the example compose file and `no-new-privileges` is
  set.
* **Secrets.** The daemon generates a long-lived keypair on first
  start and stores it inside the state volume (`auth.json`). Back this
  up if you want seamless re-issuance after a volume loss.

## Upgrading

Because state lives in a named volume, upgrading is just:

```bash
docker pull ghcr.io/axiom-labs/arc-daemon:latest
docker rm -f arc-daemon
docker run -d \
  --name arc-daemon \
  --restart unless-stopped \
  -p 127.0.0.1:7272:7272 \
  -v arc-state:/home/arc/.arc \
  ghcr.io/axiom-labs/arc-daemon:latest
```

The bundled compose stack includes a (disabled-by-default)
[watchtower](https://containrrr.dev/watchtower/) sidecar that polls
GHCR hourly and auto-rolls new stable tags. Enable it with:

```bash
docker compose --profile auto-update up -d
```

## Tags

| Tag | Cadence |
| --- | --- |
| `latest` | Latest stable release |
| `1`, `1.0`, `1.0.0` | Major / minor / patch pins |
| `sha-<7>` | Every CI build (no promotion) |

Prereleases (`-alpha`, `-beta`, `-rc`) do **not** update `latest` —
pin to the explicit version if you want to track them.

## Building locally

```bash
# From the repo root. The daemon Dockerfile needs the monorepo context.
docker build -f packages/daemon/Dockerfile -t arc-daemon:dev .

# Smoke test
docker run --rm -d \
  --name arc-dt \
  -p 17272:7272 \
  -v /tmp/arc-docker-test:/home/arc/.arc \
  arc-daemon:dev
sleep 3 && curl -s http://127.0.0.1:17272/health
docker stop arc-dt
```
