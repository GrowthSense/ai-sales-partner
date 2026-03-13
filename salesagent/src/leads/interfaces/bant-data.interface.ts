export interface BantData {
  budget?: string | null;       // e.g. "$10K-$50K/year"
  hasBudget?: boolean;
  authority?: string | null;    // e.g. "VP of Sales"
  isDecisionMaker?: boolean;
  need?: string | null;         // e.g. "automate lead qualification"
  needStrength?: 'low' | 'medium' | 'high';
  timeline?: string | null;     // e.g. "Q3 2026"
  hasTimeline?: boolean;
  notes?: string;               // raw notes from conversation
}
