// @ts-nocheck
/*
  Codemod: migrate native <select> to components/ui/SelectBase
  - Preserves 1:1 props (id, name, value, defaultValue, onChange, required, disabled, aria-*, data-*, className)
  - Removes adjacent chevrons (lucide <ChevronDown/> or literal ▼ span) when directly sibling within same container
  - Adds import SelectBase from 'components/ui/SelectBase'
  NOTE: This is a scaffold. Run with ts-node or compile first. Review diffs.
*/

import { Project, SyntaxKind, JsxOpeningElement, JsxSelfClosingElement, Node, QuoteKind } from 'ts-morph';
import path from 'node:path';

const project = new Project({ tsConfigFilePath: path.resolve(__dirname, '../tsconfig.json') });

const isSelectElement = (node: Node): node is JsxOpeningElement | JsxSelfClosingElement => {
  return (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) && node.getTagNameNode().getText() === 'select';
};

const run = () => {
  const sourceFiles = project.getSourceFiles(['**/*.tsx', '**/*.jsx']);
  for (const sf of sourceFiles) {
    let changed = false;

    // Skip obvious non-client or API routes
    const filePath = sf.getFilePath();
    if (/(^|\/)app\/api\//.test(filePath)) continue;

    // Ensure import exists
    const ensureImport = () => {
      const existing = sf.getImportDeclarations().find(id => id.getModuleSpecifierValue() === 'components/ui/SelectBase');
      if (!existing) {
        sf.addImportDeclaration({ defaultImport: 'SelectBase', moduleSpecifier: 'components/ui/SelectBase', quoteKind: QuoteKind.Single });
      }
    };

    sf.forEachDescendant(node => {
      if (!isSelectElement(node)) return;
      const opening = node as JsxOpeningElement | JsxSelfClosingElement;

      // Replace tag name
      opening.getTagNameNode().replaceWithText('SelectBase');
      changed = true;

      // Remove duplicate chevrons in same parent: <ChevronDown .../> or span with text '▼'
      const parent = opening.getParentIfKind(SyntaxKind.JsxElement);
      if (parent) {
        const children = parent.getJsxChildren();
        for (const child of children) {
          const el = child.asKind(SyntaxKind.JsxElement) || child.asKind(SyntaxKind.JsxSelfClosingElement);
          if (!el) continue;
          const tag = (el as any).getTagNameNode?.().getText?.();
          if (tag === 'ChevronDown') {
            el.replaceWithText('');
            changed = true;
          }
          if (tag === 'span') {
            const txt = el.getText();
            if (txt.includes('▼')) { el.replaceWithText(''); changed = true; }
          }
        }
      }
    });

    if (changed) { ensureImport(); }
    if (changed) { sf.fixUnusedIdentifiers(); }
  }

  project.saveSync();
};

run();
