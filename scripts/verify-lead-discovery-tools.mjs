import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";

const python = process.env["PYTHON_EXECUTABLE"]?.trim();
if (!python) throw new Error("PYTHON_EXECUTABLE must point to the Render virtualenv Python");
const binDir = path.dirname(python);
const openleads = path.join(binDir, "openleads");

function run(label, command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 45_000,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `[verify-lead-discovery-tools] ${label} failed: ${result.error?.message ?? result.stderr ?? `exit ${result.status}`}`,
    );
  }
  console.log(`[verify-lead-discovery-tools] ${label} launch OK`);
}

accessSync(openleads, constants.X_OK);
run("OpenLeads CLI", openleads, ["--help"]);
run("Linkook module", python, ["-m", "linkook", "--help"]);
run("Maigret module", python, ["-m", "maigret", "--help"]);
