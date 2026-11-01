/** Package the official Remote helper for Hosts without its protocol subpath. */
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * Copy an import-free published helper and point both generated entries to it.
 * @param output - Directory containing the generated Host and Remote entries.
 * @param helper - Published protocol helper resolved from the build dependency.
 * @returns Completion after the helper and both local imports are written.
 */
export async function installGeneratedRemoteRuntime(output, helper) {
  const source = await readFile(helper, 'utf8')
  const syntax = ts.createSourceFile(helper, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  function check(node) {
    if (ts.isImportDeclaration(node)
      || (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined)
      || (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require')))) {
      throw new Error('The published Typert Remote helper must have no runtime module dependencies')
    }
    ts.forEachChild(node, check)
  }
  check(syntax)
  const imported = "from '@deepseek-ai/dsh-typert-protocol/remote-info'"
  for (const name of ['typert.host.js', 'typert.remote-client.js']) {
    const file = join(output, name)
    const generated = await readFile(file, 'utf8')
    if (generated.split(imported).length !== 2) throw new Error(`Expected one published Remote helper import in ${name}`)
    await writeFile(file, generated.replace(imported, "from './typert.remote-info.js'"))
  }
  await copyFile(helper, join(output, 'typert.remote-info.js'))
}
