// Choices real application forms offered for questions Super Admin answers with reusable answers,
// collected from the Apply tests on 20 job sites. The Settings form shows them under an answer so
// it can be picked in the wording forms use. Matched by the question's words.

export type AnswerSuggestion = { test: RegExp; choices: string[]; seenOn: string };

export const ANSWER_SUGGESTIONS: AnswerSuggestion[] = [
  {
    test: /how did you (hear|find|learn)|where did you (hear|find)|referral source|^source$/i,
    choices: ["LinkedIn job post", "LinkedIn (including social posts and LinkedIn job)", "Job board", "Company website", "Social media", "Referral", "Recruiter"],
    seenOn: "GlobalLogic and others",
  },
  {
    test: /disability confident/i,
    choices: ["No, this isn't relevant", "Yes, I would like to be considered under this scheme"],
    seenOn: "Arden",
  },
  {
    test: /(previously|ever) (been )?(employed|worked)|worked (for|at) (us|this company)|currently (work|employed)/i,
    choices: ["No", "Yes", "No, I do not currently work for this company"],
    seenOn: "Lever (XTB), Greenhouse (Exadel), Arden",
  },
  {
    test: /employed or contracted|subsidiar/i,
    choices: ["No", "Yes - <company name>"],
    seenOn: "Greenhouse (Exadel)",
  },
  {
    test: /know anyone|current employee|discussed this role/i,
    choices: ["No", "Yes"],
    seenOn: "Ashby, Coherent",
  },
  {
    test: /referr/i,
    choices: ["No referral", "None"],
    seenOn: "Coherent",
  },
  {
    test: /salary align|align with your expectations|advertised salary/i,
    choices: ["Yes", "No"],
    seenOn: "Arden",
  },
  {
    // An amount; "Does the advertised salary align…?" is a yes/no question instead.
    test: /^(?!.*\balign).*(salary|desired pay|expected (pay|rate)|compensation|rate expectation)/i,
    choices: ["5000 EUR per month", "60000 EUR per year", "35 EUR per hour", "250 EUR per day"],
    seenOn: "BambooHR, Greenhouse, Lever, Workable, careers-page (amount + currency + period)",
  },
  {
    test: /communicat/i,
    choices: ["Email", "Phone", "SMS"],
    seenOn: "Elastic",
  },
  {
    test: /one of the following countries|located in one of|country of citizenship|permanent residency/i,
    choices: ["No", "Yes"],
    seenOn: "Elastic (a sanctions list: Belarus, Russia, Iran, North Korea…; Yes usually ends the application)",
  },
  {
    test: /collect and verify|authori[sz]ation to collect|verify (your )?documents/i,
    choices: ["Yes", "No"],
    seenOn: "Workable",
  },
  {
    test: /expiration date|expiry date/i,
    choices: ["N/A", "Not applicable"],
    seenOn: "Workable",
  },
  {
    test: /notice period|when can you start|earliest start|date available|available to start|start date/i,
    choices: ["Immediately", "1 week", "2 weeks", "1 month"],
    seenOn: "BambooHR, Lever (XTB), Traffit",
  },
  {
    test: /sponsor|\bvisa\b/i,
    choices: ["No", "Yes", "No, I don't need a visa nor work permit"],
    seenOn: "Elastic, Lever (XTB)",
  },
  {
    test: /authori[sz]ed to work|right to (live and )?work|eligible to work|work permit|unrestricted right/i,
    choices: [
      "Yes",
      "No",
      "Yes, I am a British citizen",
      "Yes, I have Indefinite Leave to Remain (ILR) or Settled Status",
      "Yes, I have another form of permanent right to work in the UK",
      "No, I require sponsorship to work in the UK",
      "No, I have time limited right to work in the UK",
    ],
    seenOn: "Arden, Lever (XTB), Greenhouse (Exadel), Rhythm, Elastic",
  },
  {
    test: /relocat/i,
    choices: ["Yes", "No"],
    seenOn: "common on Greenhouse and Lever forms",
  },
  {
    test: /employment type|type of employment|contract type|employment contract|model wsp[oó]łpracy/i,
    choices: ["Permanent", "Temporary", "Secondments", "Employment contract (UoP)", "B2B", "Remote", "Hybrid", "On-site"],
    seenOn: "HMRC, Lever (XTB), Traffit",
  },
  {
    test: /full[- ]?time|part[- ]?time|dost[eę]pno[sś][cć] czasow|working hours/i,
    choices: ["full-time", "part-time"],
    seenOn: "Traffit",
  },
  {
    test: /open to (new )?opportunit/i,
    choices: ["I'm actively looking for opportunities"],
    seenOn: "HMRC",
  },
  {
    test: /area of interest/i,
    choices: ["Actuary", "Digital, Data and Technology"],
    seenOn: "HMRC",
  },
  {
    test: /regional cent(re|er)|preferred (office|location|centre|center)/i,
    choices: ["Belfast Erskine House / Carne House"],
    seenOn: "HMRC",
  },
  {
    test: /hybrid|remote working model|acknowledge/i,
    choices: ["I acknowledge this statement", "I acknowledge"],
    seenOn: "Arden, Elastic",
  },
  {
    test: /polish|english|language/i,
    choices: ["Beginner (A1 - A2)", "Intermediate (B1 - B2)", "Advanced (C1 - C2)", "A1", "A2", "B1", "B2", "C1", "C2"],
    seenOn: "Lever (XTB), Traffit",
  },
];

/** The suggestions for a question: every catalogue entry its words match, choices merged. */
export function suggestionsFor(question: string): { choices: string[]; seenOn: string } | null {
  const matches = ANSWER_SUGGESTIONS.filter((entry) => entry.test.test(question));
  if (!matches.length) return null;
  return {
    choices: [...new Set(matches.flatMap((entry) => entry.choices))],
    seenOn: matches.map((entry) => entry.seenOn).join("; "),
  };
}
