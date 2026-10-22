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
        country: { type: "STRING" },
        employmentType: { type: "STRING" },
        workplaceType: { type: "STRING" },
        salary: { type: "STRING" },
        jobUrl: { type: "STRING" },
      },
      required: [
        "title",
        "company",
        "location",
        "country",
        "employmentType",
        "workplaceType",
        "salary",
        "jobUrl",
      ],
    },
    matchingProfileIds: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
  },
  required: ["isJobPage", "isRemote", "job", "matchingProfileIds"],
} as const;

export const geminiJobEvaluationGenerationConfig = {
  responseMimeType: "application/json",
  responseSchema: geminiJobEvaluationResponseSchema,
  temperature: 0.2,
} as const;
