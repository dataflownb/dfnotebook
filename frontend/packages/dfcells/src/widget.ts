import { Kernel, KernelMessage } from '@jupyterlab/services';
import {
  AttachmentsCell,
  Cell,
  CodeCell,
  IAttachmentsCellModel,
  ICellModel,
  ICodeCellModel,
  IInputPrompt,
  MarkdownCell,
  RawCell
} from '@jupyterlab/cells';
import { DataflowInputArea, DataflowInputPrompt } from './inputarea';
import { IOutputAreaModel, IOutputPrompt } from '@jupyterlab/outputarea';
import {
  DataflowOutputArea,
  DataflowOutputPrompt
} from '@dfnotebook/dfoutputarea';
import { cellIdIntToStr, truncateCellId } from '@dfnotebook/dfutils';
import { IChangedArgs } from '@jupyterlab/coreutils';
import { ISessionContext } from '@jupyterlab/apputils';
import { JSONObject } from '@lumino/coreutils';
import { Panel } from '@lumino/widgets';
import { NotebookPanel } from '@jupyterlab/notebook';

// FIXME need to add this back when dfgraph is working
import { Manager as GraphManager } from '@dfnotebook/dfgraph';
/**
 * The CSS class added to the cell input area.
 */
const CELL_INPUT_AREA_CLASS = 'jp-Cell-inputArea';

/**
 * The CSS class added to the cell output area.
 */
const CELL_OUTPUT_AREA_CLASS = 'jp-Cell-outputArea';

export const notebookCellMap = new Map<string, Map<string, string>>();

function setInputArea<T extends ICellModel = ICellModel>(cell: Cell) {
  // FIXME may be able to get panel via (this.layout as PanelLayout).widgets?
  //@ts-expect-error
  const inputWrapper = cell._inputWrapper as Panel;
  const input = cell.inputArea;

  // find the input area widget
  let inputIdx = -1;
  if (input) {
    const { id } = input;
    inputWrapper.widgets.forEach((widget, idx) => {
      if (widget.id === id) {
        inputIdx = idx;
      }
    });
  }

  const dfInput = new DataflowInputArea({
    model: cell.model,
    contentFactory: cell.contentFactory,
    editorOptions: { config: cell.editorConfig }
  });
  dfInput.addClass(CELL_INPUT_AREA_CLASS);

  inputWrapper.insertWidget(inputIdx, dfInput);
  input?.dispose();
  //@ts-expect-error
  cell._input = dfInput;
}

function setOutputArea(cell: CodeCell) {
  //@ts-expect-error
  const outputWrapper = cell._outputWrapper as Panel;
  const output = cell.outputArea;

  // find the output area widget
  const { id } = output;
  let outputIdx = -1;
  outputWrapper.widgets.forEach((widget, idx) => {
    if (widget.id === id) {
      outputIdx = idx;
    }
  });

  const dfOutput = new DataflowOutputArea(
    {
      model: cell.model.outputs,
      rendermime: output.rendermime,
      contentFactory: cell.contentFactory,
      maxNumberOutputs: output.maxNumberOutputs,
      //@ts-expect-error
      translator: output._translator,
      promptOverlay: true,
      //@ts-expect-error
      inputHistoryScope: output._inputHistoryScope
    },
    truncateCellId(cell.model.id)
  );

  dfOutput.addClass(CELL_OUTPUT_AREA_CLASS);

  output.toggleScrolling.disconnect(() => {
    cell.outputsScrolled = !cell.outputsScrolled;
  });
  dfOutput.toggleScrolling.connect(() => {
    cell.outputsScrolled = !cell.outputsScrolled;
  });

  // output.initialize.disconnect();
  // dfOutput.initialize.connect(() => {
  //   this.updatePromptOverlayIcon();
  // });

  output.outputLengthChanged.disconnect(
    //@ts-expect-error
    cell._outputLengthHandler,
    cell
  );
  //@ts-expect-error
  dfOutput.outputLengthChanged.connect(cell._outputLengthHandler, cell);

  outputWrapper.insertWidget(outputIdx, dfOutput);
  output.dispose();
  //@ts-expect-error
  cell._output = dfOutput;
}

function setDFMetadata(cell: CodeCell) {
  if (!cell.model.getMetadata('dfmetadata')){
    const dfmetadata = {
      tag: "",
      inputVars: { ref: {}, tag_refs: {} },
      outputVars: [],
      persistentCode: ""
    };
    cell.model.setMetadata('dfmetadata', dfmetadata);
  }
}

