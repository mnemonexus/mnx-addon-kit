/// <reference path="./assets.d.ts" />
/** Public protocol 1. These types import no MnemoNexus implementation. */
export type LaunchSurface = 'standalone' | 'recall' | 'transferal' | 'calendar' | 'study';
export interface StudyExperienceContext {
  readonly version: 1;
  readonly runId: string;
  readonly workspaceId: string;
  readonly lectureId: string;
  readonly lectureTitle: string;
  readonly subsectionId: string;
  readonly subsectionTitle: string;
  readonly contextFingerprint: string;
  readonly depth: 'core' | 'standard' | 'deep';
  readonly taskId: string;
  readonly taskSchema: string;
  /**
   * The current subsection (HOST_CONTRACT.md section 9). Sent when
   * `capabilities` includes 'study-section-v1'. Feature-detect before reading.
   */
  readonly section?: StudySection;
}
/** The current subsection. `text` is markdown (CommonMark with GitHub tables), at most 20,000 characters. */
export interface StudySection {
  readonly objective: string;
  readonly text: string;
}
export interface StudyExperienceEvidence {
  readonly runId: string;
  readonly taskId: string;
  readonly contextFingerprint: string;
  readonly solvedStepIds: readonly string[];
  readonly attempts: number;
  readonly hintsUsed: number;
}
export type Permission = 'knowledge:read' | 'knowledge:unlock-authored' | 'knowledge:propose'
  | 'ai:generate' | 'schedule:recall' | 'schedule:calendar' | 'network' | 'multiplayer'
  | 'render:3d' | 'storage:local';
export interface KnowledgeItem {
  readonly lineageId: string;
  readonly itemId: string;
  readonly conceptId: string;
  readonly conceptTitle: string;
  /** Vocabulary can grow; unknown values must not be guessed at. */
  readonly conceptKind: string;
  readonly descriptorType: string;
  readonly descriptorStructure: string;
  readonly text: string;
  readonly structuredItems: readonly string[];
  readonly tags: readonly string[];
  readonly discipline: string;
  readonly practiceModes: readonly string[];
  readonly hasMedia: boolean;
}
/** Theme v1 (HOST_CONTRACT.md section 11): the user's look, as a fixed set of tokens. */
export interface AddonTheme {
  readonly version: 1;
  readonly scheme: 'light' | 'dark';
  readonly edges: 'lines' | 'shadows' | 'both' | 'none';
  readonly reducedMotion: boolean;
  readonly backdrop: 'transparent' | 'solid';
  /** Every `--mnx-*` token, as CSS values. */
  readonly tokens: Readonly<Record<string, string>>;
}
/** Settings v1 (HOST_CONTRACT.md section 12): one value per declared setting id. */
export type AddonSettings = Readonly<Record<string, boolean | number | string>>;
export interface ExperienceResult {
  readonly learningPreparation?: import('./learning.js').Preparation;
  readonly studyEvidence?: StudyExperienceEvidence;
  readonly completed: boolean;
  readonly quality?: number;
  readonly elapsedSeconds: number;
  readonly completedStages?: readonly string[];
  /** Keyed by an item's lineageId (not itemId); each value from 0 to 1. */
  readonly itemCoverage?: Readonly<Record<string, number>>;
  readonly proposedKnowledge?: readonly {
    readonly key: string;
    readonly title: string;
    readonly statement: string;
    readonly gapType: 'prerequisite' | 'context' | 'technique' | 'application';
    readonly relatedItemIds: readonly string[];
    readonly priority: 'high' | 'medium' | 'low';
    readonly rationale: string;
  }[];
}
export interface ExperienceProps {
  /** Present when the host launches a selected learning activity (addon-learning-v1). */
  readonly learningActivity?: import('./learning.js').ActivityLaunch;
  /** Settings v1: every declared setting id, with the user's value or its default. `{}` without settings. */
  readonly settings?: AddonSettings;
  readonly study?: StudyExperienceContext;
  readonly kind: 'experience';
  readonly extensionId: string;
  readonly surface: LaunchSurface;
  readonly items: readonly KnowledgeItem[];
  readonly permissions: readonly Permission[];
}
export interface ExperienceHost {
  readonly capabilities?: readonly string[];
  readonly protocolVersion: 1;
  readonly root: HTMLElement;
  readonly props: ExperienceProps;
  complete(result: ExperienceResult): void;
  exit(): void;
  onUpdate(handler: ((props: ExperienceProps) => void) | null): void;
  asset(path: string): Promise<ArrayBuffer>;
  /** Available when source-media-v1 is advertised; reads only supplied media IDs. Needs knowledge:read. */
  sourceAsset?(id: string): Promise<ArrayBuffer>;
  /** Theme v1: the theme in force. Present when `capabilities` includes 'theme-v1'. */
  readonly theme?: AddonTheme | null;
  /** Theme v1: called after a new theme has been applied. */
  onTheme?(handler: ((theme: AddonTheme) => void) | null): void;
  generate(options: { prompt: string; system?: string; json?: boolean }): Promise<unknown>;
  externalApi(apiId: string, opId: string, params?: Readonly<Record<string, string | number>>): Promise<unknown>;
  /** Index views only: tell the host the user picked a concept. */
  selectConcept?(conceptId: string): void;
  readonly storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<boolean>;
    delete(key: string): Promise<boolean>;
    keys(): Promise<string[]>;
  };
}
export function getExperienceHost(scope?: { mnx?: unknown }): ExperienceHost;
