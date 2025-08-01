// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Context, DocumentRegistry } from '@jupyterlab/docregistry';
import { INotebookContent } from '@jupyterlab/nbformat';
import {
  INotebookModel,
  Notebook as NotebookType,
  NotebookPanel as NotebookPanelType,
  //NotebookWidgetFactory
} from '@jupyterlab/notebook';
import {
  DataflowNotebook as Notebook,
  DataflowNotebookWidgetFactory as NotebookWidgetFactory
} from '@dfnotebook/dfnotebook';
import { NBTestUtils } from '@dfnotebook/dfnotebook/lib/testutils';
import * as defaultContent45 from './default-45.json';
import * as emptyContent from './empty.json';

export { DEFAULT_CONTENT } from '@dfnotebook/dfnotebook/lib/testutils';
export const DEFAULT_CONTENT_45: INotebookContent = defaultContent45;
export const EMPTY_CONTENT: INotebookContent = emptyContent;

/**
 * Local versions of the NBTestUtils that import from `src` instead of `lib`.
 */

/**
 * Create a default notebook content factory.
 */
export function createNotebookFactory(): NotebookType.IContentFactory {
  return NBTestUtils.createNotebookFactory();
}

/**
 * Create a default notebook panel content factory.
 */
export function createNotebookPanelFactory(): NotebookPanelType.IContentFactory {
  return NBTestUtils.createNotebookPanelFactory();
}

/**
 * Create a notebook widget.
 */
export function createNotebook(): Notebook {
  return NBTestUtils.createNotebook();
}

/**
 * Create a notebook panel widget.
 */
export function createNotebookPanel(
  context: Context<INotebookModel>
): NotebookPanelType {
  return NBTestUtils.createNotebookPanel(context);
}

/**
 * Populate a notebook with default content.
 */
export function populateNotebook(notebook: Notebook): void {
  NBTestUtils.populateNotebook(notebook);
}

export const editorFactory = NBTestUtils.editorFactory;
export const mimeTypeService = NBTestUtils.mimeTypeService;
export const defaultEditorConfig = NBTestUtils.defaultEditorConfig;
export const clipboard = NBTestUtils.clipboard;

export function defaultRenderMime(): any {
  return NBTestUtils.defaultRenderMime();
}

export function createNotebookWidgetFactory(
  toolbarFactory?: (widget: NotebookPanelType) => DocumentRegistry.IToolbarItem[]
): NotebookWidgetFactory {
  return NBTestUtils.createNotebookWidgetFactory(toolbarFactory);
}

/**
 * Create a context for a file.
 */
export async function createMockContext(
  startKernel = false
): Promise<Context<INotebookModel>> {
  return NBTestUtils.createMockContext(startKernel);
}
