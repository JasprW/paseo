import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// In CI we often install a single workspace (e.g. server/relay/website). Only apply patches
// when the patched dependency is actually present.
const patchedPackages = [
  {
    nodeModulesPath: "node_modules/react-native-draggable-flatlist",
    patchPrefix: "react-native-draggable-flatlist+",
  },
  {
    nodeModulesPath: "node_modules/react-native-gesture-handler",
    patchPrefix: "react-native-gesture-handler+",
  },
  {
    nodeModulesPath: "node_modules/node-pty",
    patchPrefix: "node-pty+",
  },
];

const installedPatchPrefixes = patchedPackages
  .filter(({ nodeModulesPath }) => existsSync(nodeModulesPath))
  .map(({ patchPrefix }) => patchPrefix);

if (!existsSync("patches") || installedPatchPrefixes.length === 0) {
  process.exit(0);
}

const patchFilesToApply = readdirSync("patches").filter(
  (file) =>
    file.endsWith(".patch") &&
    installedPatchPrefixes.some((patchPrefix) => file.startsWith(patchPrefix)),
);

if (patchFilesToApply.length === 0) {
  process.exit(0);
}

const isWindows = process.platform === "win32";
const binName = isWindows ? "patch-package.cmd" : "patch-package";
const localBin = join(process.cwd(), "node_modules", ".bin", binName);
const cmd = existsSync(localBin) ? localBin : binName;
const patchDir = mkdtempSync(".paseo-patches-");
let exitStatus = 1;

try {
  for (const patchFile of patchFilesToApply) {
    copyFileSync(join("patches", patchFile), join(patchDir, patchFile));
  }

  const result = spawnSync(cmd, ["--patch-dir", patchDir], {
    shell: isWindows,
    stdio: "inherit",
    windowsHide: true,
  });
  exitStatus = result.status ?? 1;
} finally {
  rmSync(patchDir, { recursive: true, force: true });
}

process.exit(exitStatus);
