import { Dialog, ISessionContext, showDialog } from '@jupyterlab/apputils';
import {
    CodeCell,
    CodeCellModel,
  type Cell,
  type ICodeCellModel,
  type MarkdownCell
} from '@jupyterlab/cells';
import type { KernelMessage } from '@jupyterlab/services';
import { nullTranslator } from '@jupyterlab/translation';
import { findIndex } from '@lumino/algorithm';
import { KernelError, INotebookModel, INotebookCellExecutor } from '@jupyterlab/notebook';
import { DataflowCodeCell } from '@dfnotebook/dfcells';
import { DataflowNotebookModel } from './model';
import { Manager as GraphManager } from '@dfnotebook/dfgraph';
import { truncateCellId } from '@dfnotebook/dfutils';

/**
 * Run a single notebook cell.
 *
 * @param options Cell execution options
 * @returns Execution status
 */
  export async function runCell({
    cell,
    notebook,
    notebookConfig,
    onCellExecuted,
    onCellExecutionScheduled,
    sessionContext,
    sessionDialogs,
    translator
  }: INotebookCellExecutor.IRunCellOptions): Promise<boolean> {
    translator = translator ?? nullTranslator;
    const trans = translator.load('jupyterlab');
    switch (cell.model.type) {
      case 'markdown':
        (cell as MarkdownCell).rendered = true;
        cell.inputHidden = false;
        onCellExecuted({ cell, success: true });
        break;
      case 'code':
        if (sessionContext) {
          if (sessionContext.isTerminating) {
            await showDialog({
              title: trans.__('Kernel Terminating'),
              body: trans.__(
                'The kernel for %1 appears to be terminating. You can not run any cell for now.',
                sessionContext.session?.path
              ),
              buttons: [Dialog.okButton()]
            });
            break;
          }
          if (sessionContext.pendingInput) {
            await showDialog({
              title: trans.__('Cell not executed due to pending input'),
              body: trans.__(
                'The cell has not been executed to avoid kernel deadlock as there is another pending input! Submit your pending input and try again.'
              ),
              buttons: [Dialog.okButton()]
            });
            return false;
          }
          if (sessionContext.hasNoKernel) {
            const shouldSelect = await sessionContext.startKernel();
            if (shouldSelect && sessionDialogs) {
              await sessionDialogs.selectKernel(sessionContext);
            }
          }
          
          if (sessionContext.hasNoKernel) {
            cell.model.sharedModel.transact(() => {
              (cell.model as ICodeCellModel).clearExecution();
            });
            return true;
          }

          const deletedCells = notebook.deletedCells;
         
          onCellExecutionScheduled({ cell });

          let ran = false;
          try {
            let reply: KernelMessage.IExecuteReplyMsg | void;
            // !!! DATAFLOW NOTEBOOK CODE !!!
            if (notebook instanceof DataflowNotebookModel) {
              const cellUUID =  truncateCellId(cell.model.id);
              let dfData = getCellsMetadata(notebook, cellUUID)
            
              if(!notebook.getMetadata('enable_tags')){
                dfData.dfMetadata.input_tags={};
              }

              reply = await DataflowCodeCell.execute(
                  cell as DataflowCodeCell,
                  sessionContext,
                  {
                  deletedCells,
                  recordTiming: notebookConfig.recordTiming
                  },
                  dfData.dfMetadata,
                  dfData.cellIdModelMap
              );
              
              resetCellPrompt(notebook, cell)
              
              if (reply) {
                await updateDataflowMetadata(notebook, reply);
              }

              if (sessionContext?.session?.kernel) {
                await dfCommPostData(notebook as DataflowNotebookModel, sessionContext);
                
                let sessId = sessionContext.session.id;
                let dfData = getCellsMetadata(notebook, cellUUID);
                GraphManager.graphs[sessId].updateCellContents(dfData.dfMetadata.code_dict);
              }
            } 
            else {
              reply = await CodeCell.execute(
                cell as CodeCell,
                sessionContext,
                {
                    deletedCells,
                    recordTiming: notebookConfig.recordTiming
                }
              );
            }
            // !!! END DATAFLOW NOTEBOOK CODE !!!

            deletedCells.splice(0, deletedCells.length);

            ran = (() => {
              if (cell.isDisposed) {
                return false;
              }

              if (!reply) {
                return true;
              }
              if (reply.content.status === 'ok') {
                const content = reply.content;

                if (content.payload && content.payload.length) {
                  handlePayload(content, notebook, cell);
                }

                return true;
              } else {
                throw new KernelError(reply.content);
              }
            })();
          } catch (reason) {
            if (cell.isDisposed || reason.message.startsWith('Canceled')) {
              ran = false;
            } else {
              onCellExecuted({
                cell,
                success: false,
                error: reason
              });
              throw reason;
            }
          }

          if (ran) {
            onCellExecuted({ cell, success: true });
          }

          return ran;
        }
        cell.model.sharedModel.transact(() => {
          (cell.model as ICodeCellModel).clearExecution();
        }, false);
        break;
      default:
        break;
    }

    return Promise.resolve(true);
  }

  async function dfCommPostData(notebook: DataflowNotebookModel, sessionContext: ISessionContext): Promise<void> {
    const dfData = getCellsMetadata(notebook, '');
    
    if (!notebook.getMetadata('enable_tags')) {
      dfData.dfMetadata.input_tags = {};
    }

    try {
      const response = await dfCommGetData(sessionContext, {'dfMetadata': dfData.dfMetadata, 'updateExecutedCode': true});
      if (response?.code_dict && Object.keys(response.code_dict).length > 0) {
        await updateNotebookCells(notebook, response);
      }
    } catch (error) {
      console.error('Error during kernel communication:', error);
    }
  }

  export async function dfCommGetData(sessionContext: ISessionContext, commData: any): Promise<any> {
    return new Promise<void>((resolve) => {
      const comm = sessionContext.session?.kernel?.createComm('dfcode');
      if (!comm) {
        resolve();
        return;
      }
      comm.open();
      comm.send(commData);
      comm.onMsg = (msg: any) => {
        const content = msg.content.data;
        resolve(content);
      };
    });
  }

  async function updateNotebookCells(notebook: DataflowNotebookModel, content: { [key: string]: any }) {
    const cellsArray = Array.from(notebook.cells);
    cellsArray.forEach(cell => {
      if (cell.type === 'code') {
        const cId = truncateCellId(cell.id);
        const cAny = cell as ICodeCellModel;
        
        if (content.code_dict.hasOwnProperty(cId)) {
          //updating last executed code of cell in cellMap first to maintain dfcell dirty state
          if (content.executed_code_dict?.hasOwnProperty(cId)) {
            //@ts-expect-error
            (cell as CodeCellModel)._executedCode = content.executed_code_dict[cId];
          }
          cAny.sharedModel.setSource(content.code_dict[cId]);
        }
      }
    });
  }

  async function updateDataflowMetadata(notebook: DataflowNotebookModel, reply: KernelMessage.IExecuteReplyMsg): Promise<void> {
    const content = reply?.content as any;

    if (!content) return;

    const allTags = getAllTags(notebook);
    const cellsArray = Array.from(notebook.cells);

    cellsArray.forEach((cell, index) => {
      if (cell.type === 'code') {
        updateCellMetadata(cell as CodeCellModel, content, allTags);
      }
    });
  }

  function updateCellMetadata(cellModel: CodeCellModel, content: any, allTags: { [key: string]: string }): void {
    const cId = truncateCellId(cellModel.id);
    const dfmetadata = cellModel.getMetadata('dfmetadata') || {};

    if (content.persistent_code?.[cId]) {
      dfmetadata.persistentCode = content.persistent_code[cId];
    }

    if (content.identifier_refs?.[cId]) {
      const refs = content.identifier_refs[cId];
      dfmetadata.inputVars = {
        ref: refs,
        tag_refs: mapTagsToRefs(refs, allTags)
      };

      let cellOutputTags: string[] = [];
      for (let i = 0; i < cellModel.outputs.length; ++i) {
        const out = cellModel.outputs.get(i);
        if(out.metadata['output_tag']){
          cellOutputTags.push(out.metadata['output_tag'] as string);
        }
      }
      dfmetadata.outputVars = cellOutputTags;
      const currSource = cellModel.sharedModel.getSource();
      //@ts-expect-error
      cellModel._executedCode = currSource;
      cellModel.sharedModel.setSource(currSource)
    }
    cellModel.setMetadata('dfmetadata', dfmetadata);
  }

  function mapTagsToRefs(refs: { [key: string]: any }, allTags: { [key: string]: string }): { [key: string]: string } {
    const tagRefs: { [key: string]: string } = {};

    Object.keys(refs).forEach(key => {
      if (allTags[key]) {
        tagRefs[key] = allTags[key];
      }
    });

    return tagRefs;
  }

  function resetCellPrompt(notebook: DataflowNotebookModel, cell: Cell) {
    const currInputArea = cell.inputArea as any;
    const dfmetadata = cell.model?.getMetadata('dfmetadata');
    const currTag = dfmetadata.tag;
    if(currInputArea){
      if(!notebook.getMetadata('enable_tags')){
        currInputArea.addTag("");
        cell.model?.setMetadata('dfmetadata', dfmetadata);
      }
      else{
        currInputArea.addTag(currTag);
      }
    }
  }

  export function getAllTags(notebook: DataflowNotebookModel): { [key: string]: string } {
    const allTags: { [key: string]: string } = {};
    const cellsArray = Array.from(notebook.cells);

    cellsArray.forEach(cell => {
      if (cell.type === 'code') {
        const dfmetadata = cell.getMetadata('dfmetadata');
        const tag = dfmetadata?.tag;
        if (tag) {
          const cId = truncateCellId(cell.id);
          allTags[cId] = tag;
        }
      }
    });

    return allTags;
  }

  export function getCellsMetadata(notebook: DataflowNotebookModel, cellUUID: string) {
    const codeDict: { [key: string]: string } = {};
    const cellIdModelMap: { [key: string]: any } = {};
    const outputTags: { [key: string]: string[] } = {};
    const inputTags: { [key: string]: string } = {};
    const allRefs: { [key: string]: { [key: string]: string[] } } = {};
    const executedCode: { [key: string]: string } = {};
    const autoUpdateFlags: { [key: string]: boolean } = {};
    const forceCachedFlags: { [key: string]: boolean } = {};
    const cellsArray = Array.from(notebook.cells);

    const reactiveEnabled = notebook.getMetadata('enable_reactive') ?? false;
    cellsArray.forEach(cell => {
      if (cell.type === 'code') {
        const c = cell as ICodeCellModel;
        const cId = truncateCellId(c.id);
        const dfmetadata = c.getMetadata('dfmetadata');
        if(!dfmetadata.persistentCode && cId != cellUUID)
        {
          cellIdModelMap[cId] = c;
          return;
        }
        const inputTag = dfmetadata?.tag;

        if (inputTag) {
          inputTags[inputTag] = cId;
        }

        codeDict[cId] = c.sharedModel.getSource();
        cellIdModelMap[cId] = c;
        outputTags[cId] = dfmetadata.outputVars;
        allRefs[cId] = dfmetadata.inputVars;
        //@ts-expect-error
        executedCode[cId] = (cell as CodeCellModel)._executedCode;      
        autoUpdateFlags[cId] = reactiveEnabled && dfmetadata.isReactive;
        forceCachedFlags[cId] = reactiveEnabled && (! dfmetadata.isReactive);
      }
    });

    const dfMetadata = {
      // FIXME replace with utility function (see dfcells/widget)
      uuid: cellUUID,
      code_dict: codeDict,
      output_tags: outputTags,
      input_tags: inputTags,
      auto_update_flags: autoUpdateFlags,
      force_cached_flags: forceCachedFlags,
      all_refs: allRefs,
      executed_code: executedCode
    };
    return { dfMetadata, cellIdModelMap };
  }

  /**
   * Handle payloads from an execute reply.
   *
   * #### Notes
   * Payloads are deprecated and there are no official interfaces for them in
   * the kernel type definitions.
   * See [Payloads (DEPRECATED)](https://jupyter-client.readthedocs.io/en/latest/messaging.html#payloads-deprecated).
   */
  function handlePayload(
    content: KernelMessage.IExecuteReply,
    notebook: INotebookModel,
    cell: Cell
  ) {
    const setNextInput = content.payload?.filter(i => {
      return (i as any).source === 'set_next_input';
    })[0];

    if (!setNextInput) {
      return;
    }

    const text = setNextInput.text as string;
    const replace = setNextInput.replace;

    if (replace) {
      cell.model.sharedModel.setSource(text);
      return;
    }

    // Create a new code cell and add as the next cell.
    const notebookModel = notebook.sharedModel;
    const cells = notebook.cells;
    const index = findIndex(cells, model => model === cell.model);

    // While this cell has no outputs and could be trusted following the letter
    // of Jupyter trust model, its content comes from kernel and hence is not
    // necessarily controlled by the user; if we set it as trusted, a user
    // executing cells in succession could end up with unwanted trusted output.
    if (index === -1) {
      notebookModel.insertCell(notebookModel.cells.length, {
        cell_type: 'code',
        source: text,
        metadata: {
          trusted: false
        }
      });
    } else {
      notebookModel.insertCell(index + 1, {
        cell_type: 'code',
        source: text,
        metadata: {
          trusted: false
        }
      });
    }
  }