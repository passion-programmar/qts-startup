import { SignJWT, jwtVerify } from "jose";
import { normalizeJobKeyUrl } from "@/server/jobs/job-key";
import type { GetJdIdentity } from "./global-precheck";

export function createPrecheckTickets(secret: Uint8Array) {
  return {
    async issue(managerId: string, job: GetJdIdentity) {
      return new SignJWT({ job }).setProtectedHeader({ alg: "HS256" })
        .setIssuer("qts-get-jd-precheck").setAudience("qts-get-jd-evaluation")
        .setSubject(managerId).setIssuedAt().setExpirationTime("10m").sign(secret);
    },
    async verify(token: string, managerId: string, pageUrl: string): Promise<GetJdIdentity | null> {
      try {
        const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"], issuer: "qts-get-jd-precheck", audience: "qts-get-jd-evaluation" });
        const job = payload.job as GetJdIdentity | undefined;
        if (payload.sub !== managerId || !job || normalizeJobKeyUrl(job.jobUrl) !== normalizeJobKeyUrl(pageUrl)) return null;
        return job;
      } catch { return null; }
    },
  };
}

export function getPrecheckTickets() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) throw new Error("AUTH_SECRET must contain at least 32 bytes.");
  return createPrecheckTickets(new TextEncoder().encode(secret));
}
