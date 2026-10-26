// A candidate's own answers to diversity (EEO) questions, kept on their profile. The keys are stored;
// the labels are what the profile form shows and what ChatGPT reads. Apply maps each key to the
// wording a form uses ("woman" → "Female", "prefer_not_to_say" → "Decline to self-identify").

export const DIVERSITY_FIELDS = [
  {
    name: "gender",
    label: "Gender",
    options: [
      ["man", "Male"],
      ["woman", "Female"],
      ["non_binary", "Non-binary"],
      ["prefer_not_to_say", "Decline to self-identify"],
    ],
  },
  {
    name: "ethnicity",
    label: "Race / Ethnicity",
    options: [
      ["hispanic_or_latino", "Hispanic or Latino"],
      ["white", "White (Not Hispanic or Latino)"],
      ["black", "Black or African American"],
      ["asian", "Asian"],
      ["pacific_islander", "Native Hawaiian or Other Pacific Islander"],
      ["american_indian", "American Indian or Alaska Native"],
      ["two_or_more", "Two or More Races"],
      ["prefer_not_to_say", "Decline to self-identify"],
    ],
  },
  {
    name: "veteranStatus",
    label: "Veteran status",
    options: [
      ["not_veteran", "I am not a protected veteran"],
      ["protected_veteran", "I identify as one or more of the classifications of protected veteran"],
      ["prefer_not_to_say", "I don't wish to answer"],
    ],
  },
  {
    name: "disabilityStatus",
    label: "Disability status",
    options: [
      ["no", "No, I do not have a disability and have not had one in the past"],
      ["yes", "Yes, I have a disability (or previously had a disability)"],
      ["prefer_not_to_say", "I do not want to answer"],
    ],
  },
  {
    name: "sexualOrientation",
    label: "Sexual orientation",
    options: [
      ["heterosexual", "Heterosexual / Straight"],
      ["gay_or_lesbian", "Gay or Lesbian"],
      ["bisexual", "Bisexual"],
      ["queer", "Queer"],
      ["asexual", "Asexual"],
      ["prefer_not_to_say", "I prefer not to say"],
    ],
  },
  {
    name: "pronouns",
    label: "Pronouns",
    options: [
      ["he_him", "He / him"],
      ["she_her", "She / her"],
      ["they_them", "They / them"],
      ["prefer_not_to_say", "Prefer not to say"],
    ],
  },
] as const;

export type DiversityFieldName = (typeof DIVERSITY_FIELDS)[number]["name"];

export function diversityLabel(name: DiversityFieldName, value: string | null): string | null {
  const field = DIVERSITY_FIELDS.find((entry) => entry.name === name);
  return (field?.options as readonly (readonly [string, string])[] | undefined)?.find(([key]) => key === value)?.[1] ?? null;
}
