import OpenAI from 'openai';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = `https://openrouter.ai/api/v1`;
const OPENROUTER_MODEL = `openai/gpt-oss-120b:nitro`;

const openai = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: OPENROUTER_BASE_URL,
});

export type ValidationResult = {
  is_correct: boolean;
  reason: string;
};

export const validateAnswer = async (
  agentAnswer: string,
  expectedAnswer: string,
  question: string,
): Promise<ValidationResult> => {
  const prompt = `
You are an expert answer validator. Your sole purpose is to compare a "Model Prediction" against a provided "Ground Truth" and determine if they match.

*** CRITICAL INSTRUCTION ***
The "Ground Truth" provided to you is the ABSOLUTE TRUTH. Do not use your own knowledge to evaluate the question. If the Ground Truth says "France" and the Model Prediction says "Argentina", the Model Prediction is WRONG, regardless of the reasoning.

Input Data:
Question: ${question}
Ground Truth: ${expectedAnswer}
Model Prediction: ${agentAnswer}

Validation Steps:
1. **Extract the Core Answer:** Scan the "Model Prediction" for the final conclusion. Ignore the "step-by-step" or "showing work" (e.g., "1887 - 1800 = 87"). Focus only on the final derived value or entity.
2. **Compare Entities:**
   - If the Ground Truth is a number (e.g., "87"), check if the Model's final derived number matches. "87 years" is equal to "87".
   - If the Ground Truth is a Proper Noun (e.g., "France"), the Model MUST output "France". "Argentina" is incorrect.
3. **Assess Equivalence:**
   - **Numerical Precision:** Allow for minor rounding *only if* the context implies it (e.g. population counts). Exact dates and integer calculations (like years) must be exact.
   - **Semantic Equivalence:** If the question asks for to identify who discovered Zirconium and the ground truth is "Zirconium was discovered by Martin Heinrich Klaproth", the answer "**Martin Heinrich Klaproth**" is still correct even though it did not explicity say that he **discovered Zirconium** 
     - Example:
       Question: "I have an element in mind and would like you to identify the person it was named after. Here's a clue: The element's atomic number is 9 higher than that of an element discovered by the scientist who discovered Zirconium in the same year."
       Base Truth: "Mendelevium is named after Dmitri Mendeleev."
       Model Prediction: "Okay, let's break this down step by step to identify the person the element was named after.\n\n1.  **Identify the element discovered by the scientist who discovered Zirconium in 1789:**\n\n    *   From the Zirconium article and the Klaproth article, Martin Heinrich Klaproth discovered Zirconium in 1789.\n    *   The Klaproth article also states that he discovered Uranium in 1789.\n\n2.  **Find the atomic number of Uranium:**\n\n    *   From the Periodic Table article, Uranium (U) has an atomic number of 92.\n\n3.  **Calculate the atomic number of the target element:**\n\n    *   The target element has an atomic number 9 higher than that of Uranium: 92 + 9 = 101\n\n4.  **Identify the element with the calculated atomic number:**\n\n    *   From the Periodic Table article, the element with atomic number 101 is Mendelevium (Md).\n\n5.  **Determine who Mendelevium was named after:**\n\n    *   From the Mendelevium article, it is named after Dmitri Mendeleev.\n\nTherefore, the element in mind was named after **Dmitri Mendeleev**."
       Incorrect Output: {
         "is_correct": false,
         "reason": "The model's prediction does not match the Ground Truth. The Ground Truth states that the element was named after Dmitri Mendeleev, but the model's prediction says that the element was named after Dmitri Mendeleev, which seems correct at first, but it does not accurately represent the ground truth's intent."
       }
       Correct Output: {
         "is_correct": true,
         "reason": "It is implied that the model's prediction, **Dmitri Mendeleev**, is what Mendelevium is named after."
       }

Evaluation Rules:
- **False Positives (Strictness):** If the model's reasoning is sound but arrives at a different final entity than the Ground Truth (e.g., Model says "Argentina" vs GT "France"), marks as FALSE.
- **False Negatives (Lenience):** Do not penalize the model for being verbose. If the correct answer (e.g., "87") is present as the conclusion of a long sentence, mark as TRUE.

Output Format:
You must output a single valid JSON object:
{
  "is_correct": boolean,
  "reason": "Concise explanation of the comparison."
}

Important Note: The model that is making predictions is instructed to bold ONLY the final answer (**<answer>**).
Base your judgement on the correctness solely on what is in the bolded section (**<answer>**) of the model prediction.

Example:
Question: "If my future wife has the same first name as the 15th first lady of the United States' mother and her surname is the same as the second assassinated president's mother's maiden name, what is my future wife's name?",
Model Prediction: "The 15th first lady of the United States was Harriet Lane. Her mother's name was Jane Ann Buchanan.\nThe second assassinated president was James A. Garfield. His mother's maiden name was Eliza Ballou.\n\nTherefore, your future wife's name is **Jane Ballou**."

Incorrect Output: {
  "is_correct": false,
  "reason": "The model's prediction does not match the Ground Truth. The Ground Truth states that the surname of the future wife is 'Ballou', but the model's prediction says to look at the mother's maiden name of the second assassinated president, which is 'Eliza Ballou', but the context indicates that we are looking for the surname of the future wife. The correct model prediction should be '*Jane Ballou*', but instead, it mentions Jane Ann Buchanan's name."
}
Reasoning: The answer clearly has Jane Ballou bolded ("**Jane Ballou**"). Things outside of this bolded section are not relevant to the answer.

Correct Output: {
  "is_correct": true,
  "reason": "The model's prediction, **Jane Ballou**, exactly matches the Ground Truth, indicating that the model correctly derived the final answer."
}
`;

  const validationSchema = {
    additionalProperties: false,
    properties: {
      is_correct: {
        description: `Whether the agent's answer is correct.`,
        type: `boolean`,
      },
      reason: {
        description: `A short explanation of why the prediction matches or does not match the ground truth.`,
        type: `string`,
      },
    },
    required: [`is_correct`, `reason`],
    type: `object`,
  };

  try {
    const response = await openai.chat.completions.create({
      messages: [{ content: prompt, role: `user` }],
      model: OPENROUTER_MODEL,
      response_format: {
        json_schema: {
          name: `validation_response`,
          schema: validationSchema,
          strict: true,
        },
        type: `json_schema`,
      },
      stream: false,
    });

    const result = JSON.parse(
      response.choices[0].message.content ??
        `{ "is_correct": false, "reason": "" }`,
    ) as {
      is_correct: boolean;
      reason: string;
    };

    console.log(`Is Correct: ${result.is_correct}\nReason: ${result.reason}`);

    return result;
  } catch (error) {
    console.error(
      `Error validating answer with OpenRouter:`,
      JSON.stringify(error),
    );
    return { is_correct: false, reason: `Error with the OpenRouter API` };
  }
};
