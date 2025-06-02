import {
  ICellModel,
  IInputPrompt,
  InputArea,
  InputPrompt
} from '@jupyterlab/cells';
import { IDataflowCodeCellModel } from './model';

export class DataflowInputArea extends InputArea {
  // kind of annoying as model still needs to be set later
  constructor(options: InputArea.IOptions) {
    super(options);
    (this.prompt as DataflowInputPrompt).model = this.model as IDataflowCodeCellModel | null;
  }

  get prompt(): DataflowInputPrompt {
    //@ts-ignore
    return this._prompt;
  }

  set prompt(value: DataflowInputPrompt) {
    (value as DataflowInputPrompt).model = this.model as IDataflowCodeCellModel | null;
    //@ts-ignore
    this._prompt = value;
  }

  public addTag(value: string) {
    const model = this.model as IDataflowCodeCellModel;
    model.cellName = value;
    this.prompt.updatePromptNode(this.prompt.executionCount);
  }

  public get tag(): string | undefined {
    const model = this.model as IDataflowCodeCellModel;
    return model.cellName
  }

  public setTagEnabled(value: boolean) {
    this.prompt.showTag = value;
    this.prompt.updatePromptNode(this.prompt.executionCount);
  }
}

export namespace DataflowInputArea {
  export class ContentFactory extends InputArea.ContentFactory {
    /**
     * Create an input prompt.
     */
    createInputPrompt(): IInputPrompt {
      return new DataflowInputPrompt();
    }
  }
}

export class DataflowInputPrompt extends InputPrompt {
  constructor(model: ICellModel | null = null) {
    super();
    this.model = model as IDataflowCodeCellModel | null;
  }

  public updatePromptNode(value: string | null) {
    if (this.showTag && this.cellName && value !== '*') {
      this.node.textContent = `[${this.cellName}]:`;
    } else if (value === null) {
      this.node.textContent = ' ';
    } else {
      this.node.textContent = `[${value || ' '}]:`;
    }
  }

  /**
   * The execution count for the prompt.
   */
  get executionCount(): string | null {
    return super.executionCount;
  }
  set executionCount(value: string | null) {
    super.executionCount = value;
    this.updatePromptNode(value);
  }

  get cellName(): string | undefined {
    return this.model?.cellName;
  }
  get tag(): string | undefined { // alias for cellName
    return this.cellName;
  }

  get model(): IDataflowCodeCellModel | null {
    return this._model;
  }

  set model(value: IDataflowCodeCellModel | null) {
    this._model = value;
    if (this._model) {
      this.updatePromptNode(this.executionCount);
    }
  }

  private _model: IDataflowCodeCellModel | null;
  public showTag: boolean = false;
}
