const cityCountryOnlyCandidateId = "427c4d75-1eb3-4d57-83c0-de054faad75a";

type CandidateLocation = {
  addressLine1: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  postalCode: string | null;
};

function fullLocation(candidate: CandidateLocation): string {
  return [
    candidate.addressLine1,
    candidate.city,
    candidate.province,
    candidate.country,
    candidate.postalCode,
  ].filter(Boolean).join(", ");
}

export function generationResumeLocation(candidateId: string, candidate: CandidateLocation): string {
  if (candidateId === cityCountryOnlyCandidateId) {
    return [candidate.city, candidate.country].filter(Boolean).join(", ");
  }
  return fullLocation(candidate);
}
