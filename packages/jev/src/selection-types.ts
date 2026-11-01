/** Profile settings for skill-catalog filtering and glob-result ranking. */
export interface SelectionConfigValues {
  /** Maximum eligible skill summaries selected before visible-name deduplication. */
  skillLimit: number
  /** Minimum skill relevance probability, inclusive; finite [0, 1], default 0.5. */
  skillMinProbability: number
  /** Maximum glob match count eligible for Jev ranking; larger results bypass Jev. */
  fileCandidates: number
  /** Maximum ranked paths shown in a Jev-processed glob result. */
  fileLimit: number
}
