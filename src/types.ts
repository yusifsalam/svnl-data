export interface Competition {
  id: string;
  url: string;
  name: string;
  date: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  eventType?: "sbd" | "b";
  category: "nationals" | "local";
}

export interface Attempt {
  weight: number;
  success: boolean;
}

export interface Lifter {
  name: string;
  birthYear: number;
  gender: "M" | "F";
  ageClass?: string;
  equipment: "raw" | "equipped";
  weightClass: string;
  bodyWeight: number;
  club: string;
  squat: [Attempt, Attempt, Attempt];
  bench: [Attempt, Attempt, Attempt];
  deadlift: [Attempt, Attempt, Attempt];
  total: number;
  points: number;
  position: number;
}

export interface ScrapeMetadata {
  competitionId: string;
  skipped: boolean;
  cached: boolean;
  hashMatch: boolean;
}

export interface CompetitionResult {
  competition: Competition;
  lifters: Lifter[];
  metadata?: ScrapeMetadata;
}

export type ProgressCallback = (message: string) => void;

export type JsonEvent =
  | { type: "progress"; message: string }
  | { type: "complete"; data: unknown }
  | { type: "error"; message: string };
