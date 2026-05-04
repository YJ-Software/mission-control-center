# Mission Control — Release Deploy

Bundle-based deployment that avoids running `npm install` on the customer box.
Pairs with `npm run build:release` which produces
`dist/mission-control-vX.Y.Z-linux-x64.tar.gz`.

## Layout

```
~/mission-control/                      # install prefix
├── current → versions/vX.Y.Z           # atomic symlink
└── versions/
    ├── vX.Y.Z/                         # tarball contents (server.js, .next/, node_modules/, …)
    │   ├── .env.local  → ../../~/.mission-control/.env.local   (symlink)
    │   └── data/       → ~/.mission-control/data               (symlink)
    └── vX.Y.(Z-1)/                     # previous version, kept for rollback

~/.mission-control/                     # persistent state (never wiped on upgrade)
├── .env.local                          # AUTH_PASSWORD, AUTH_SECRET, OPENCLAW_TOKEN, …
├── data/                               # morning-report output, backups
├── db.sqlite                           # Drizzle-managed
└── gateway-device-key.pem              # Ed25519 device identity
```

`current` is a symlink, so an upgrade is a `ln -sfn` + `systemctl restart` —
no file overwrites, no downtime beyond the restart. Rolling back is the same
operation with a different target.

## First-time install

`npm run build:release` produces three files in `dist/`:

```
dist/
├── install.sh                                  # run this
├── upgrade.sh                                  # (reference; also shipped inside tarball)
├── mission-control.service.tmpl                # (reference; used by install.sh)
└── mission-control-v0.1.0-linux-x64.tar.gz
```

On the customer box, drop all four files in the same directory and run:

```bash
bash install.sh mission-control-v0.1.0-linux-x64.tar.gz
```

What the script does:

1. Verifies `node >= 20` is on `PATH`.
2. Extracts the tarball to `~/mission-control/versions/vX.Y.Z/`.
3. Generates `~/.mission-control/.env.local` (random password + HMAC secret,
   auto-detects OpenClaw gateway token from `~/.openclaw/openclaw.json` if
   present) — `chmod 600`.
4. Symlinks `.env.local` and `data/` inside the versioned dir to the state dir.
5. Installs a systemd user unit at `~/.config/systemd/user/mission-control.service`,
   enables it, starts it, `loginctl enable-linger` so it survives logout.
6. Waits for `/api/health` to come up (30s), then prints URL + password.

Override paths:

```bash
PREFIX=/opt/mission-control STATE=/var/lib/mission-control bash install.sh …
```

## Upgrade (CLI)

```bash
bash ~/mission-control/current/install/upgrade.sh \
     ~/downloads/mission-control-v0.1.1-linux-x64.tar.gz
```

Flow:

1. Extract new version to `versions/vNEW/`.
2. Symlink `.env.local`, `data/` (state-dir pointers identical to install).
3. `ln -sfn` swap `current`.
4. `systemctl --user restart mission-control`.
5. Poll `/api/health` until `{"version":"NEW"}` responds (default 60s timeout).
6. On timeout → roll `current` back + restart.
7. Prune — keep the 3 most recent versions in `versions/` (override with
   `KEEP_VERSIONS=5`).

The UI upgrade flow (planned) will call the same logic from an API route
instead of the shell, so the install/upgrade semantics stay in one place.

## Rollback (manual)

```bash
# List installed versions
ls ~/mission-control/versions/

# Swap back to a previous version
ln -sfn ~/mission-control/versions/v0.1.0 ~/mission-control/current
systemctl --user restart mission-control
```

## Uninstall

```bash
systemctl --user disable --now mission-control
rm ~/.config/systemd/user/mission-control.service
systemctl --user daemon-reload
rm -rf ~/mission-control                    # removes the code
# State is kept at ~/.mission-control/ — delete manually if you want a full wipe:
# rm -rf ~/.mission-control
```

## Service control

```bash
systemctl --user status  mission-control
systemctl --user restart mission-control
systemctl --user stop    mission-control
journalctl   --user -u   mission-control -f
```
