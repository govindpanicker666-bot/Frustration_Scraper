import { spawnSync } from "node:child_process";

const python = process.env["PYTHON_EXECUTABLE"]?.trim() || "python3";
const checks = [
  ["OpenLeads", "openleads"],
  ["Linkook", "linkook"],
  ["Maigret", "maigret"],
];

for (const [label, moduleName] of checks) {
  const result = spawnSync(python, ["-m", moduleName, "--help"], {
    encoding: "utf8",
    timeout: 30_000,
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `[verify-lead-discovery-tools] ${label} failed to launch via ${python} -m ${moduleName}: ${result.error?.message ?? result.stderr ?? `exit ${result.status}`}`,
    );
  }
  console.log(`[verify-lead-discovery-tools] ${label} module launch OK (${python} -m ${moduleName})`);
}
