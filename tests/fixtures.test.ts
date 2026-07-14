import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCompetitionPage } from "../src/cli/parser";
import {
  GOLDEN_DIR,
  listSamples,
  loadSample,
  makeCompetition,
  sampleSlug,
} from "./helpers";

const UPDATE = process.env.UPDATE_GOLDEN === "1";

describe("golden fixtures from samples/", () => {
  const samples = listSamples();

  test.skipIf(samples.length > 0)("skipped: no local samples/ fixtures", () => {});

  for (const filename of samples) {
    const slug = sampleSlug(filename);

    test(slug, () => {
      const html = loadSample(filename);
      const { results, report } = parseCompetitionPage(
        html,
        makeCompetition({ id: slug }),
      );
      expect(report.confidence).toBe("ok");
      const actual = JSON.parse(JSON.stringify(results));

      const goldenPath = join(GOLDEN_DIR, `${slug}.json`);
      if (UPDATE || !existsSync(goldenPath)) {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(goldenPath, `${JSON.stringify(actual, null, 2)}\n`);
        if (!UPDATE) {
          throw new Error(
            `Golden file was missing and has been generated: ${goldenPath}. Review it, then re-run.`,
          );
        }
        return;
      }

      const golden = JSON.parse(readFileSync(goldenPath, "utf-8"));
      expect(actual).toEqual(golden);
    });
  }
});
