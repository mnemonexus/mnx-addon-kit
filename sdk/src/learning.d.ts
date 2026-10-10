import type { AddonSettings, ExperienceHost, ExperienceResult, KnowledgeItem, Permission } from './index.js';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonValue[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: false;
}
export interface LearningContribution {
  version: 1;
  schemas: Record<string, JsonSchema>;
  activities: { id: string; label: string; payloadSchema: string; maxSeconds: number; surfaces: ('study' | 'recall')[] }[];
}
export interface SourceContext {
  workspaceId: string;
  lectureId: string;
  subsectionId: string;
  fingerprint: string;
  objective: string;
  text: string;
  knowledge: KnowledgeItem[];
  sourceRefs: string[];
  media: { id: string; mimeType: string }[];
}
export interface KnowledgeAttachment {
  id: string;
  schemaId: string;
  payload: JsonValue;
  sourceRefs: string[];
  knowledgeRefs: string[];
}
export interface ActivityOffer {
  id: string;
  activityId: string;
  label: string;
  payload: JsonValue;
  sourceRefs: string[];
  knowledgeRefs: string[];
  prerequisiteIds: string[];
  estimatedSeconds: number;
  contentKind: 'source-task' | 'concept-example';
}
export interface Preparation { attachments: KnowledgeAttachment[]; offers: ActivityOffer[] }
export interface AddonJobProps {
  kind: 'addon-job';
  extensionId: string;
  permissions: Permission[];
  /** Settings v1: the user's values, as in any frame (HOST_CONTRACT.md section 12). */
  settings?: AddonSettings;
  source: SourceContext;
  attachments: KnowledgeAttachment[];
}
export interface ActivityLaunch { offer: ActivityOffer; source: SourceContext }
export interface AddonJobHost extends Omit<ExperienceHost, 'props' | 'onUpdate'> {
  readonly props: AddonJobProps;
  onUpdate(handler: ((props: AddonJobProps) => void) | null): void;
}
export interface DefineAddonOptions {
  learning: LearningContribution;
  extract?(source: SourceContext, host: AddonJobHost): KnowledgeAttachment[] | Promise<KnowledgeAttachment[]>;
  offerActivities?(context: { source: SourceContext; attachments: KnowledgeAttachment[] }, host: AddonJobHost): ActivityOffer[] | Promise<ActivityOffer[]>;
  renderActivity(host: ExperienceHost): unknown | Promise<unknown>;
  renderStandalone?(host: ExperienceHost): unknown | Promise<unknown>;
}
export function validateLearningContribution(value: unknown): LearningContribution;
export function validatePreparation(value: unknown, contribution: LearningContribution, source: SourceContext): Preparation;
export function defineAddon(options: DefineAddonOptions, scope?: { mnx?: unknown }): Promise<unknown>;
