// The main site a job was found on, for the Bids page: never a posting or application address.
// Get JD tries, in order: the page the job was opened from, a source tag in the job's link
// (?utm_source=linkedin), and the job's own site. Pure, so it is testable without a database.

const parse = (value: string | null | undefined): URL | null => {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
};

// Job boards: their site's domain (matched exactly, any country domain or subdomain), the name a
// source tag uses for them, and their main job address.
const BOARDS: { domain: RegExp; name: RegExp; url: string }[] = [
  { domain: /(?:^|\.)(?:linkedin\.com|lnkd\.in)$/, name: /linkedin|lnkd/, url: "https://www.linkedin.com/jobs" },
  { domain: /(?:^|\.)indeed\.[a-z.]+$/, name: /indeed/, url: "https://www.indeed.com" },
  { domain: /(?:^|\.)glassdoor\.[a-z.]+$/, name: /glassdoor/, url: "https://www.glassdoor.com" },
  { domain: /(?:^|\.)justjoin\.it$/, name: /justjoin/, url: "https://justjoin.it" },
  { domain: /(?:^|\.)nofluffjobs\.com$/, name: /nofluff/, url: "https://nofluffjobs.com" },
  { domain: /(?:^|\.)(?:wellfound\.com|angel\.co)$/, name: /wellfound|angellist/, url: "https://wellfound.com" },
  { domain: /(?:^|\.)(?:welcometothejungle\.com|otta\.com)$/, name: /^otta$|welcome ?to ?the ?jungle|wttj/, url: "https://www.welcometothejungle.com" },
  { domain: /(?:^|\.)remoteok\.(?:com|io)$/, name: /remoteok/, url: "https://remoteok.com" },
  { domain: /(?:^|\.)weworkremotely\.com$/, name: /weworkremotely/, url: "https://weworkremotely.com" },
  { domain: /(?:^|\.)xing\.com$/, name: /xing/, url: "https://www.xing.com/jobs" },
  { domain: /(?:^|\.)stepstone\.[a-z.]+$/, name: /stepstone/, url: "https://www.stepstone.de" },
  { domain: /(?:^|\.)pracuj\.pl$/, name: /pracuj/, url: "https://www.pracuj.pl" },
  { domain: /(?:^|\.)ejobs\.ro$/, name: /ejobs/, url: "https://www.ejobs.ro" },
  { domain: /(?:^|\.)bestjobs\.eu$/, name: /bestjobs/, url: "https://www.bestjobs.eu" },
  { domain: /(?:^|\.)hipo\.ro$/, name: /^hipo(?:\.ro)?$/, url: "https://www.hipo.ro" },
  { domain: /(?:^|\.)djinni\.co$/, name: /djinni/, url: "https://djinni.co" },
  { domain: /(?:^|\.)himalayas\.app$/, name: /himalayas/, url: "https://himalayas.app" },
  { domain: /(?:^|\.)(?:workatastartup\.com|news\.ycombinator\.com)$/, name: /ycombinator|hacker ?news|workatastartup/, url: "https://www.workatastartup.com" },
];

// Applicant-tracking sites that host one board per company in the first path part.
const COMPANY_PATH_HOSTS = /^(?:job-boards(?:\.eu)?\.greenhouse\.io|boards(?:\.eu)?\.greenhouse\.io|jobs(?:\.eu)?\.lever\.co|apply\.workable\.com|jobs\.ashbyhq\.com|jobs\.smartrecruiters\.com|careers\.smartrecruiters\.com|jobs\.jobvite\.com|ats\.rippling\.com|jobs\.gem\.com|app\.dover\.com)$/i;

/** A page's main site address: a known job board, a company's board on a job platform, or the site's own address. */
export function mainSiteUrl(value: string | null | undefined): string | null {
  const url = parse(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const board = BOARDS.find((entry) => entry.domain.test(host));
  if (board) return board.url;
  if (COMPANY_PATH_HOSTS.test(host)) {
    // Greenhouse's embedded form names the company in ?for= instead of the path.
    const company = url.pathname.split("/").filter(Boolean)[0] === "embed"
      ? url.searchParams.get("for")
      : url.pathname.split("/").filter(Boolean)[0];
    return company && /^[\w.-]+$/.test(company) ? `${url.origin}/${company}` : url.origin;
  }
  return url.origin;
}

const SOURCE_PARAMETERS = ["utm_source", "source", "src", "ref", "referrer", "lever-source", "lever-origin", "jobsource", "job_source", "s"];

/** A job board named in the job link's own source tag (?utm_source=linkedin), or null. */
export function sourceTagSite(jobUrl: string | null | undefined): string | null {
  const url = parse(jobUrl);
  if (!url) return null;
  for (const name of SOURCE_PARAMETERS) {
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase() !== name || !value) continue;
      const board = BOARDS.find((entry) => entry.name.test(value.toLowerCase()));
      if (board) return board.url;
    }
  }
  return null;
}

/** The job's source site: where it was opened from, else its link's source tag, else its own site. */
export function sourceSiteUrl(input: { openerUrl?: string | null; jobUrl: string }): string | null {
  return mainSiteUrl(input.openerUrl) ?? sourceTagSite(input.jobUrl) ?? mainSiteUrl(input.jobUrl);
}
