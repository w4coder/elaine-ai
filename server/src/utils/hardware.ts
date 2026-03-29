import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** Detect the primary GPU and its VRAM. Returns null if none found. */
export async function detectGpu(): Promise<{ name: string; vramMb: number } | null> {
  const platform = process.platform;
  try {
    if (platform === "win32" || platform === "linux") {
      const { stdout } = await execAsync(
        "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits"
      );
      const parts = stdout
        .trim()
        .split(",")
        .map((s) => s.trim());
      if (parts.length >= 2) {
        return { name: parts[0], vramMb: parseInt(parts[1], 10) };
      }
    }
    if (platform === "darwin") {
      const { stdout } = await execAsync(
        "system_profiler SPDisplaysDataType | grep -E 'Chipset Model|VRAM'"
      );
      const nameMatch = stdout.match(/Chipset Model: (.+)/);
      const vramMatch = stdout.match(/VRAM[^:]*:\s*(\d+)\s*MB/i);
      if (nameMatch) {
        return { name: nameMatch[1].trim(), vramMb: vramMatch ? parseInt(vramMatch[1], 10) : 0 };
      }
    }
  } catch {
    // nvidia-smi not found — try WMI on Windows for AMD/Intel
    if (platform === "win32") {
      try {
        const { stdout } = await execAsync(
          "wmic path Win32_VideoController get Name,AdapterRAM /format:csv"
        );
        const lines = stdout
          .trim()
          .split("\n")
          .filter((l) => l.includes(",") && !l.startsWith("Node"));
        if (lines.length > 0) {
          const parts = lines[0].split(",");
          const vramBytes = parseInt(parts[1] ?? "0", 10);
          return {
            name: parts[2]?.trim() ?? "Unknown GPU",
            vramMb: Math.round(vramBytes / 1024 / 1024),
          };
        }
      } catch {
        // No GPU info available
      }
    }
  }
  return null;
}

/** Check whether a local HTTP service is reachable at the given URL. */
export async function checkServiceRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return res.ok || res.status === 401 || res.status === 404;
  } catch {
    return false;
  }
}
