import { type } from 'arktype';

export const QuestionSchema = type({
  Answer: `string`,
  Prompt: `string`,
  reasoning_types: `string`,
  wiki_links: `string[]`,
});

export type Question = typeof QuestionSchema.infer;

export const TestResultSchema = type({
  agentAnswer: `string`,
  expectedAnswer: `string`,
  isValid: `boolean`,
  question: QuestionSchema,
});

export type TestResult = typeof TestResultSchema.infer;

export const ValidationRequestSchema = type({
  agentAnswer: `string`,
  expectedAnswer: `string`,
  question: `string`,
});

export type ValidationRequest = typeof ValidationRequestSchema.infer;

export const ValidationResponseSchema = type({
  isValid: `boolean`,
  reasoning: `string`,
  score: `number`,
});

export type ValidationResponse = typeof ValidationResponseSchema.infer;
