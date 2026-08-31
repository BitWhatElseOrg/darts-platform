import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const workerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(workerDirectory, "tsconfig.build.json");

function parseBuildConfig(): ts.ParsedCommandLine {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);

  if (configFile.error !== undefined) {
    throw new Error(
      ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"),
    );
  }

  return ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    workerDirectory,
    undefined,
    configPath,
  );
}

describe("worker build module format", () => {
  it("uses NodeNext for ESM-compatible JavaScript output", () => {
    const config = parseBuildConfig();

    expect(config.errors).toEqual([]);
    expect(config.options.module).toBe(ts.ModuleKind.NodeNext);
    expect(config.options.moduleResolution).toBe(
      ts.ModuleResolutionKind.NodeNext,
    );
  });

  it("excludes test sources from the production build", () => {
    const config = parseBuildConfig();

    expect(
      config.fileNames.some((fileName) => fileName.endsWith(".spec.ts")),
    ).toBe(false);
  });
});
