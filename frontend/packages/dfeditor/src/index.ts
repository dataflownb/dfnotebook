import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { INotebookTracker } from '@jupyterlab/notebook';
import { IEditorExtensionRegistry } from '@jupyterlab/codemirror';
import { ICommandPalette } from '@jupyterlab/apputils';
import { HighlightReferences, DfEditorContextMenu } from './codeRefNavigator';

export { DfEditorContextMenu };
export const dfeditorPlugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab-highlight-ref:plugin',
  description: 'A minimal JupyterLab extension adding a CodeMirror extension.',
  autoStart: true,
  requires: [IEditorExtensionRegistry, INotebookTracker, ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    extensions: IEditorExtensionRegistry,
    notebookTracker: INotebookTracker,
    palette: ICommandPalette
  ) => {
    HighlightReferences(app, extensions, notebookTracker);
  }
};