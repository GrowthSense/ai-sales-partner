// Computes a 0-100 lead score from BANT qualification data.
//
// score(data: BantData): number
//   budget:    0|25  (has budget or not)
//   authority: 0|25  (is decision maker)
//   need:      0|25  (clear pain point identified)
//   timeline:  0|25  (has timeline)
//
// isQualified(score): boolean  ← score >= 50 = qualified
export class QualificationService {}
