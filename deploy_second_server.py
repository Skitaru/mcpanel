"""Deploy MCPanel patches to second server (5.231.108.226).
Usage: python deploy_second_server.py
Requires: pip install paramiko
Configure credentials below or set env vars MCPANEL_HOST / MCPANEL_PASS.
"""
import paramiko
import os

HOST = os.environ.get("MCPANEL_HOST", "5.231.108.226")
USER = "root"
PASS = os.environ.get("MCPANEL_PASS", "")
BASE = os.path.dirname(os.path.abspath(__file__))
REMOTE_BASE = "/opt/mcpanel"

FILES = [
    "src/index.ts",
    "src/types.ts",
    "src/services/docker.ts",
    "src/services/config-store.ts",
    "src/routes/servers.ts",
    "frontend/src/lib/types.ts",
    "frontend/src/components/CreateServerDialog.tsx",
    "frontend/src/components/EditServerDialog.tsx",
]

if not PASS:
    print("Set MCPANEL_PASS environment variable.")
    exit(1)

def ssh_cmd(cmd):
    """Run command on server, return (stdout, stderr, exit_code)."""
    _, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    code = stdout.channel.recv_exit_status()
    return out, err, code

print(f"Deploying to {HOST}...")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, timeout=30)

# 1. SCP all files
sftp = client.open_sftp()
for rel in FILES:
    local = os.path.join(BASE, rel)
    remote = os.path.join(REMOTE_BASE, rel).replace("\\", "/")
    print(f"  {rel}")
    sftp.put(local, remote)
sftp.close()
print(f"  ({len(FILES)} files)")

# 2. Backend
out, err, code = ssh_cmd(
    f"cd {REMOTE_BASE} && npx tsc && systemctl restart mcpanel-backend")
print(f"Backend: {'OK' if code == 0 else 'FAIL ' + err[:200]}")

# 3. Frontend
out, err, code = ssh_cmd(
    f"cd {REMOTE_BASE}/frontend && npx next build && systemctl restart mcpanel-frontend")
print(f"Frontend: {'OK' if code == 0 else 'FAIL ' + err[:200]}")

client.close()
print("Done.")
