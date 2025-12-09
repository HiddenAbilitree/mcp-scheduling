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
      message: `Select a benchmark result file to summarize:`,
    });

    const filePath = path.join(resultsDir, selectedFile);
    const fileContent = await readFile(filePath, `utf-8`);
    const data = JSON.parse(fileContent) as BenchmarkItem[];

    if (!Array.isArray(data) || data.length === 0) {
      console.log(`Selected file contains no data or invalid format.`);
      return;
    }

    let schedulerCorrectCount = 0;
    let noSchedulerCorrectCount = 0;
    let schedulerTotalTime = 0;
    let noSchedulerTotalTime = 0;

    const count = data.length;

    for (const item of data) {
      if (item.scheduler.isValid.is_correct) schedulerCorrectCount++;
      if (item.noScheduler.isValid.is_correct) noSchedulerCorrectCount++;

      schedulerTotalTime += item.scheduler.timeMs;
      noSchedulerTotalTime += item.noScheduler.timeMs;
    }

    const schedulerAccuracy = (schedulerCorrectCount / count) * 100;
    const noSchedulerAccuracy = (noSchedulerCorrectCount / count) * 100;

    const avgSchedulerTime = schedulerTotalTime / count;
    const avgNoSchedulerTime = noSchedulerTotalTime / count;

    const timeDifference = avgNoSchedulerTime - avgSchedulerTime;
    const percentDifference = (timeDifference / avgNoSchedulerTime) * 100;

    console.log(`\n--- Summary for ${selectedFile} ---`);
    console.log(`Total Questions: ${count}`);

    console.log(`\nAccuracy:`);
    console.log(
      `  Scheduler:    ${schedulerAccuracy.toFixed(2)}% (${schedulerCorrectCount}/${count})`,
    );
    console.log(
      `  No Scheduler: ${noSchedulerAccuracy.toFixed(2)}% (${noSchedulerCorrectCount}/${count})`,
    );

    console.log(`\nAverage Execution Time:`);
    console.log(`  Scheduler:    ${avgSchedulerTime.toFixed(2)} ms`);
    console.log(`  No Scheduler: ${avgNoSchedulerTime.toFixed(2)} ms`);

    console.log(`\nComparison:`);
    if (timeDifference > 0) {
      console.log(
        `  Scheduler was FASTER by ${timeDifference.toFixed(2)} ms (${Math.abs(percentDifference).toFixed(2)}%)`,
      );
    } else {
      console.log(
        `  Scheduler was SLOWER by ${Math.abs(timeDifference).toFixed(2)} ms (${Math.abs(percentDifference).toFixed(2)}%)`,
      );
    }
    console.log(`-----------------------------------\n`);
  } catch {
    /**/
  }
};

await main();
