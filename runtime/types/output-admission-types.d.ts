/** Profile limits for model-visible command and test log admission. */
export interface OutputAdmissionConfigValues {
    generalMinChars: number;
    testMinChars: number;
    generalBlockChars: number;
    /** Maximum eligible command candidates, excluding first, last, and other retained groups. */
    maxGeneralBlocks: number;
    maxTestCandidates: number;
    maxRequestChars: number;
    maxTaskChars: number;
    waitMs: number;
    omitProbability: number;
    minSavedChars: number;
    minSavedRatio: number;
    slowTestMs: number;
    duplicateMinLines: number;
    duplicateMinChars: number;
}
//# sourceMappingURL=output-admission-types.d.ts.map