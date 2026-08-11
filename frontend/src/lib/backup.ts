"use client";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export interface BackupJobProgress {
  jobId: string;
  serverId: string;
  name: string;
  percent: number;
  status: "running" | "done" | "error";
  writtenBytes: number;
  totalBytes: number;
  message?: string;
}

/**
 * Poll a backup job until it finishes. `onProgress` fires on every poll so the
 * caller can render a progress bar. Resolves with the final job state.
 */
export async function waitForBackupJob(
  jobId: string,
  onProgress: (job: BackupJobProgress) => void,
): Promise<BackupJobProgress> {
  const deadline = Date.now() + 10 * 60 * 1000; // safety cap: 10 min
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API_BASE}/api/servers/backups/progress/${jobId}`);
      if (res.ok) {
        const job = (await res.json()) as BackupJobProgress;
        onProgress(job);
        if (job.status === "done" || job.status === "error") return job;
      }
    } catch {
      // transient network error — keep polling
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return {
    jobId,
    serverId: "",
    name: "",
    percent: -1,
    status: "error",
    writtenBytes: 0,
    totalBytes: 0,
    message: "Backup timed out.",
  };
}
