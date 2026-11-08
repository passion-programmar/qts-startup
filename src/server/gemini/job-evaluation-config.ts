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
        description: { type: "STRING" },
        location: { type: "STRING", description: "City, region and country as written in the posting" },
        employmentType: { type: "STRING" },
        workplaceType: { type: "STRING" },
        salary: { type: "STRING" },
        jobUrl: { type: "STRING" },
        reason: { type: "STRING" },
      },
      required: [
        "title",
        "company",
        "description",
        "location",
        "employmentType",
        "workplaceType",
        "salary",
        "jobUrl",
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
  "Keep job.description to one short sentence.";

export function isGetJdEvaluationAccepted(decision: {
  isJobPage: boolean;
  isRemote: boolean;
}): boolean {
  return decision.isJobPage === true && decision.isRemote === true;
}
