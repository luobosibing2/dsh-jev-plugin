/** Prepare disposable, public test fixtures without credentials or model requests. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const project = fileURLToPath(new URL('../..', import.meta.url))
const artifacts = resolve(process.env.JEV_VALIDATION_ARTIFACTS_DIR ?? join(project, '.artifacts/latest-harness-validation'))
async function file(path, text) {
  await mkdir(resolve(path, '..'), { recursive: true })
  await writeFile(path, text, { flag: 'wx' })
}
for (const [caseId, count] of [['file-ranking', 12], ['glob-forty-one', 41]]) {
  for (let index = 0; index < count; index++) {
    const target = index === count - 1
    await file(join(artifacts, 'workspaces', caseId, target ? 'auth-password-reset.ts' : 'placeholder-' + String(index).padStart(2, '0') + '.ts'),
      'export const marker = ' + JSON.stringify(target ? 'AUTH_RESET_IMPLEMENTATION_OK' : 'fixture-' + index) + ';\n')
  }
}
await mkdir(join(artifacts, 'workspaces/glob-zero'), { recursive: true })
const skills = [
  ['auth-reset-validator', 'Validate password reset implementation and its authorization checks.', 'Return exactly ORIGINAL_AUTH_RESET_SKILL_LOADED_OK.'],
  ['data-charts', 'Draw data charts and diagrams.', 'Return CHART.'],
  ['audio-notes', 'Transcribe audio and podcasts.', 'Return AUDIO.'],
  ['image-editor', 'Edit bitmap illustrations.', 'Return IMAGE.'],
  ['translation', 'Translate French and German prose.', 'Return TRANSLATION.'],
  ['mail-sorter', 'Sort email messages.', 'Return MAIL.'],
  ['slides', 'Build presentation slides.', 'Return SLIDES.'],
  ['clock-helper', 'Read clock times and timezones.', 'Return CLOCK.'],
]
for (const [name, description, body] of skills) await file(join(artifacts, 'controlled-skills', name, 'SKILL.md'),
  '---\nname: ' + name + '\ndescription: ' + description + '\n---\n\n' + body + '\n')
await file(join(artifacts, 'workspaces/output-admission/build.mjs'),
  "console.log('Start controlled build');\nfor (let i=1;i<=450;i++) console.log('Building '+i+'/450');\nconsole.log('BUILD_RESULT: latest-harness-build-complete');\nconsole.log('Summary: build completed');\n")
await file(join(artifacts, 'workspaces/test-log-admission/checks.test.mjs'),
  "import test from 'node:test';\nimport assert from 'node:assert/strict';\nfor(let i=0;i<100;i++) test('ordinary arithmetic '+i,()=>assert.equal(i+1-1,i));\ntest('distinct arithmetic sentinel',()=>assert.equal(41+1,42));\n")
await file(join(artifacts, 'workspaces/instruction-guidance/AGENTS.md'), '# Controlled reporting rule\n\nAfter reading guide.txt, state REPORT_RULE_OK and its marker. Do not edit files.\n')
await file(join(artifacts, 'workspaces/instruction-guidance/guide.txt'), 'GUIDE_SENTINEL_OK\n')
for (const caseId of ['current-cwd', 'current-cwd-project']) {
  const workspace = join(artifacts, 'workspaces', caseId)
  await mkdir(join(workspace, '.git'), { recursive: true })
  await file(join(workspace, '.agents/skills/root-unrelated/SKILL.md'), '---\nname: root-unrelated\ndescription: Unrelated chart conversion skill in the initial root only.\n---\n\nReturn ROOT_SKILL.\n')
  const separateProject = caseId === 'current-cwd-project'
  if (separateProject) await mkdir(join(workspace, 'child/.git'), { recursive: true })
  await file(join(workspace, 'child/.agents/skills/child-reporting/SKILL.md'), separateProject
    ? '---\nname: child-reporting\ndescription: Return the original marker for the child independent project validation.\n---\n\nReturn exactly CHILD_PROJECT_ORIGINAL_SKILL_OK.\n'
    : '---\nname: child-reporting\ndescription: Create the requested CURRENT_CWD report after entering the child directory.\n---\n\nRead guide.txt and create report.txt with the exact user-requested marker. Return CHILD_SKILL_ORIGINAL_OK.\n')
  if (!separateProject) {
    await file(join(workspace, 'child/AGENTS.md'), '# Current directory rule\n\nUse relative guide.txt and report.txt in this child directory. Include CHILD_RULE_OK in the final report.\n')
    await file(join(workspace, 'child/guide.txt'), 'CHILD_GUIDE_OK\n')
    await file(join(workspace, 'guide.txt'), 'WRONG_INITIAL_GUIDE\n')
  }
}
await mkdir(join(artifacts, 'empty-bundled'), { recursive: true })
await mkdir(join(artifacts, 'agents'), { recursive: true })
console.log('Prepared fresh disposable validation fixtures. Existing files are never overwritten.')
