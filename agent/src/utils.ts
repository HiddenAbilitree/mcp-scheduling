export const cleanString = (input: string): string =>
  input.replaceAll(/[^a-zA-Z0-9_-]/g, ``);
