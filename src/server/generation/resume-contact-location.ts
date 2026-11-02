type CandidateLocation = {
  addressLine1?: string | null;
  city: string | null;
  province?: string | null;
  country: string | null;
  postalCode?: string | null;
};

export function generationResumeLocation(candidate: CandidateLocation): string {
  return [candidate.city, candidate.country].filter(Boolean).join(", ");
}
