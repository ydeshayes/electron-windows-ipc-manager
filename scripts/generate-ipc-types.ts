#!/usr/bin/env node

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

// Export the function so we can test it
export function generateIPCTypes() {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.json');

  if (!configPath) throw new Error('Could not find tsconfig.json');

  const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
  const { options, fileNames } = ts.parseJsonConfigFileContent(
    config,
    ts.sys,
    path.dirname(configPath)
  );

  const program = ts.createProgram(fileNames, {
    ...options,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
  });
  const checker = program.getTypeChecker();

  function resolveType(node: ts.Node, sourceFile: ts.SourceFile): string {
    // If it's a Promise type, extract the type parameter
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === 'Promise' &&
      node.typeArguments?.length === 1
    ) {
      return resolveType(node.typeArguments[0], sourceFile);
    }

    // If it's a type reference, handle imports and return simple name
    if (ts.isTypeReferenceNode(node)) {
      const symbol = checker.getSymbolAtLocation(node.typeName);
      if (symbol) {
        const declaration = symbol.declarations?.[0];
        if (
          declaration &&
          ts.isSourceFile(declaration.getSourceFile()) &&
          !declaration.getSourceFile().fileName.includes('node_modules') &&
          !declaration.getSourceFile().fileName.includes('lib.')
        ) {
          // Check if the type is exported
          const isExported = symbol.declarations?.some(
            (d) => ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Export
          );

          if (!isExported) {
            throw new Error(
              `Type "${symbol.name}" in ${declaration.getSourceFile().fileName} must be exported to be used in IPC handlers.`
            );
          }

          const importPath = path
            .relative(
              path.dirname(path.resolve(__dirname, '../src/shared/windows.ts')),
              declaration.getSourceFile().fileName
            )
            .replace(/\.ts$/, '');
          typeImports.add(`import type { ${symbol.name} } from '${importPath}';`);

          return symbol.name; // Return just the type name
        }
      }
    }

    // For other cases, use the type checker
    const type = checker.getTypeAtLocation(node);
    return checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  }

  const sourceFiles = program
    .getSourceFiles()
    .filter(
      (file) =>
        !file.fileName.includes('.d.ts') &&
        !file.fileName.includes('node_modules') &&
        !file.fileName.includes('.test.')
    );

  console.log(
    'Processing source files:',
    sourceFiles.map((f) => f.fileName)
  );

  const windowTypes: Record<string, any> = {};
  const typeImports = new Set<string>();
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

  const responseHandlers: Record<string, { windowName: string; methodName: string; type: string }> =
    {};

  for (const sourceFile of sourceFiles) {
    console.log('\nProcessing file:', sourceFile.fileName);
    ts.forEachChild(sourceFile, (node: ts.Node) => {
      if (ts.isClassDeclaration(node)) {
        console.log('Found class:', node.name?.text);
        const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
        if (decorators?.length) {
          console.log(
            'Decorators:',
            decorators.map((d) => {
              if (!ts.isCallExpression(d.expression)) return 'unknown';
              if (!ts.isIdentifier(d.expression.expression)) return 'unknown';
              return d.expression.expression.text;
            })
          );
        }
      }
    });
  }

  for (const sourceFile of sourceFiles) {
    ts.forEachChild(sourceFile, (node: ts.Node) => {
      if (ts.isClassDeclaration(node)) {
        const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
        if (decorators?.length) {
          const windowDecorator = decorators.find((d) => {
            if (!ts.isCallExpression(d.expression)) return false;
            if (!ts.isIdentifier(d.expression.expression)) return false;
            return d.expression.expression.text === 'windowName';
          });

          if (windowDecorator && ts.isCallExpression(windowDecorator.expression)) {
            const arg = windowDecorator.expression.arguments[0];
            const windowName = ts.isStringLiteral(arg)
              ? arg.text
              : printer.printNode(ts.EmitHint.Unspecified, arg, sourceFile);
            const methods: Record<string, any> = {};

            node.members.forEach((member) => {
              if (ts.isMethodDeclaration(member)) {
                const methodDecorators = ts.canHaveDecorators(member)
                  ? ts.getDecorators(member)
                  : undefined;
                if (methodDecorators?.length) {
                  const handlerDecorator = methodDecorators.find((d) => {
                    if (!ts.isCallExpression(d.expression)) return false;
                    if (!ts.isIdentifier(d.expression.expression)) return false;
                    return d.expression.expression.text === 'mainHandler';
                  });

                  const responseDecorator = methodDecorators.find((d) => {
                    if (!ts.isCallExpression(d.expression)) return false;
                    if (!ts.isIdentifier(d.expression.expression)) return false;
                    return d.expression.expression.text === 'responseHandler';
                  });

                  if (handlerDecorator && ts.isCallExpression(handlerDecorator.expression)) {
                    const arg = handlerDecorator.expression.arguments[0];
                    const methodName = ts.isStringLiteral(arg)
                      ? arg.text
                      : printer.printNode(ts.EmitHint.Unspecified, arg, sourceFile);

                    // Parameter type inference remains the same
                    const paramType = member.parameters[0]?.type
                      ? resolveType(member.parameters[0].type, sourceFile)
                      : 'void';

                    // Improve return type inference
                    let returnType: string;
                    if (responseDecorator && ts.isCallExpression(responseDecorator.expression)) {
                      const typeArg = responseDecorator.expression.typeArguments?.[0];
                      returnType = typeArg ? resolveType(typeArg, sourceFile) : 'void';
                      responseHandlers[`${windowName}:${methodName}`] = {
                        windowName: windowName.replace(/['"]/g, ''),
                        methodName: methodName.replace(/['"]/g, ''),
                        type: returnType,
                      };
                    } else {
                      // Get the signature of the method
                      const signature = checker.getSignatureFromDeclaration(member);
                      if (signature) {
                        const returnTypeFromSignature = checker.getReturnTypeOfSignature(signature);
                        // If it's a Promise, get the type argument
                        if (checker.typeToString(returnTypeFromSignature).startsWith('Promise<')) {
                          const promiseType = checker.getTypeArguments(
                            returnTypeFromSignature as ts.TypeReference
                          )[0];
                          returnType = checker.typeToString(
                            promiseType,
                            undefined,
                            ts.TypeFormatFlags.NoTruncation
                          );
                        } else {
                          returnType = checker.typeToString(
                            returnTypeFromSignature,
                            undefined,
                            ts.TypeFormatFlags.NoTruncation
                          );
                        }
                      } else {
                        returnType = 'void';
                      }
                    }

                    methods[methodName.replace(/['"]/g, '')] = {
                      params: paramType,
                      returns: returnType,
                    };
                  }
                }
              }
            });

            if (windowName) {
              windowTypes[windowName.replace(/['"]/g, '')] = methods;
            }
          }
        }
      }
    });
  }

  console.log('Window types found:', windowTypes);

  // Generate the interface file with imports
  const content = `// This file is auto-generated. Do not edit manually.
${Array.from(typeImports).join('\n')}
import type { HandlerDefinition } from './types';

export interface Windows {
${Object.entries(windowTypes)
  .map(
    ([windowName, methods]) => `  ${windowName}: {
${Object.entries(methods as any)
  .map(([methodName, types]: [string, any]) => {
    const hasResponseHandler = responseHandlers[`${windowName}:${methodName}`];
    return `    ${methodName}: HandlerDefinition<${types.params}, ${types.returns}>;${
      hasResponseHandler
        ? `\n    ${methodName}Response?: (data: ${types.returns}) => Promise<void>;`
        : ''
    }`;
  })
  .join('\n')}
  }`
  )
  .join('\n')}
}

export type WindowDefinitions = {
  [K in keyof Windows]: {
    [M in keyof Windows[K]]: Windows[K][M]
  }
};
`;

  fs.writeFileSync(path.resolve(__dirname, '../src/shared/windows.d.ts'), content);
}

// Only run if this file is being executed directly
if (require.main === module) {
  generateIPCTypes();
}
