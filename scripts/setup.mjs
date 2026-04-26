#!/usr/bin/env node
// Elaine one-shot setup. Designed for `npx github:w4coder/elaine-ai` (or `npm run setup`
// inside a checkout). Installs deps, picks Ollama/vLLM, ensures the provider, pulls a model,
// builds, starts the server, opens the browser.

import { spawn, spawnSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, platform } from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";
import { homedir } from "node:os";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const IS_WIN = platform === "win32";
const IS_LINUX = platform === "linux";
const IS_MAC = platform === "darwin";

const REPO = process.env.ELAINE_REPO || "w4coder/elaine-ai";
const ELAINE_HOME =
  process.env.ELAINE_HOME ||
  (IS_WIN
    ? resolve(process.env.LOCALAPPDATA || homedir(), "Elaine")
    : resolve(homedir(), ".elaine"));

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};
const log = (msg) => console.log(`${c.cyan}›${c.reset} ${msg}`);
const ok = (msg) => console.log(`${c.green}✓${c.reset} ${msg}`);
const warn = (msg) => console.log(`${c.yellow}!${c.reset} ${msg}`);
const die = (msg) => {
  console.error(`${c.red}✗${c.reset} ${msg}`);
  process.exit(1);
};

const rl = createInterface({ input, output });
const ask = (q) => rl.question(`${c.bold}? ${q}${c.reset} `);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: false, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (exit ${r.status})`);
}
function which(bin) {
  const r = spawnSync(IS_WIN ? "where" : "which", [bin], { stdio: "pipe" });
  return r.status === 0 ? r.stdout.toString().split(/\r?\n/)[0].trim() : null;
}
function httpPing(url, timeoutMs = 1500) {
  return new Promise((resolveP) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolveP(res.statusCode < 500);
    });
    req.on("error", () => resolveP(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolveP(false);
    });
  });
}
async function waitFor(url, label, tries = 30) {
  for (let i = 0; i < tries; i++) {
    if (await httpPing(url)) {
      ok(`${label} is up`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ─── Stable install location handling ────────────────────────────────────────
// When invoked via `npx github:...`, ROOT points into npm's _npx cache — a
// transient location that will be wiped on next npx run, taking the SQLite DB
// with it. Detect that and relocate to a stable ELAINE_HOME, then re-exec.
function isTransientRoot() {
  const sepWrapped = `${sep}_npx${sep}`;
  return ROOT.includes(sepWrapped) || ROOT.includes("/_npx/") || ROOT.includes("\\_npx\\");
}

async function relocateIfNeeded() {
  if (!isTransientRoot()) return ROOT; // running from a real checkout — stay put
  if (resolve(ROOT) === resolve(ELAINE_HOME)) return ROOT;

  if (!which("git")) {
    die(
      "git is required for the npx install path. Install git and re-run, or clone the repo manually and run `npm run setup`."
    );
  }

  if (!existsSync(ELAINE_HOME)) {
    log(`Cloning Elaine to ${c.bold}${ELAINE_HOME}${c.reset}…`);
    mkdirSync(dirname(ELAINE_HOME), { recursive: true });
    run("git", ["clone", "--depth", "1", `https://github.com/${REPO}.git`, ELAINE_HOME]);
  } else {
    log(`Existing install detected at ${ELAINE_HOME} — pulling latest…`);
    try {
      run("git", ["-C", ELAINE_HOME, "pull", "--ff-only"]);
    } catch {
      warn("git pull failed — continuing with existing checkout");
    }
  }

  const stableSetup = resolve(ELAINE_HOME, "scripts", "setup.mjs");
  log(`Re-launching setup from stable location…`);
  rl.close();
  const child = spawn(process.execPath, [stableSetup], {
    stdio: "inherit",
    cwd: ELAINE_HOME,
    env: { ...process.env, ELAINE_RELOCATED: "1" },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  // Prevent the rest of main() from running in this process.
  await new Promise(() => {});
  return ELAINE_HOME; // unreachable
}

// ─── Windows PATH refresh after winget installs ──────────────────────────────
function refreshWindowsPath() {
  if (!IS_WIN) return;
  try {
    const machine = execSync(
      "powershell -NoProfile -Command \"[System.Environment]::GetEnvironmentVariable('Path','Machine')\""
    )
      .toString()
      .trim();
    const user = execSync(
      "powershell -NoProfile -Command \"[System.Environment]::GetEnvironmentVariable('Path','User')\""
    )
      .toString()
      .trim();
    process.env.PATH = [machine, user].filter(Boolean).join(";");
  } catch {
    /* best-effort */
  }
}

function ollamaBinaryFallback() {
  if (!IS_WIN) return null;
  const candidates = [
    resolve(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    "C:\\Program Files\\Ollama\\ollama.exe",
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

function resolveOllama() {
  return which("ollama") || ollamaBinaryFallback();
}

// ─── Steps ───────────────────────────────────────────────────────────────────

async function ensureNodeDeps(root) {
  log("Installing npm dependencies (workspaces)…");
  run(IS_WIN ? "npm.cmd" : "npm", ["install"], { cwd: root });
  ok("Dependencies installed");
}

async function startOllamaIfNotRunning(ollamaBin) {
  if (await httpPing("http://127.0.0.1:11434/api/tags")) {
    ok("Ollama already serving on :11434");
    return true;
  }
  log("Starting Ollama service…");
  spawn(ollamaBin, ["serve"], { detached: true, stdio: "ignore" }).unref();
  return await waitFor("http://127.0.0.1:11434/api/tags", "Ollama");
}

async function detectOrInstallOllama() {
  if (await httpPing("http://127.0.0.1:11434/api/tags")) {
    ok("Ollama is already running");
    return true;
  }
  let bin = resolveOllama();
  if (bin) return await startOllamaIfNotRunning(bin);

  warn("Ollama is not installed.");
  const yes = (await ask("Install Ollama now? [Y/n]")).trim().toLowerCase();
  if (yes && yes !== "y" && yes !== "yes") return false;

  if (IS_WIN) {
    if (!which("winget")) {
      die(
        "winget not found. Install Ollama manually from https://ollama.com/download then re-run."
      );
    }
    run("winget", [
      "install",
      "--id",
      "Ollama.Ollama",
      "-e",
      "--accept-source-agreements",
      "--accept-package-agreements",
    ]);
    refreshWindowsPath();
  } else if (IS_LINUX || IS_MAC) {
    log("Running official Ollama install script…");
    execSync("curl -fsSL https://ollama.com/install.sh | sh", { stdio: "inherit" });
    // The Linux installer registers a systemd service that auto-starts Ollama.
    // Give it a moment to come up before deciding whether to spawn `ollama serve`.
    await new Promise((r) => setTimeout(r, 2000));
  }

  bin = resolveOllama();
  if (!bin) die("Ollama install completed but binary still not found on PATH.");
  return await startOllamaIfNotRunning(bin);
}

async function detectOrInstallVllm() {
  if (IS_WIN) {
    warn("vLLM is not officially supported on native Windows. Use WSL or pick Ollama.");
    return false;
  }
  if (await httpPing("http://127.0.0.1:8000/v1/models")) {
    ok("vLLM is already running on :8000");
    return true;
  }
  if (!which("python3") && !which("python")) {
    die("Python 3 is required for vLLM. Install Python 3.10+ and re-run.");
  }
  const py = which("python3") ?? "python";
  warn("vLLM install requires a CUDA-capable GPU and may take several minutes.");
  const yes = (await ask("Install vLLM via pip now? [Y/n]")).trim().toLowerCase();
  if (yes && yes !== "y" && yes !== "yes") return false;
  run(py, ["-m", "pip", "install", "--upgrade", "vllm"]);
  warn("vLLM does not auto-start a daemon. Start it manually with:");
  console.log(`    ${py} -m vllm.entrypoints.openai.api_server --model <your-model>`);
  return false;
}

async function pullOllamaModel(model) {
  const bin = resolveOllama();
  if (!bin) die("ollama binary not found when pulling model");
  log(`Pulling model ${c.bold}${model}${c.reset} via Ollama (this can take a while)…`);
  run(bin, ["pull", model]);
  ok(`Model ${model} pulled`);
}

async function smokeTestOllama(model) {
  log(`Smoke-testing ${model}…`);
  const body = JSON.stringify({ model, prompt: 'Say "ok" and nothing else.', stream: false });
  return new Promise((resolveP) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: 11434,
        path: "/api/generate",
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            ok(`Model responded: ${(j.response || "").trim().slice(0, 60)}`);
            resolveP(true);
          } catch {
            warn("Model responded but output was not JSON");
            resolveP(false);
          }
        });
      }
    );
    req.on("error", (e) => {
      warn(`Smoke test failed: ${e.message}`);
      resolveP(false);
    });
    req.write(body);
    req.end();
  });
}