export class DataflowCell<T extends ICellModel = ICellModel> extends Cell<T> {
  protected initializeDOM(): void {
    super.initializeDOM();
    setInputArea(this);
    this.addClass('df-cell');
  }
}

export namespace DataflowCell {
  export class ContentFactory extends Cell.ContentFactory {
    /**
     * Create an input prompt.
     */
    createInputPrompt(): IInputPrompt {
      return new DataflowInputPrompt();
    }

    /**
     * Create the output prompt for the widget.
     */
    createOutputPrompt(): IOutputPrompt {
      return new DataflowOutputPrompt();
    }
  }
}

export class DataflowMarkdownCell extends MarkdownCell {
  protected initializeDOM(): void {
    super.initializeDOM();
    setInputArea(this);
    this.addClass('df-cell');
    if(this.model.getMetadata('dfmetadata')){
      this.model.deleteMetadata('dfmetadata')
    }
  }
}

export class DataflowRawCell extends RawCell {
  protected initializeDOM(): void {
    super.initializeDOM();
    setInputArea(this);
    this.addClass('df-cell');
    if(this.model.getMetadata('dfmetadata')){
      this.model.deleteMetadata('dfmetadata')
    }
  }
}

export abstract class DataflowAttachmentsCell<
  T extends IAttachmentsCellModel
> extends AttachmentsCell<T> {
  protected initializeDOM(): void {
    super.initializeDOM();
    setInputArea(this);
    this.addClass('df-cell');
  }
}

export class DataflowCodeCell extends CodeCell {
  protected initializeDOM(): void {
    super.initializeDOM();
    setInputArea(this);
    setOutputArea(this);
    this.setPromptToId();
    this.addClass('df-cell');
  }

  public setPromptToId() {
    // FIXME move this to a function to unify with the code in dfnotebook/actions.tsx
    this.setPrompt(`${truncateCellId(this.model.id) || ''}`);
  }

  initializeState(): this {
    super.initializeState();
    this.setPromptToId();
    setDFMetadata(this);
    this.model.contentChanged.connect(this._onContentChanged, this);
    return this;
  }

  protected onStateChanged(model: ICellModel, args: IChangedArgs<any>): void {
    super.onStateChanged(model, args);
    switch (args.name) {
      case 'executionCount':
        this.setPromptToId();
        break;
      default:
        break;
    }
  }

  private _onContentChanged(): void {
    let notebookpanelId = getNotebookId(this)

    if(notebookpanelId){
      const currentCode = this.model.sharedModel.getSource().trim();
      const cId = truncateCellId(this.model.sharedModel.getId());
      const executedCode = notebookCellMap.get(notebookpanelId)?.get(cId)?.trim();
      if (executedCode != ''){
        if(executedCode === currentCode){
          this.node.classList.add('df-cell-not-dirty');
        }
        else{
          this.node.classList.remove('df-cell-not-dirty');
        }
      }
    }
  }
}

export function getNotebookId(cell: DataflowCodeCell): string|undefined {
  let parent = cell.parent;
    while (parent) {
      if (parent instanceof NotebookPanel) {
        return parent.id;
      }
      parent = parent.parent;
    }
  return undefined;
}

