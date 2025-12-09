import { select } from '@inquirer/prompts';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

interface BenchmarkItem {
  noScheduler: Result;
  question: string;
  scheduler: Result;
}

interface Result {
  answer: string;
  isValid: {
    is_correct: boolean;
    reason: string;
  };
  timeMs: number;
}

const main = async () => {
  try {
    const resultsDir = path.join(process.cwd(), `benchmark-results`);

    const files = await readdir(resultsDir);
    const jsonFiles = files.filter((file) => file.endsWith(`.json`));

    if (jsonFiles.length === 0) {
      console.log(`No benchmark result files found in benchmark-results/`);
      return;
    }

    const selectedFile = await select({
      choices: jsonFiles
        .toSorted()
        .toReversed()
        .map((file) => ({
          name: file,
          value: file,
        })),
      loop: false,
      message: `Select a benchmark result file to process:`,
    });

    const filePath = path.join(resultsDir, selectedFile);
    const fileContent = await readFile(filePath, `utf-8`);
    const data = JSON.parse(fileContent) as BenchmarkItem[];

    if (!Array.isArray(data) || data.length === 0) {
      console.log(`Selected file contains no data or invalid format.`);
      return;
    }

    const results = data.map(
      (item) =>
        `(${item.scheduler.isValid.is_correct},${item.noScheduler.isValid.is_correct})`,
    );
    console.log(`(${results.join(`,`)})`);
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
  }
};

await main();