function writeProviderHint(root, provider, model) {
  const hintDir = resolve(root, "server", "data");
  if (!existsSync(hintDir)) mkdirSync(hintDir, { recursive: true });
  const hintPath = resolve(hintDir, "setup-hint.json");
  writeFileSync(
    hintPath,
    JSON.stringify({ provider, model, createdAt: new Date().toISOString() }, null, 2)
  );
  ok(`Wrote setup hint to ${hintPath}`);
}

async function buildAndStart(root) {
  log("Building client and server…");
  run(IS_WIN ? "npm.cmd" : "npm", ["run", "build"], { cwd: root });
  ok("Build complete");

  log("Starting Elaine on http://127.0.0.1:3001 …");
  const child = spawn(IS_WIN ? "npm.cmd" : "npm", ["run", "start"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env },
  });

  const up = await waitFor("http://127.0.0.1:3001/api/health", "Elaine server", 60);
  if (up) await openBrowser("http://127.0.0.1:3001");
  else warn("Server did not report healthy in time — check the logs above.");

  const stop = () => {
    child.kill("SIGINT");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function isWsl() {
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return (
      existsSync("/proc/version") && /microsoft/i.test(execSync("cat /proc/version").toString())
    );
  } catch {
    return false;
  }
}

function browserOpeners() {
  if (IS_WIN) return [["cmd", ["/c", "start", "", "__URL__"]]];
  if (IS_MAC) return [["open", ["__URL__"]]];
  if (isWsl()) {
    return [
      ["wslview", ["__URL__"]],
      ["cmd.exe", ["/c", "start", "", "__URL__"]],
      ["xdg-open", ["__URL__"]],
    ];
  }
  return [["xdg-open", ["__URL__"]]];
}