export namespace DataflowCodeCell {
  /**
   * Execute a cell given a client session.
   */
  export async function execute(
    cell: DataflowCodeCell,
    sessionContext: ISessionContext,
    metadata?: JSONObject,
    dfData?: JSONObject,
    cellIdModelMap?: { [key: string]: ICodeCellModel }
  ): Promise<KernelMessage.IExecuteReplyMsg | void> {
    const model = cell.model;
    const code = model.sharedModel.getSource();
    if (!sessionContext.session?.kernel) {
      model.sharedModel.transact(() => {
        model.clearExecution();
      }, false);
      return;
    }
    const cellId = { cellId: model.sharedModel.getId() };
    metadata = {
      ...model.metadata,
      ...metadata,
      ...cellId
    };
    const { recordTiming } = metadata;
    model.sharedModel.transact(() => {
      model.clearExecution();
      cell.outputHidden = false;
    }, false);
    cell.setPrompt('*');
    model.trusted = true;
    let future:
      | Kernel.IFuture<
          KernelMessage.IExecuteRequestMsg,
          KernelMessage.IExecuteReplyMsg
        >
      | undefined;
    try {
      const cellIdOutputsMap: { [key: string]: IOutputAreaModel } = {};
      if (cellIdModelMap) {
        for (const cellId in cellIdModelMap) {
          cellIdOutputsMap[cellId] = cellIdModelMap[cellId].outputs;
        }
      }
      
      const msgPromise = DataflowOutputArea.execute(
        code,
        cell.outputArea,
        sessionContext,
        metadata,
        dfData,
        cellIdOutputsMap
      );

      // cell.outputArea.future assigned synchronously in `execute`
      if (recordTiming) {
        const recordTimingHook = (msg: KernelMessage.IIOPubMessage) => {
          let label: string;
          switch (msg.header.msg_type) {
            case 'status':
              label = `status.${
                (msg as KernelMessage.IStatusMsg).content.execution_state
              }`;
              break;
            case 'execute_input':
              label = 'execute_input';
              break;
            default:
              return true;
          }
          // If the data is missing, estimate it to now
          // Date was added in 5.1: https://jupyter-client.readthedocs.io/en/stable/messaging.html#message-header
          const value = msg.header.date || new Date().toISOString();
          const timingInfo: any = Object.assign(
            {},
            model.getMetadata('execution')
          );
          timingInfo[`iopub.${label}`] = value;
          model.setMetadata('execution', timingInfo);
          return true;
        };
        cell.outputArea.future.registerMessageHook(recordTimingHook);
      } else {
        model.deleteMetadata('execution');
      }

      const clearOutput = (msg: KernelMessage.IIOPubMessage) => {
        switch (msg.header.msg_type) {
          case 'execute_input':
            const executionCount = (msg as KernelMessage.IExecuteInputMsg)
              .content.execution_count;
            if (executionCount !== null) {
              const cellId = cellIdIntToStr(executionCount);
              if (cellIdModelMap) {
                const cellModel = cellIdModelMap[cellId];
                cellModel.sharedModel.setSource(
                  (msg as KernelMessage.IExecuteInputMsg).content.code
                );
                cellModel.outputs.clear();
              }
            }
            break;
          default:
            return true;
        }
        return true;
      };
      cell.outputArea.future.registerMessageHook(clearOutput);

      // Save this execution's future so we can compare in the catch below.
      future = cell.outputArea.future;
      const msg = (await msgPromise)!;
      model.executionCount = msg.content.execution_count;
      if (recordTiming) {
        const timingInfo = Object.assign(
          {},
          model.getMetadata('execution') as any
        );
        const started = msg.metadata.started as string;
        // Started is not in the API, but metadata IPyKernel sends
        if (started) {
          timingInfo['shell.execute_reply.started'] = started;
        }
        // Per above, the 5.0 spec does not assume date, so we estimate is required
        const finished = msg.header.date as string;
        timingInfo['shell.execute_reply'] =
          finished || new Date().toISOString();
        model.setMetadata('execution', timingInfo);
      }

      let content = (msg.content as any);
      let nodes = content.nodes;
      let uplinks = content.links;
      let cells = content.cells;
      let downlinks = content.imm_downstream_deps;
      let allUps = content.upstream_deps;
      let internalNodes = content.internal_nodes;
      let sessId = sessionContext.session.id;
      let graphUndefined = false;
      
      //Set information about the graph based on sessionid
      if(GraphManager.graphs[sessId] === undefined){
        GraphManager.createGraph(sessId);
        graphUndefined = true;
      }
      GraphManager.graphs[sessId].updateCellContents(dfData?.code_dict);
      GraphManager.graphs[sessId].updateGraph(cells,nodes,uplinks,downlinks,`${cell.model.id.substr(0, 8) || ''}`,allUps,internalNodes);
      if (!graphUndefined){
        GraphManager.updateDepViews(false);
      }

       if (content.update_downstreams) {
          GraphManager.graphs[sessId].updateDownLinks(content.update_downstreams);
      }

      return msg;
    } catch (e) {
      // If we started executing, and the cell is still indicating this
      // execution, clear the prompt.
      if (future && !cell.isDisposed && cell.outputArea.future === future) {
        // FIXME is this necessary?
        cell.setPromptToId();
      }
      throw e;
    }
  }
}
