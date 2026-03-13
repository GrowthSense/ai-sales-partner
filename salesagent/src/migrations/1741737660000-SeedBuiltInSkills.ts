import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SeedBuiltInSkills — inserts the global catalog of built-in agent skills.
 *
 * These records are the source of truth for:
 *  - OpenAI tool definitions (name, description, parameters)
 *  - Admin UI skill picker (displayName, category, minPlan)
 *  - SkillRegistryService DI lookup (handlerClass)
 *
 * Skills are NOT tenant-scoped at this level.
 * Tenants activate skills via the tenant_skills junction table.
 *
 * Parameter schemas follow the OpenAI function-calling JSON Schema format.
 */
export class SeedBuiltInSkills1741737660000 implements MigrationInterface {
  name = 'SeedBuiltInSkills1741737660000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO skills (name, display_name, description, type, parameters_schema, output_schema, category, min_plan, is_active, handler_class)
      VALUES

      -- AnswerQuestion: RAG-powered knowledge base retrieval
      (
        'AnswerQuestion',
        'Answer Question',
        'Search the tenant knowledge base and provide an accurate answer to the visitor''s question. Use this when the visitor asks about products, services, pricing, features, or any topic covered in the knowledge base.',
        'built_in',
        '{
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "The exact question or topic to search for in the knowledge base"
            },
            "tags": {
              "type": "array",
              "items": { "type": "string" },
              "description": "Optional document tags to scope the search (e.g. faq, pricing)"
            }
          },
          "required": ["query"]
        }',
        '{
          "type": "object",
          "properties": {
            "answer": { "type": "string" },
            "sources": { "type": "array", "items": { "type": "string" } },
            "confidence": { "type": "number" }
          }
        }',
        'knowledge',
        NULL,
        TRUE,
        'AnswerQuestionSkill'
      ),

      -- QualifyLead: extract BANT qualification data
      (
        'QualifyLead',
        'Qualify Lead',
        'Extract and record BANT qualification data from the conversation. Call this when the visitor reveals budget, authority, need, or timeline information. Updates the lead qualification profile.',
        'built_in',
        '{
          "type": "object",
          "properties": {
            "budget": {
              "type": "string",
              "description": "Budget range or indication (e.g. $10K-$50K/year, under $5K)"
            },
            "hasBudget": {
              "type": "boolean",
              "description": "Whether the visitor has confirmed budget approval"
            },
            "authority": {
              "type": "string",
              "description": "Decision-maker role or name (e.g. VP of Sales, IT Director)"
            },
            "isDecisionMaker": {
              "type": "boolean",
              "description": "Whether this visitor is the final decision-maker"
            },
            "need": {
              "type": "string",
              "description": "Primary pain point or need described by the visitor"
            },
            "needStrength": {
              "type": "string",
              "enum": ["low", "medium", "high"],
              "description": "Assessed urgency or strength of the need"
            },
            "timeline": {
              "type": "string",
              "description": "Purchasing or implementation timeline (e.g. Q3 2026, within 3 months)"
            },
            "hasTimeline": {
              "type": "boolean",
              "description": "Whether the visitor has a concrete timeline"
            },
            "notes": {
              "type": "string",
              "description": "Any other relevant qualification notes from the conversation"
            }
          },
          "required": []
        }',
        NULL,
        'qualification',
        NULL,
        TRUE,
        'QualifyLeadSkill'
      ),

      -- CaptureContact: extract PII and create/update lead record
      (
        'CaptureContact',
        'Capture Contact',
        'Extract and save visitor contact information. Call this as soon as the visitor shares their name, email, phone, company, or job title. Creates a Lead record if one does not exist.',
        'built_in',
        '{
          "type": "object",
          "properties": {
            "firstName": { "type": "string", "description": "Visitor''s first name" },
            "lastName":  { "type": "string", "description": "Visitor''s last name" },
            "email":     { "type": "string", "format": "email", "description": "Email address" },
            "phone":     { "type": "string", "description": "Phone number" },
            "company":   { "type": "string", "description": "Company or organisation name" },
            "jobTitle":  { "type": "string", "description": "Job title or role" }
          },
          "required": []
        }',
        '{
          "type": "object",
          "properties": {
            "leadId": { "type": "string" },
            "created": { "type": "boolean" }
          }
        }',
        'qualification',
        NULL,
        TRUE,
        'CaptureContactSkill'
      ),

      -- RecommendService: match visitor needs to tenant service catalog
      (
        'RecommendService',
        'Recommend Service',
        'Search the knowledge base for products or services that match the visitor''s stated needs and recommend the best options with specific reasons why they fit.',
        'built_in',
        '{
          "type": "object",
          "properties": {
            "visitorNeeds": {
              "type": "string",
              "description": "Summary of the visitor''s pain points and requirements"
            },
            "budget": {
              "type": "string",
              "description": "Visitor''s budget constraint if known"
            },
            "maxRecommendations": {
              "type": "integer",
              "default": 3,
              "description": "Maximum number of recommendations to return"
            }
          },
          "required": ["visitorNeeds"]
        }',
        NULL,
        'sales',
        NULL,
        TRUE,
        'RecommendServiceSkill'
      ),

      -- ScheduleDemo: book a calendar slot
      (
        'ScheduleDemo',
        'Schedule Demo',
        'Book a product demo or discovery call for the visitor. Returns a booking link or confirms a specific time slot. Use when the visitor expresses interest in seeing the product or speaking with the team.',
        'built_in',
        '{
          "type": "object",
          "properties": {
            "meetingType": {
              "type": "string",
              "enum": ["demo", "discovery_call", "follow_up"],
              "default": "demo",
              "description": "Type of meeting to schedule"
            },
            "preferredTime": {
              "type": "string",
              "description": "Visitor''s preferred time if mentioned (e.g. Tuesday afternoon, next week)"
            },
            "attendeeEmail": {
              "type": "string",
              "format": "email",
              "description": "Email to send the booking confirmation to"
            }
          },
          "required": []
        }',
        '{
          "type": "object",
          "properties": {
            "bookingUrl":  { "type": "string" },
            "scheduledAt": { "type": "string" },
            "meetingId":   { "type": "string" }
          }
        }',
        'scheduling',
        'starter',
        TRUE,
        'ScheduleDemoSkill'
      ),

      -- PushToCRM: create/update lead in the connected CRM
      (
        'PushToCRM',
        'Push to CRM',
        'Create or update a lead record in the tenant''s connected CRM (HubSpot, Salesforce, etc.). Call this after capturing contact info or when significant qualification data is gathered.',
        'built_in',
        '{
          "type": "object",
          "properties": {
            "leadId": {
              "type": "string",
              "description": "Internal lead ID to sync (resolved automatically if omitted)"
            }
          },
          "required": []
        }',
        '{
          "type": "object",
          "properties": {
            "crmId":   { "type": "string" },
            "synced":  { "type": "boolean" },
            "provider": { "type": "string" }
          }
        }',
        'crm',
        'pro',
        TRUE,
        'PushToCrmSkill'
      ),

      -- SendFollowUp: queue a follow-up email sequence
      (
        'SendFollowUp',
        'Send Follow-up Email',
        'Queue a follow-up email or email sequence to the visitor. Use after a conversation ends, a demo is scheduled, or as a nurture action. Emails are sent via the tenant''s configured SMTP or email provider.',
        'built_in',
        '{
          "type": "object",
          "properties": {
            "templateId": {
              "type": "string",
              "description": "Email template identifier to use"
            },
            "delayHours": {
              "type": "number",
              "default": 1,
              "description": "Hours to wait before sending the email"
            },
            "subject": {
              "type": "string",
              "description": "Email subject line override (optional)"
            }
          },
          "required": ["templateId"]
        }',
        NULL,
        'email',
        'starter',
        TRUE,
        'SendFollowUpSkill'
      ),

      -- HandoffToHuman: pause AI and alert a human agent
      (
        'HandoffToHuman',
        'Hand Off to Human',
        'Pause AI responses and notify a human agent to take over the conversation. Use when the visitor requests to speak to a person, has a complex issue beyond the AI''s scope, or is a high-value lead requiring personal attention.',
        'built_in',
        '{
          "type": "object",
          "properties": {
            "reason": {
              "type": "string",
              "description": "Reason for the handoff (shown to the human agent)"
            },
            "priority": {
              "type": "string",
              "enum": ["low", "normal", "high", "urgent"],
              "default": "normal",
              "description": "Priority level for the handoff notification"
            }
          },
          "required": ["reason"]
        }',
        NULL,
        'routing',
        NULL,
        TRUE,
        'HandoffToHumanSkill'
      ),

      -- TransitionStage: signal a conversation stage change
      (
        'TransitionStage',
        'Transition Stage',
        'Signal that the conversation should move to a different stage. The transition is validated by the server-side state machine before being applied. Only call this when a genuine stage transition is warranted by the conversation flow.',
        'built_in',
        '{
          "type": "object",
          "properties": {
            "targetStage": {
              "type": "string",
              "enum": ["greeting", "discovery", "qualification", "recommendation", "objection_handling", "conversion", "scheduling", "follow_up"],
              "description": "The stage to transition to"
            },
            "reason": {
              "type": "string",
              "description": "Brief reason for the stage transition (for observability)"
            }
          },
          "required": ["targetStage"]
        }',
        NULL,
        'routing',
        NULL,
        TRUE,
        'TransitionStageSkill'
      )

      ON CONFLICT (name) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM skills
      WHERE name IN (
        'AnswerQuestion', 'QualifyLead', 'CaptureContact', 'RecommendService',
        'ScheduleDemo', 'PushToCRM', 'SendFollowUp', 'HandoffToHuman', 'TransitionStage'
      )
    `);
  }
}
