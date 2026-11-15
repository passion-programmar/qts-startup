// The answer has no job description: QTS saves the JD it sent, so the AI writing it back would only
// cost output tokens and time (and long JDs could cut the answer off).
export const geminiJobEvaluationResponseSchema = {
  type: "OBJECT",
  properties: {
    isJobPage: { type: "BOOLEAN" },
    isRemote: { type: "BOOLEAN" },
    job: {
      type: "OBJECT",
      properties: {
        // QTS saves the job under these, so they are read from the JD, not from anywhere else.
        title: { type: "STRING", description: "The job title, as written in the job description" },
        company: { type: "STRING", description: "The hiring company's name, as written in the job description" },
        location: { type: "STRING", description: "City, region and country as written in the posting" },
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
