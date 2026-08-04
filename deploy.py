#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════╗
║  ⚠️  KRITISCH — PRODUKTIONSSERVER MIT AKTIVEN SPIELERN  ⚠️  ║
║                                                              ║
║  Server "Zentrum" (Paper 1.21, Port 25565) ist LIVE.        ║
║  KEINE destruktiven Aktionen:                                ║
║   - Kein docker rm / docker stop / docker kill               ║
║   - Kein Löschen von /opt/mcpanel/data/                      ║
║   - Kein systemctl stop (außer für kontrollierte Neustarts)  ║
║   - Kein Löschen des Servers über die API                    ║
║   - Kein Ändern von servers.json ohne Backup                 ║
║  Vor jedem Eingriff: Backup erstellen!                       ║
╚══════════════════════════════════════════════════════════════╝

SSH helper for MCPanel server at 5.231.108.226.
Usage: python deploy.py "<command>"   — runs command on server
       python deploy.py scp <local> <remote>  — uploads a file
       python deploy.py rebuild-frontend
       python deploy.py rebuild-backend
"""

import paramiko
import sys
import os

HOST = "5.231.108.226"
USER = "root"
PASSWORD = "Alabalanica28!"

def ssh_cmd(cmd: str) -> tuple[str, str]:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    stdin, stdout, stderr = c.exec_command(cmd)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    c.close()
    return out, err

def scp_put(local: str, remote: str):
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=15)
    sftp = c.open_sftp()
    sftp.put(local, remote)
    sftp.close()
    c.close()
    print(f"SCP: {local} → {remote}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    if sys.argv[1] == "scp" and len(sys.argv) >= 4:
        scp_put(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "rebuild-frontend":
        out, err = ssh_cmd("cd /opt/mcpanel/frontend && npx next build 2>&1 && systemctl restart mcpanel-frontend")
        print(out)
        if err: print("STDERR:", err)
    elif sys.argv[1] == "rebuild-backend":
        out, err = ssh_cmd("cd /opt/mcpanel && npx tsc && systemctl restart mcpanel-backend")
        print(out)
        if err: print("STDERR:", err)
    else:
        cmd = " ".join(sys.argv[1:])
        out, err = ssh_cmd(cmd)
        print(out)
        if err: print("STDERR:", err)
