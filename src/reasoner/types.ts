import { z } from 'zod';

// Zod schemas for validating LLM responses

export const DiscoveredStateSchema = z.object({
  className: z.string(),
  methodName: z.string(),
  state: z.string(),
  isTested: z.boolean(),
  riskIfUntested: z.enum(['low', 'medium', 'high']),
  confidence: z.number().min(0).max(1),
});

export const AssertionJudgmentSchema = z.object({
  testName: z.string(),
  quality: z.enum(['weak', 'medium', 'strong']),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

export const CriticalityRatingSchema = z.object({
  className: z.string(),
  methodName: z.string(),
  criticality: z.enum(['low', 'medium', 'high']),
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

export const TransitiveInferenceSchema = z.object({
  from: z.string(),
  through: z.string(),
  to: z.string(),
  coveredTransitively: z.boolean(),
  caveat: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const LLMBugFindingSchema = z.object({
  pattern: z.enum(['untested-invariant', 'mock-hiding-behavior', 'unchecked-side-effect']),
  className: z.string(),
  methodName: z.string(),
  description: z.string(),
  risk: z.enum(['high', 'medium', 'low']),
  suggestedTest: z.string(),
});

export const SignalValidationSchema = z.object({
  signalIndex: z.number(),
  confirmed: z.boolean(),
  reasoning: z.string(),
});

export const BugFindingOutputSchema = z.object({
  findings: z.array(LLMBugFindingSchema),
  signalValidations: z.array(SignalValidationSchema),
});

export const ReasonerOutputSchema = z.object({
  discoveredStates: z.array(DiscoveredStateSchema),
  assertionJudgments: z.array(AssertionJudgmentSchema),
  criticalityRatings: z.array(CriticalityRatingSchema),
  transitiveInferences: z.array(TransitiveInferenceSchema),
  bugFindings: BugFindingOutputSchema.optional(),
});

// TypeScript types derived from schemas
export type DiscoveredState = z.infer<typeof DiscoveredStateSchema>;
export type AssertionJudgment = z.infer<typeof AssertionJudgmentSchema>;
export type CriticalityRating = z.infer<typeof CriticalityRatingSchema>;
export type TransitiveInference = z.infer<typeof TransitiveInferenceSchema>;
export type ReasonerOutput = z.infer<typeof ReasonerOutputSchema>;
export type LLMBugFindingType = z.infer<typeof LLMBugFindingSchema>;
export type SignalValidationType = z.infer<typeof SignalValidationSchema>;
export type BugFindingOutput = z.infer<typeof BugFindingOutputSchema>;
