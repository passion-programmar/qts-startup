export type PdfPageSlice = {
  sourceStartMm: number;
  sourceEndMm: number;
};

export type PdfBreakConstraint = {
  startMm: number;
  endMm: number;
};

export function paginatePdfCanvas(
  totalHeightMm: number,
  pageHeightMm: number,
  marginTopMm: number,
  marginBottomMm: number,
  breakConstraints: readonly PdfBreakConstraint[],
): PdfPageSlice[] {
  const contentHeightMm = pageHeightMm - marginTopMm - marginBottomMm;
  if (
    !Number.isFinite(totalHeightMm)
    || totalHeightMm <= 0
    || !Number.isFinite(pageHeightMm)
    || pageHeightMm <= 0
    || !Number.isFinite(marginTopMm)
    || marginTopMm < 0
    || !Number.isFinite(marginBottomMm)
    || marginBottomMm < 0
    || contentHeightMm <= 0
  ) {
    throw new Error("The preview has invalid page dimensions or margins.");
  }

  const slices: PdfPageSlice[] = [];
  let sourceStartMm = 0;
  while (sourceStartMm < totalHeightMm - 0.01) {
    if (slices.length >= 1000) {
      throw new Error("The preview exceeds the supported PDF page count.");
    }
    const nominalEndMm = slices.length === 0
      ? pageHeightMm - marginBottomMm
      : sourceStartMm + contentHeightMm;
    let sourceEndMm = Math.min(nominalEndMm, totalHeightMm);

    if (sourceEndMm < totalHeightMm) {
      const constraint = breakConstraints.find((candidate) =>
        candidate.startMm > sourceStartMm + 0.01
        && candidate.startMm < sourceEndMm
        && candidate.endMm > sourceEndMm,
      );
      if (constraint) sourceEndMm = constraint.startMm;
    }

    if (sourceEndMm <= sourceStartMm + 0.01) {
      sourceEndMm = Math.min(nominalEndMm, totalHeightMm);
    }
    slices.push({ sourceStartMm, sourceEndMm });
    sourceStartMm = sourceEndMm;
  }

  return slices;
}
