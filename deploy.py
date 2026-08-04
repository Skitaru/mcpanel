#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════╗
║  ⚠️  KRITISCH — PRODUKTIONSSERVER MIT AKTIVEN SPIELERN  ⚠️  ║
║                                                              ║
║  Server "Zentrum" (Paper 1.21, Port 25565) ist LIVE.        ║
║  KEINE destruktiven Aktionen:                                ║
║   - Kein docker rm / docker stop / docker kill               ║
║   - Kein Loeschen von /opt/mcpanel/data/                     ║
║   - Kein systemctl stop (ausser fuer kontrollierte Neustarts)║
║   - Kein Loeschen des Servers ueber die API                  ║
║   - Kein Aendern von servers.json ohne Backup                ║
║  Vor jedem Eingriff: Backup erstellen!                       ║
╚══════════════════════════════════════════════════════════════╝

SSH helper for MCPanel server at 5.231.108.226.

Usage:
  python deploy.py "<command>"              Run any command on the server
  python deploy.py scp <local> <remote>     Upload a file (use // for remote
                                            paths to prevent MSYS2 conversion)
  python deploy.py rebuild-frontend         Rebuild + restart frontend
  python deploy.py rebuild-backend          Recompile + restart backend

Examples:
  python deploy.py "ls /opt/mcpanel"
  python deploy.py scp ./myfile.ts //opt/mcpanel/src/myfile.ts
"""

import paramiko
import sys
import os
import io
import errno

# Fix encoding for Windows Git Bash (cp1252 can't handle unicode chars like ✓)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HOST = "5.231.108.226"
USER = "root"
PASSWORD = "Alabalanica28!"
SSH_TIMEOUT = 15  # connection timeout
CMD_TIMEOUT = 120  # command execution timeout (builds can take a while)


def _connect():
    """Create a new SSH client connected to the server."""
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=SSH_TIMEOUT)
    return c


def ssh_cmd(cmd: str) -> tuple[str, str]:
    """Execute a command on the server. Returns (stdout, stderr)."""
    c = _connect()
    try:
        stdin, stdout, stderr = c.exec_command(cmd, timeout=CMD_TIMEOUT)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        return out, err
    finally:
        c.close()


def scp_put(local: str, remote: str):
    """Upload a local file to the server.

    Note on MSYS2/Git-Bash: MSYS2 auto-converts paths that look like Unix
    paths (starting with /). To prevent this, prefix remote paths with //
    (e.g. //opt/mcpanel/...). The // is stripped before sending.
    """
    # Strip MSYS2 double-slash escape prefix
    if remote.startswith("//") and not remote.startswith("///"):
        remote = remote[1:]

    # Validate local path
    local_abs = os.path.abspath(local)
    if not os.path.isfile(local_abs):
        print(f"ERROR: Local file not found: {local_abs}", file=sys.stderr)
        sys.exit(1)

    c = _connect()
    try:
        sftp = c.open_sftp()
        try:
            sftp.put(local_abs, remote)
            print(f"OK: {os.path.basename(local)} -> {remote}")
        except IOError as e:
            if e.errno == errno.ENOENT:
                print(f"ERROR: Remote path does not exist: {remote}", file=sys.stderr)
                print("       Parent directory missing, or MSYS2 converted the path.", file=sys.stderr)
                print("       Tip: use // prefix for remote paths, e.g. //opt/mcpanel/...", file=sys.stderr)
            else:
                print(f"ERROR: SFTP failed: {e}", file=sys.stderr)
            sys.exit(1)
        finally:
            sftp.close()
    finally:
        c.close()


def rebuild_frontend():
    """Rebuild Next.js frontend and restart the service."""
    out, err = ssh_cmd(
        "cd /opt/mcpanel/frontend && npx next build 2>&1 && systemctl restart mcpanel-frontend"
    )
    # Only show last ~20 lines of build output (the important part)
    lines = out.split("\n")
    if len(lines) > 25:
        print("\n".join(lines[-20:]))
    else:
        print(out)
    if err:
        print("STDERR:", err, file=sys.stderr)


def rebuild_backend():
    """Recompile TypeScript backend and restart the service."""
    out, err = ssh_cmd(
        "cd /opt/mcpanel && npx tsc 2>&1 && systemctl restart mcpanel-backend"
    )
    print(out)
    if err:
        print("STDERR:", err, file=sys.stderr)


def run_raw(cmd: str):
    """Execute an arbitrary command on the server."""
    out, err = ssh_cmd(cmd)
    if out:
        print(out.rstrip())
    if err:
        print("STDERR:", err.rstrip(), file=sys.stderr)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    sub = sys.argv[1]

    if sub in ("-h", "--help", "help"):
        print(__doc__)
    elif sub == "scp":
        if len(sys.argv) < 4:
            print("Usage: python deploy.py scp <local-file> <remote-path>", file=sys.stderr)
            print('Tip: use // for remote paths to prevent MSYS2 conversion', file=sys.stderr)
            sys.exit(1)
        scp_put(sys.argv[2], sys.argv[3])
    elif sub == "rebuild-frontend":
        rebuild_frontend()
    elif sub == "rebuild-backend":
        rebuild_backend()
    else:
        run_raw(" ".join(sys.argv[1:]))
