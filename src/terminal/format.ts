import process from "node:process";
import type { PlannedCommand } from "../execution/types.ts";
import { color } from "./style.ts";
export { color } from "./style.ts";

import { write } from "./io.ts";
/** Print a standalone heading; execution already reports its own command headings. */
export function banner(title: string): void {
  write(color(`◆ ${title}`, 35) + "\n");
}
/** Shell-appropriate quoting for copyable display; never used to spawn processes. */
export function quoteArgument(
  value: string,
  shell: "sh" | "nu" | "powershell" = "sh",
): string {
  if (shell === "powershell") return "'" + value.replaceAll("'", "''") + "'";
  if (shell === "nu") {
    let marks = "#";
    while (value.includes(`'${marks}`)) marks += "#";
    return `r${marks}'${value}'${marks}`;
  }
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
/** Render the resolved cwd, environment overrides, executable and arguments as one command. */
export function formatCommand(
  plan: PlannedCommand,
  shell: "sh" | "nu" | "powershell" = process.platform === "win32"
    ? "powershell"
    : "sh",
): string {
  const q = (value: string) => quoteArgument(value, shell);
  const argv = plan.command.map(q).join(" ");
  const env = Object.entries(plan.env);
  if (shell === "nu") {
    const command = `^${argv}`;
    return `do { cd ${q(plan.cwd)}; ${
      env.length
        ? `with-env { ${
          env.map(([k, v]) => `${q(k)}: ${q(v)}`).join(", ")
        } } { ${command} }`
        : command
    } }`;
  }
  if (shell === "powershell") {
    // A nested scope restores cwd and only the explicitly overridden variables.
    const setup = env.map(([k, v]) =>
      `$dvEnv[${q(k)}] = [Environment]::GetEnvironmentVariable(${
        q(k)
      }, 'Process'); [Environment]::SetEnvironmentVariable(${q(k)}, ${
        q(v)
      }, 'Process');`
    ).join(" ");
    return `& { $dvEnv = @{}; Push-Location -LiteralPath ${
      q(plan.cwd)
    }; try { ${setup} & ${argv} } finally { foreach ($dvKey in $dvEnv.Keys) { [Environment]::SetEnvironmentVariable($dvKey, $dvEnv[$dvKey], 'Process') }; Pop-Location } }`;
  }
  return `(cd ${q(plan.cwd)} && ${
    env.length ? `env ${env.map(([k, v]) => q(`${k}=${v}`)).join(" ")} ` : ""
  }${argv})`;
}
