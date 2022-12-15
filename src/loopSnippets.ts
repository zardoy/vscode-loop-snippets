import { getExtensionSetting, registerExtensionCommand, showQuickPick } from 'vscode-framework'
import { getActiveRegularEditor } from '@zardoy/vscode-utils'

import { window, DecorationRangeBehavior, SnippetString, commands, Range, workspace, Position, Selection } from 'vscode'
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

    type SimpleSnippetOptions = {
        wrap: string | undefined
        separator: string
        /**
         * If true, then snippet can be exited by typing
         * @default false
         */
        onlyMidCompletions?: boolean
    }

    registerExtensionCommand('insertLoopSnippet', async (_, argSnippet?: Partial<SimpleSnippetOptions>) => {
        const editor = getActiveRegularEditor()
        if (!editor) return

        if (currentSnippetSessionHandle) {
            currentSnippetSessionHandle()
            return
        }

        const toOffset = (pos: Position) => editor.document.offsetAt(pos)
        const toPos = (offset: number) => editor.document.positionAt(offset)

        const simpleSnippetVariants: Record<string, SimpleSnippetOptions> = {
            "'' | ": {
                wrap: "'$1'",
                separator: ' | ',
                onlyMidCompletions: true,
            },
            ' && ': {
                wrap: undefined,
                separator: ' && ',
            },
            ' || ': {
                wrap: undefined,
                separator: ' || ',
            },
            ', ': {
                wrap: undefined,
                separator: ', ',
            },
        }

        const selectedVariant =
            argSnippet?.wrap !== undefined && argSnippet.separator !== undefined
                ? argSnippet
                : await showQuickPick(
                      Object.entries(simpleSnippetVariants).map(([key, value]) => ({
                          label: key,
                          value,
                      })),
                      {
                          title: 'Select simple loop snippet',
                      },
                  )
        if (!selectedVariant) return
        // todo-low multicursor support
        const selectedContentUsed = !selectedVariant.wrap && getExtensionSetting('useSelectedContentAsSnippet')
        const defaultWrapSnippet = selectedContentUsed ? editor.document.getText(editor.selection) : ''
        const { wrap: wrapSnippet = defaultWrapSnippet, separator, onlyMidCompletions } = selectedVariant
        const showExitMarker = getExtensionSetting('showExitMarker')
        const triggerCompletions = getExtensionSetting('triggerCompletions')
        const snippetCanExitByTyping = showExitMarker && !!onlyMidCompletions

        if (selectedContentUsed) {
            editor.selection = new Selection(editor.selection.end, editor.selection.end)
        }

        /** controls seperator insertion */
        let firstInsert = !selectedContentUsed
        let expectedEndOffset = toOffset(editor.selection.active)
        let snippetJustInserted = false
        const doInsert = async () => {
            const snippetToInsert = firstInsert ? wrapSnippet : separator + wrapSnippet
            if (snippetToInsert) {
                snippetJustInserted = true
                await editor.insertSnippet(new SnippetString(snippetToInsert), firstInsert ? undefined : toPos(expectedEndOffset))
            }

            if (triggerCompletions) {
                void commands.executeCommand('editor.action.triggerSuggest')
            }

            firstInsert = false
        }

        currentSnippetSessionHandle = () => {
            void doInsert()
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
            const pos = toPos(expectedEndOffset)
            editor.setDecorations(decoration, [{ range: new Range(pos, pos) }])
        }

        if (!snippetCanExitByTyping) updateDecoration()

        workspace.onDidChangeTextDocument(
            ({ document, contentChanges }) => {
                if (document !== editor.document || contentChanges.length === 0) return

                for (const contentChange of snippetJustInserted ? [contentChanges[0]!] : contentChanges) {
                    const { range } = contentChange
                    const startOffset = toOffset(range.start)

                    if (startOffset < expectedEndOffset || (!snippetCanExitByTyping && startOffset === expectedEndOffset) || snippetJustInserted) {
                        const diff = -contentChange.rangeLength + contentChange.text.length
                        expectedEndOffset += diff
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
                if (sel.start.isEqual(toPos(expectedEndOffset))) {
                    exitSnippetSession()
                }
            },
            undefined,
            currentSessionDisposables,
        )

        void doInsert()
    })

    registerExtensionCommand('exitLoopSnippet', () => {
        exitSnippetSession()
    })
}
