// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { getCellModel } from './model';

import {
  CodeCell,
  MarkdownCell,
  RawCell,
} from '@jupyterlab/cells';
import { Notebook, StaticNotebook } from '@jupyterlab/notebook';

import {
  DataflowCell,
  DataflowCodeCell,
  DataflowMarkdownCell,
  DataflowRawCell,
  DataflowInputArea,
  DataflowCodeCellModel,
} from '@dfnotebook/dfcells';
import { DataflowNotebookModel } from './model';

/**
 * The namespace for the `StaticNotebook` class statics.
 */
export namespace DataflowStaticNotebook {

  /**
   * The default implementation of an `IContentFactory`.
   */
   export class ContentFactory extends DataflowCell.ContentFactory implements StaticNotebook.IContentFactory {
    /**
     * Create a new code cell widget.
     *
     * #### Notes
     * If no cell content factory is passed in with the options, the one on the
     * notebook content factory is used.
     */
    createCodeCell(
      options: CodeCell.IOptions    
    ): CodeCell {      
      if (!options.contentFactory) {
        options.contentFactory = this;
      }
      options.model = getCellModel(options.model.sharedModel) as DataflowCodeCellModel;
      return new DataflowCodeCell(options).initializeState();
    }

    /**
     * Create a new markdown cell widget.
     *
     * #### Notes
     * If no cell content factory is passed in with the options, the one on the
     * notebook content factory is used.
     */
    createMarkdownCell(
      options: MarkdownCell.IOptions,
    ): MarkdownCell {
      if (!options.contentFactory) {
        options.contentFactory = this;
      }
      return new DataflowMarkdownCell(options).initializeState();
    }

    /**
     * Create a new raw cell widget.
     *
     * #### Notes
     * If no cell content factory is passed in with the options, the one on the
     * notebook content factory is used.
     */
    createRawCell(options: RawCell.IOptions): RawCell {
      if (!options.contentFactory) {
        options.contentFactory = this;
      }
      return new DataflowRawCell(options).initializeState();
    }
  }
}

export class DataflowNotebook extends Notebook { 
  constructor(options: Notebook.IOptions) {
    super(options);
  }

  public initializeState() {
    this.model?.cells.changed.connect((sender, args) => {
      if (args.type === 'add')
        this.updateTagState([args.newIndex]);
    });
    this.updateTagState();
  }

  public updateTagState(indices?: number[]) {
    const tagsEnabled = (this.model as DataflowNotebookModel).enableTags;
    if (indices === undefined)
      indices = Array.from(this.widgets.keys());
    for (const index of indices) {
      let count = 0;
      // this approach is used because the model added triggers
      // the cell widget to be created, and that can take
      // a few signals to complete
      const setInputAreaTagEnabled = () => {
        const cell = this.widgets[index];
        if (cell.inputArea) {
          const inputArea = cell.inputArea as DataflowInputArea;
          inputArea.setTagEnabled(tagsEnabled);        
        } else if (count < 10) {
          count++;
          requestAnimationFrame(setInputAreaTagEnabled);
        } else {
          console.warn("Cannot set tag enabled on input area because inputArea is not defined");
        }
        return false;
      }
      requestAnimationFrame(setInputAreaTagEnabled);
    }
  }
      
  public toggleTagEnabled() {
    const model = this.model as DataflowNotebookModel;
    model.enableTags = !model.enableTags;
    this.updateTagState()    
  }
}

export namespace DataflowNotebook {
  /**
   * The default implementation of a notebook content factory..
   *
   * #### Notes
   * Override methods on this class to customize the default notebook factory
   * methods that create notebook content.
   */
  export class ContentFactory extends DataflowStaticNotebook.ContentFactory {}
}
