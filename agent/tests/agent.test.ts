import { describe, expect, it } from 'bun:test';

import type { Question } from '@/src/types/dataset';

import app from '@/src/index';
import dataset from '@/tests/dataset.json' with { type: 'json' };
import { validateAnswer } from '@/tests/validation';

const selectRandomQuestions = (n: number): Question[] => {
  const shuffled = [...dataset].toSorted(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
};

describe(``, () => {
  it(`should pass 3 out of 5 random questions`, async () => {
    console.log(`Running accuracy test.`);
    const questions = selectRandomQuestions(5);
    const results: boolean[] = [];

    for (const question of questions) {
      try {
        let enhancedPrompt = question.Prompt;
        if (question.wiki_links && question.wiki_links.length > 0) {
          const linksText = question.wiki_links
            .map((link) => `- ${link}`)
            .join(`\n`);
          enhancedPrompt = `${question.Prompt}\n\nRelevant Wikipedia articles:\n${linksText}`;
        }

        const response = await app.handle(
          new Request(`http://localhost/agent/answer`, {
            body: JSON.stringify({ question: enhancedPrompt }),
            headers: {
              'Content-Type': `application/json`,
            },
            method: `POST`,
          }),
        );

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = (await response.json()) as { answer: string };
        const agentAnswer = data.answer;

        const isValid = await validateAnswer(
          agentAnswer,
          question.Answer,
          question.Prompt,
        );

        results.push(isValid.is_correct);
        console.log(
          `Question: ${enhancedPrompt}\n` +
            `Expected: ${question.Answer}\n` +
            `Agent: ${agentAnswer}\n` +
            `Valid: ${isValid.is_correct}\n`,
          `Reasoning: ${isValid.reason}\n`,
        );
      } catch (error) {
        console.error(`Error processing question:`, error);
        results.push(false);
      }
    }

    const passedCount = results.filter(Boolean).length;
    const passed = passedCount >= 3;

    console.log(`\nTest Results: ${passedCount}/5 questions passed.`);

    expect(passed).toBe(true);
  }, 300_000);

  it(`should be faster when using scheduler`, async () => {
    console.log(`Running speed test.`);
    const questionCount = 3;
    const questions = selectRandomQuestions(questionCount);
    const results: number[][] = [];

    for (const question of questions) {
      let scheduler = true;
      const thisResults: number[] = [];
      for (let i = 0; i < 2; i++) {
        try {
          let enhancedPrompt = question.Prompt;
          if (question.wiki_links && question.wiki_links.length > 0) {
            const linksText = question.wiki_links
              .map((link) => `- ${link}`)
              .join(`\n`);
            enhancedPrompt = `${question.Prompt}\n\nRelevant Wikipedia articles:\n${linksText}`;
          }

          const pre = performance.now();
          const response = await app.handle(
            new Request(`http://localhost/agent/answer`, {
              body: JSON.stringify({
                question: enhancedPrompt,
                scheduler: scheduler,
              }),
              headers: {
                'Content-Type': `application/json`,
              },
              method: `POST`,
            }),
          );
          const post = performance.now();

          scheduler = !scheduler;
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const data = (await response.json()) as { answer: string };
          const agentAnswer = data.answer;

          const isValid = await validateAnswer(
            agentAnswer,
            question.Answer,
            question.Prompt,
          );

          thisResults.push(post - pre);
          console.log(
            `Question: ${enhancedPrompt}\n`,
            `Expected: ${question.Answer}\n`,
            `Agent: ${agentAnswer}\n`,
            `Valid: ${isValid.is_correct}\n`,
            `Reasoning: ${isValid.reason}\n`,
          );
        } catch (error) {
          console.error(`Error processing question:`, error);
          thisResults.push(-1);
        }
      }
      results.push(thisResults);
    }

    const passedCount = results.filter(
      (result) => result[0] < result[1],
    ).length;

    const avgScheduler =
      results.reduce(
        (accumulator, currentValue) => accumulator + currentValue[0],
        0,
      ) / results.length;

    const avgNonScheduler =
      results.reduce(
        (accumulator, currentValue) => accumulator + currentValue[1],
        0,
      ) / results.length;

    const avgDifference = avgScheduler - avgNonScheduler;

    const passed = passedCount / questionCount > 0.5 || avgDifference < 0;
    const fasterOrSlower = avgDifference < 0 ? `faster` : `slower`;

    const percentage = (
      (Math.abs(avgDifference) / avgNonScheduler) *
      100
    ).toFixed(2);

    console.log(
      `\n${passedCount}/${questionCount} runs were faster when using the scheduler.`,
      `\nOn average, the runs using the scheduler were ${Math.abs(avgDifference)}ms ${fasterOrSlower} (${percentage}% ${fasterOrSlower}) than runs without the scheduler.`,
      `\nTest Results (Scheduler, Non-Scheduler):`,
    );

    results.forEach((result) => console.log(`${result[0]}, ${result[1]}`));

    expect(passed).toBe(true);
  }, 900_000);
});
