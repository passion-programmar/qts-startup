// Only the answer's shape: the saved prompt says how to fill each field. No job description: QTS
// saves the JD it sent, so the AI writing it back would only cost output tokens and time.
export const geminiJobEvaluationResponseSchema = {
  type: "OBJECT",
  properties: {
    isJobPage: { type: "BOOLEAN" },
    isRemote: { type: "BOOLEAN" },
    job: {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        company: { type: "STRING" },
        location: { type: "STRING" },
        employmentType: { type: "STRING" },
        workplaceType: { type: "STRING" },
        salary: { type: "STRING" },
        reason: { type: "STRING" },
      },
      required: [
        "title",
        "company",
        "location",
        "employmentType",
        "workplaceType",
        "salary",
        "reason",
      ],
    },
    matchingProfileIndexes: {
      type: "ARRAY",
      items: { type: "INTEGER" },
    },
  },
  required: [
    "isJobPage",
    "isRemote",
    "job",
    "matchingProfileIndexes",
  ],
} as const;

export const geminiJobEvaluationGenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: geminiJobEvaluationResponseSchema,
  temperature: 0.2,
} as const;

/** Groq can't be given a response schema, so it gets the same shape in words. */
export const groqJobEvaluationJsonHint =
  `Use exactly this JSON shape, with every required field: ${JSON.stringify(geminiJobEvaluationResponseSchema)}. ` +
  "Leave out job.description: QTS already has the job text.";

export function isGetJdEvaluationAccepted(decision: {
  isJobPage: boolean;
  isRemote: boolean;
}): boolean {
  return decision.isJobPage === true && decision.isRemote === true;
}
