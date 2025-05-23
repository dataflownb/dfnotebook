import {
  IOutputAreaModel,
  IOutputPrompt,
  OutputArea,
  OutputPrompt
} from '@jupyterlab/outputarea';
import { IOutputModel } from '@jupyterlab/rendermime';
import { ISessionContext } from '@jupyterlab/apputils';
import { Kernel, KernelMessage } from '@jupyterlab/services';
import * as nbformat from '@jupyterlab/nbformat';
import { JSONObject } from '@lumino/coreutils';
import { Panel, Widget } from '@lumino/widgets';
import { cellIdIntToStr } from '@dfnotebook/dfutils';


export interface IStreamWithExecCountMsg extends KernelMessage.IStreamMsg {
  content: {
    name: 'stdout' | 'stderr';
    text: string;
    execution_count?: number | null;
  };
}

export interface IErrorWithExecCountMsg extends KernelMessage.IErrorMsg {
  content: {
    ename: string;
    evalue: string;
    traceback: string[];
    execution_count?: number | null;
  };
}

export class DataflowOutputArea extends OutputArea {
  constructor(options: OutputArea.IOptions, cellId: string) {
    super({
      contentFactory: DataflowOutputArea.defaultContentFactory,
      ...options
    });
    this.cellId = cellId;
  }

  /**
   * The cellIdModelMap is a hack to map outputs to other cells.
   */
  static cellIdModelMap: { [key: string]: IOutputAreaModel } | undefined;

  /*
   * The cell's id
   */
  cellId: string;

  get future(): Kernel.IShellFuture<
    KernelMessage.IExecuteRequestMsg,
    KernelMessage.IExecuteReplyMsg
  > {
    return super.future;
  }

  set future(
    value: Kernel.IShellFuture<
      KernelMessage.IExecuteRequestMsg,
      KernelMessage.IExecuteReplyMsg
    >
  ) {
    super.future = value;
    super.future.onIOPub = this.onIOPub;
  }

  public onIOPub = (msg: KernelMessage.IIOPubMessage) => {
    const model = this.model;
    const msgType = msg.header.msg_type;
    let execCountMsg: KernelMessage.IExecuteResultMsg | KernelMessage.IDisplayDataMsg | IStreamWithExecCountMsg | IErrorWithExecCountMsg;
    let output: nbformat.IOutput;
    const transient = ((msg.content as any).transient || {}) as JSONObject;
    const displayId = transient['display_id'] as string;
    let targets: number[];
    
    switch (msgType) {
      case 'execute_result':
        execCountMsg = msg as KernelMessage.IExecuteResultMsg;
      case 'display_data':
        execCountMsg = msg as KernelMessage.IDisplayDataMsg;
      case 'stream':
        execCountMsg = msg as IStreamWithExecCountMsg;
      case 'error':
        execCountMsg = msg as IErrorWithExecCountMsg;        
        if (execCountMsg.content.execution_count) {
          const cellId = cellIdIntToStr(execCountMsg.content.execution_count);
          if (msgType === 'stream' || msgType === 'error') {
            delete execCountMsg.content.execution_count;
          }
          output = { ...execCountMsg.content, output_type: msgType };
          if (cellId != this.cellId) {
            if (DataflowOutputArea.cellIdModelMap) {
              const cellModel = DataflowOutputArea.cellIdModelMap[cellId];
              cellModel.add(output);
            }
          } else {
            model.add(output);
          }
        } else {
          output = { ...execCountMsg.content, output_type: msgType };
          model.add(output);
        }
        // FIXME do we have to do the displayId && msgType === 'display_data' stuff?
        // is this only for update-display-data?
        if (displayId && msgType === 'display_data') {
          //@ts-expect-error
          targets = this._displayIdMap.get(displayId) || [];
          targets.push(model.length - 1);
          //@ts-expect-error
          this._displayIdMap.set(displayId, targets);
        }
        break;
      default:
        //@ts-expect-error
        this._onIOPub(msg);
        break;
      };
  };

  protected createOutputItem(model: IOutputModel): Widget | null {
    const panel = super.createOutputItem(model) as Panel;
    if (panel) {
      if (model.metadata['output_tag']) {
        const prompt = panel.widgets[0] as DataflowOutputPrompt;
        prompt.outputTag = model.metadata['output_tag'] as string;
      }
    }
    return panel;
  }
}

export class DataflowOutputPrompt extends OutputPrompt {
  updatePrompt() {
    if (this._outputTag) {
      this.node.textContent = `${this._outputTag}:`;
    } else if (this.executionCount === null) {
      this.node.textContent = '';
    } else {
      const cellId = cellIdIntToStr(this.executionCount)
      // .substr(0, 3);
      this.node.textContent = `[${cellId}]:`;
    }
  }

  get executionCount(): nbformat.ExecutionCount {
    return super.executionCount;
  }
  set executionCount(value: nbformat.ExecutionCount) {
    super.executionCount = value;
    this.updatePrompt();
  }

  get outputTag(): string {
    return this._outputTag;
  }

  set outputTag(value: string) {
    this._outputTag = value;
    this.updatePrompt();
  }

  private _outputTag: string = '';
}

export namespace DataflowOutputArea {
  export async function execute(
    code: string,
    output: OutputArea,
    sessionContext: ISessionContext,
    metadata?: JSONObject,
    dfData?: JSONObject,
    cellIdModelMap?: { [key: string]: IOutputAreaModel },
    expectedUUID?: string
  ): Promise<KernelMessage.IExecuteReplyMsg | undefined> {
    // Override the default for `stop_on_error`.
    let stopOnError = true;
    if (
      metadata &&
      Array.isArray(metadata.tags) &&
      metadata.tags.indexOf('raises-exception') !== -1
    ) {
      stopOnError = false;
    }
    if (dfData === undefined) {
      // FIXME not sure if this works or not...
      dfData = {} as JSONObject;
    }

    dfData['expectedUUID'] = expectedUUID ?? null; 

    const content: KernelMessage.IExecuteRequestMsg['content'] = {
      code,
      stop_on_error: stopOnError,
      user_expressions: { __dfkernel_data__: dfData } as JSONObject
    };

    const kernel = sessionContext.session?.kernel;
    if (!kernel) {
      throw new Error('Session has no kernel.');
    }
    const future = kernel.requestExecute(content, false, metadata);
    output.future = future;

    DataflowOutputArea.cellIdModelMap = cellIdModelMap;
    
    return new Promise<KernelMessage.IExecuteReplyMsg>((resolve, reject) => {
      let handled = false;

      future.onReply = (reply: KernelMessage.IExecuteReplyMsg) => {
        if (handled) return;

        const replyExecutedUUID = (reply.content as any).executed_cell_uuid;
        const replyExpectedUUID = (reply.content as any).expected_UUID;
        const status = (reply.content as any).status;
    
        if (status !== 'ok' || replyExecutedUUID === replyExpectedUUID) {
          handled = true;
          resolve(reply);
        }
      };

      future.dispose = () => {
        if (!handled) {
          handled = true;
          reject(new Error('Canceled'));
        }
      };
    });
  }

  /**
   * The default implementation of `IContentFactory`.
   */
  export class ContentFactory extends OutputArea.ContentFactory {
    /**
     * Create the output prompt for the widget.
     */
    createOutputPrompt(): IOutputPrompt {
      return new DataflowOutputPrompt();
    }
  }

  export const defaultContentFactory = new ContentFactory();
}
