import { mkdirSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';

import app from '@/src/index';
import dataset from '@/tests/dataset.json' with { type: 'json' };
import { validateAnswer, ValidationResult } from '@/tests/validation';

interface BenchmarkResult {
  noScheduler: {
    answer: string;
    isValid: ValidationResult;
    timeMs: number;
  };
  question: string;
  scheduler: {
    answer: string;
    isValid: ValidationResult;
    timeMs: number;
  };
}

const CONCURRENCY_LIMIT = 12;

const pad2 = (n: number) => pad(n, 2);
const pad = (n: number, m: number) => n.toString().padStart(m, `0`);

const runSingleRequest = async (
  enhancedPrompt: string,
  useScheduler: boolean,
  originalAnswer: string,
  originalQuestion: string,
) => {
  try {
    const start = performance.now();
    const response = await app.handle(
      new Request(`http://localhost/agent/answer`, {
        body: JSON.stringify({
          question: enhancedPrompt,
          scheduler: useScheduler,
        }),
        headers: { 'Content-Type': `application/json` },
        method: `POST`,
      }),
    );
    const end = performance.now();

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as { answer: string };
    const isValid = await validateAnswer(
      data.answer,
      originalAnswer,
      originalQuestion,
    );

    return {
      answer: data.answer,
      isValid,
      timeMs: end - start,
    };
  } catch {
    return {
      answer: `ERROR`,
      isValid: { is_correct: false, reason: `Error` } as ValidationResult,
      timeMs: 0,
    };
  }
};
const runBenchmark = async () => {
  const outputDir = `benchmark-results`;
  const files = await readdir(outputDir);
  try {
    mkdirSync(outputDir, { recursive: true });
  } catch {
    /**/
  }

  const now = new Date();
  const timestamp = `${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}-${now.getFullYear()}`;
  const outputFile = `${outputDir}/${pad(
    files.filter((file) => file.endsWith(`.json`)).length,
    5,
  )}-${timestamp}.json`;

  console.log(
    `Starting benchmark with concurrency ${CONCURRENCY_LIMIT}. Output file: ${outputFile}`,
  );

  const results: BenchmarkResult[] = [];
  const questions = dataset;

  let totalProcessed = 0;
  let schedulerCorrect = 0;
  let noSchedulerCorrect = 0;
  let schedulerTotalTime = 0;
  let noSchedulerTotalTime = 0;

  const processQuestion = async (question: (typeof dataset)[0]) => {
    let enhancedPrompt = question.Prompt;
    if (question.wiki_links && question.wiki_links.length > 0) {
      const linksText = question.wiki_links
        .map((link) => `- ${link}`)
        .join(`\n`);
      enhancedPrompt = `${question.Prompt}\n\nRelevant Wikipedia articles:\n${linksText}`;
    }

    const [schedulerResult, noSchedulerResult] = await Promise.all([
      runSingleRequest(enhancedPrompt, true, question.Answer, question.Prompt),
      runSingleRequest(enhancedPrompt, false, question.Answer, question.Prompt),
    ]);

    const resultEntry: BenchmarkResult = {
      noScheduler: noSchedulerResult,
      question: question.Prompt,
      scheduler: schedulerResult,
    };

    results.push(resultEntry);

    totalProcessed++;

    schedulerTotalTime += schedulerResult.timeMs;
    if (schedulerResult.isValid.is_correct) schedulerCorrect++;

    noSchedulerTotalTime += noSchedulerResult.timeMs;
    if (noSchedulerResult.isValid.is_correct) noSchedulerCorrect++;

    writeFileSync(outputFile, JSON.stringify(results, undefined, 2));

    const schedAccuracy = ((schedulerCorrect / totalProcessed) * 100).toFixed(
      2,
    );
    const noSchedAccuracy = (
      (noSchedulerCorrect / totalProcessed) *
      100
    ).toFixed(2);

    const avgSchedTime = schedulerTotalTime / totalProcessed;
    const avgNoSchedTime = noSchedulerTotalTime / totalProcessed;

    const diff = avgSchedTime - avgNoSchedTime;
    const fasterOrSlower = diff < 0 ? `faster` : `slower`;
    const percentDiff =
      avgNoSchedTime > 0 ?
        ((Math.abs(diff) / avgNoSchedTime) * 100).toFixed(2)
      : `0.00`;

    if (totalProcessed % 5 === 0 || totalProcessed === questions.length) {
      console.clear();
      console.log(`=== LIVE BENCHMARK METRICS ===`);
      console.log(`Processed: ${totalProcessed}/${questions.length}\n`);
      console.log(`Accuracy with scheduler: ${schedAccuracy}%`);
      console.log(`Accuracy without scheduler: ${noSchedAccuracy}%\n`);
      console.log(`Avg Time (Scheduler): ${avgSchedTime.toFixed(2)}ms`);
      console.log(`Avg Time (No Scheduler): ${avgNoSchedTime.toFixed(2)}ms`);
      console.log(
        `Difference: ${Math.abs(diff).toFixed(2)}ms (${percentDiff}% ${fasterOrSlower} with scheduler)`,
      );
    }
  };

  const workers = Array.from({ length: CONCURRENCY_LIMIT })
    .fill(null)
    .map(async () => {
      while (questions.length > 0) {
        const question = questions.shift();
        if (question) {
          await processQuestion(question);
        }
      }
    });

  await Promise.all(workers);
};

await runBenchmark();