async function openBrowser(url) {
  for (const [cmd, argsTpl] of browserOpeners()) {
    const args = argsTpl.map((a) => a.replace("__URL__", url));
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    const failed = await new Promise((res) => {
      child.once("error", () => res(true));
      child.once("spawn", () => {
        child.unref();
        res(false);
      });
    });
    if (!failed) {
      ok(`Opened ${url}`);
      return;
    }
  }
  warn(`Could not auto-open a browser. Visit ${url} manually.`);
}

async function main() {
  console.log(`${c.bold}Elaine setup${c.reset} — local-first AI assistant\n`);

  const root = await relocateIfNeeded();

  await ensureNodeDeps(root);

  const providerChoice = (
    await ask(
      `Which provider do you want to use? [${c.bold}o${c.reset}llama / ${c.bold}v${c.reset}llm] (default: ollama)`
    )
  )
    .trim()
    .toLowerCase();
  const provider = providerChoice.startsWith("v") ? "vllm" : "ollama";

  let providerReady = false;
  if (provider === "ollama") providerReady = await detectOrInstallOllama();
  else providerReady = await detectOrInstallVllm();

  if (!providerReady && provider === "vllm") {
    warn("Continuing setup — start vLLM yourself, then configure it in Settings.");
  } else if (!providerReady) {
    die("Could not get the provider running. Re-run after fixing the issue.");
  }

  let chosenModel = null;
  if (provider === "ollama" && providerReady) {
    const def = "qwen2.5:7b";
    const modelAns = (
      await ask(`Model to pull (default: ${def}, smaller option: qwen2.5:3b)`)
    ).trim();
    chosenModel = modelAns || def;
    await pullOllamaModel(chosenModel);
    await smokeTestOllama(chosenModel);
  }

  writeProviderHint(root, provider, chosenModel);

  rl.close();
  await buildAndStart(root);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
