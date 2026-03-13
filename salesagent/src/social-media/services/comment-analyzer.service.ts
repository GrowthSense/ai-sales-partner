import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { CommentSentiment } from '../../common/enums';

export interface CommentAnalysisResult {
  sentiment: CommentSentiment;
  /** Confidence score from -1.0 (most negative) to +1.0 (most positive). */
  sentimentScore: number;
  /** One-sentence reason. */
  sentimentReason: string;
  /** True if the comment contains buying intent or product interest. */
  isLeadSignal: boolean;
  /** Description of any lead signals found. */
  leadSignals: string | null;
  /** Email addresses found in the comment text. */
  extractedEmails: string[];
  /** Phone numbers found in the comment text. */
  extractedPhones: string[];
  /** 1–3 suggested actions for the admin team. */
  suggestedActions: string[];
}

/**
 * CommentAnalyzerService
 *
 * Uses OpenAI structured output to classify a social media comment and
 * extract actionable signals in a single API call.
 *
 * The LLM returns a JSON object conforming to CommentAnalysisResult.
 * We validate the shape with a JSON Schema via the response_format field.
 */
@Injectable()
export class CommentAnalyzerService {
  private readonly logger = new Logger(CommentAnalyzerService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({ apiKey: config.get<string>('OPENAI_API_KEY') });
    this.model = config.get<string>('OPENAI_MODEL', 'gpt-4o');
  }

  async analyze(commentText: string): Promise<CommentAnalysisResult> {
    const systemPrompt = `You are a social media analyst for a B2B SaaS company.
Analyze the given comment and return a JSON object with exactly these fields:

- sentiment: one of "positive", "neutral", "negative", "critical"
  - "critical" = severe complaint, public crisis risk, or urgent escalation needed
  - "negative" = dissatisfied but not urgent
- sentimentScore: float from -1.0 (most negative) to +1.0 (most positive)
- sentimentReason: one concise sentence explaining the sentiment
- isLeadSignal: boolean — true if the commenter shows buying intent, asks about pricing,
  requests a demo, mentions a pain point the company can solve, or expresses interest in the product
- leadSignals: if isLeadSignal=true, describe what signals were detected; otherwise null
- extractedEmails: array of email addresses found verbatim in the comment text (may be empty)
- extractedPhones: array of phone numbers found verbatim in the comment text (may be empty)
- suggestedActions: array of 1–3 short action strings for the admin team
  Examples: "Reply with apology", "Create lead", "Offer refund", "Escalate to support",
  "Respond with pricing info", "Schedule a demo call"

Return ONLY valid JSON. No markdown, no extra text.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: commentText },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as Partial<CommentAnalysisResult>;

      return this.validate(parsed);
    } catch (err) {
      this.logger.error(
        `CommentAnalyzerService: OpenAI call failed — ${String(err)}`,
      );
      // Graceful fallback: treat as neutral, flag for manual review
      return {
        sentiment: CommentSentiment.NEUTRAL,
        sentimentScore: 0,
        sentimentReason: 'Analysis unavailable — manual review required.',
        isLeadSignal: false,
        leadSignals: null,
        extractedEmails: [],
        extractedPhones: [],
        suggestedActions: ['Manual review required'],
      };
    }
  }

  private validate(raw: Partial<CommentAnalysisResult>): CommentAnalysisResult {
    const allowedSentiments = Object.values(CommentSentiment) as string[];
    const sentiment = allowedSentiments.includes(raw.sentiment as string)
      ? (raw.sentiment as CommentSentiment)
      : CommentSentiment.NEUTRAL;

    return {
      sentiment,
      sentimentScore: typeof raw.sentimentScore === 'number'
        ? Math.max(-1, Math.min(1, raw.sentimentScore))
        : 0,
      sentimentReason: typeof raw.sentimentReason === 'string'
        ? raw.sentimentReason
        : '',
      isLeadSignal: raw.isLeadSignal === true,
      leadSignals: typeof raw.leadSignals === 'string' ? raw.leadSignals : null,
      extractedEmails: Array.isArray(raw.extractedEmails)
        ? (raw.extractedEmails as string[]).filter((e) => typeof e === 'string')
        : [],
      extractedPhones: Array.isArray(raw.extractedPhones)
        ? (raw.extractedPhones as string[]).filter((p) => typeof p === 'string')
        : [],
      suggestedActions: Array.isArray(raw.suggestedActions)
        ? (raw.suggestedActions as string[]).filter((a) => typeof a === 'string').slice(0, 3)
        : [],
    };
  }
}
