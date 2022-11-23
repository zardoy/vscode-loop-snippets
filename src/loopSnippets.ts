import { getExtensionSetting, registerExtensionCommand, showQuickPick } from 'vscode-framework'
import { getActiveRegularEditor } from '@zardoy/vscode-utils'

import { window, DecorationRangeBehavior, SnippetString, commands, Range, workspace } from 'vscode'
import { Disposable } from 'vscode'

export default () => {
    let currentSnippetSessionHandle: (() => void) | undefined
    let currentSessionDisposables: Disposable[] | undefined
    const exitSnippetSession = () => {
        if (currentSessionDisposables) Disposable.from(...currentSessionDisposables).dispose()
    }

    const decoration = window.createTextEditorDecorationType({
        after: {},
        before: {
            color: '#0ebc79',
            // margin: '0px 0px 0px -0.25ch',
            contentText: '▌',
        },
        rangeBehavior: DecorationRangeBehavior.ClosedClosed,
    })

    registerExtensionCommand('insertLoopSnippet', async (_, arg?: { separator: string; wrap: string }) => {
        const editor = getActiveRegularEditor()
        if (!editor) return

        if (currentSnippetSessionHandle) {
            currentSnippetSessionHandle()
            return
        }

        let editorExpectedEndPos = editor.selection.active

        type SimpleSnippetVariant = {
            wrap: string | undefined
            separator: string
        }

        const simpleSnippetVariants: Record<string, SimpleSnippetVariant> = {
            "'|' | ": {
                wrap: "'$1'",
                separator: ' | ',
            },
            '| && ': {
                wrap: undefined,
                separator: ' && ',
            },
            '| || ': {
                wrap: undefined,
                separator: ' || ',
            },
            '|, ': {
                wrap: undefined,
                separator: ', ',
            },
        }

        const selectedVariant =
            arg?.separator !== undefined && arg.separator !== undefined
                ? arg
                : await showQuickPick(
                      Object.entries(simpleSnippetVariants).map(([key, value]) => ({
                          label: key,
                          value,
                      })),
                      {
                          title: 'Select simple loop snippet',
                          placeHolder: '| - cursor placeHolder',
                      },
                  )
        if (!selectedVariant) return
        const { wrap: wrapSnippet = '', separator } = selectedVariant
        const showExitMarker = getExtensionSetting('showExitMarker')
        const snippetCanExitByTyping = !showExitMarker || !!wrapSnippet

        let firstInsert = true
        let snippetJustInserted = false
        const doInsert = () => {
            const snippetToInsert = firstInsert ? wrapSnippet : separator + wrapSnippet
            if (snippetToInsert) {
                snippetJustInserted = true
                void editor.insertSnippet(new SnippetString(snippetToInsert), firstInsert ? undefined : editorExpectedEndPos)
            }

            firstInsert = false
        }

        currentSnippetSessionHandle = () => {
            doInsert()
        }

        await commands.executeCommand('setContext', 'inLoopSnippet', true)
        currentSessionDisposables = [
            {
                dispose() {
                    void commands.executeCommand('setContext', 'inLoopSnippet', false)
                    editor.setDecorations(decoration, [])
                    currentSnippetSessionHandle = undefined
                },
            },
        ]

        const updateDecoration = () => {
            if (!showExitMarker) return
            editor.setDecorations(decoration, [{ range: new Range(editorExpectedEndPos, editorExpectedEndPos) }])
        }

        if (!snippetCanExitByTyping) updateDecoration()

        workspace.onDidChangeTextDocument(
            ({ document, contentChanges }) => {
                if (document !== editor.document || contentChanges.length === 0) return

                for (const contentChange of snippetJustInserted ? [contentChanges[0]!] : contentChanges) {
                    const { range } = contentChange
                    const pos = range.start
                    if (pos[snippetCanExitByTyping ? 'isBefore' : 'isBeforeOrEqual'](editorExpectedEndPos) || snippetJustInserted) {
                        const diff = -(range.end.character - range.start.character) + contentChange.text.length
                        editorExpectedEndPos = editorExpectedEndPos.translate(0, diff)
                        updateDecoration()
                    }
                }

                snippetJustInserted = false
            },
            undefined,
            currentSessionDisposables,
        )
        window.onDidChangeTextEditorSelection(
            ({ textEditor, selections }) => {
                if (textEditor !== editor || !snippetCanExitByTyping || snippetJustInserted) return
                const sel = selections[0]!
                if (!sel.start.isEqual(sel.end)) return
                if (sel.start.isEqual(editorExpectedEndPos)) {
                    exitSnippetSession()
                }
            },
            undefined,
            currentSessionDisposables,
        )

        doInsert()
    })

    registerExtensionCommand('exitLoopSnippet', () => {
        exitSnippetSession()
    })
}
