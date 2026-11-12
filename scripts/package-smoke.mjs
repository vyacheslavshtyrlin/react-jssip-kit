import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("Run the smoke test through npm: npm run package:smoke");
}
const temporaryRoot = mkdtempSync(join(tmpdir(), "react-jssip-kit-smoke-"));
const consumerDirectory = join(temporaryRoot, "consumer");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

function write(relativePath, contents) {
  writeFileSync(join(consumerDirectory, relativePath), contents, "utf8");
}

function runNpm(args, options = {}) {
  return run(process.execPath, [npmCli, ...args], options);
}

try {
  mkdirSync(consumerDirectory, { recursive: true });

  const packOutput = runNpm([
    "pack",
    "--json",
    "--workspace=react-jssip-kit",
    `--pack-destination=${temporaryRoot}`,
  ]);
  const packResult = JSON.parse(packOutput);
  const filename = packResult[0]?.filename;
  if (!filename) throw new Error("npm pack did not return a package filename");
  const packageArchive = join(temporaryRoot, filename);

  write(
    "package.json",
    JSON.stringify({ name: "package-smoke-consumer", private: true }, null, 2),
  );
  runNpm(
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", packageArchive],
    { cwd: consumerDirectory },
  );

  write(
    "esm-smoke.mjs",
    `import { SipProvider, createSipKernel } from "react-jssip-kit";

if (typeof createSipKernel !== "function" || typeof SipProvider !== "function") {
  throw new Error("react-jssip-kit ESM exports are invalid");
}
`,
  );
  write(
    "cjs-smoke.cjs",
    `const { SipProvider, createSipKernel } = require("react-jssip-kit");

if (typeof createSipKernel !== "function" || typeof SipProvider !== "function") {
  throw new Error("react-jssip-kit CommonJS exports are invalid");
}
`,
  );
  write(
    "types-smoke.ts",
    `import {
  SipStatus,
  createSipKernel,
  type SipKernel,
  type SipState,
} from "react-jssip-kit";

const factory: () => SipKernel = createSipKernel;
const state: SipState = {
  sipStatus: SipStatus.Disconnected,
  error: null,
  sessions: [],
};

void factory;
void state;
`,
  );
  write(
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2020",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["types-smoke.ts"],
      },
      null,
      2,
    ),
  );

  run(process.execPath, [join(consumerDirectory, "esm-smoke.mjs")], {
    cwd: consumerDirectory,
  });
  run(process.execPath, [join(consumerDirectory, "cjs-smoke.cjs")], {
    cwd: consumerDirectory,
  });
  run(
    process.execPath,
    [
      join(repositoryRoot, "node_modules", "typescript", "bin", "tsc"),
      "--project",
      join(consumerDirectory, "tsconfig.json"),
    ],
    { cwd: consumerDirectory },
  );

  console.log("Package smoke test passed: ESM, CommonJS, and TypeScript");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
