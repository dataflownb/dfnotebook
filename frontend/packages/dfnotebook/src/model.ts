// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { CellList, NotebookModel } from '@jupyterlab/notebook';
import * as nbformat from '@jupyterlab/nbformat';
import { DataflowCodeCellModel, IDataflowCellData, IDataflowCodeCellModel } from '@dfnotebook/dfcells';
import { PartialJSONObject } from '@lumino/coreutils';
import { ISharedCodeCell } from '@jupyter/ydoc';
import { ICellModel, ICodeCellModel } from '@jupyterlab/cells';
import { IObservableList } from '@jupyterlab/observables';


export interface IDataflowNotebookMetadata extends PartialJSONObject {
    enable_tags: boolean;
    enable_reactive: boolean;
}

function isValidName<T>(value: T | undefined): value is T {
  return value !== undefined && value !== '';
}

export class DataflowNotebookModel extends NotebookModel {
  constructor(options: NotebookModel.IOptions = {}) {
    super(options);

    this.cells.changed.connect(this.updateCodeCells, this);
    this.initializeDataflowMetadata();
  }

  // this is a hack because the CellList hardcodes CodeCellModel here
  // we want to replace it with DataflowCodeCellModel
  public updateCodeCells(cellList: CellList, change: IObservableList.IChangedArgs<ICellModel>) {
    if (change.type === 'set') {
      this.updateRemovedCells(change.oldValues);
      this.updateAddedCells(change.newValues);
    } else if (change.type === 'remove') {
      this.updateRemovedCells(change.oldValues);
    } else if (change.type === 'add') {
      this.updateAddedCells(change.newValues);
    }
  }

  public updateAddedCells(cells : ICellModel[]): void {
    cells.forEach((anyModel) => {
      if ((anyModel.type === 'code') && !(anyModel instanceof DataflowCodeCellModel)) {
        const curModel = anyModel as ICodeCellModel;
        const sharedModel = anyModel.sharedModel as ISharedCodeCell;
        const newModel = new DataflowCodeCellModel({ sharedModel });
        this.updateCodeCell(curModel, sharedModel, newModel);
      }
    });
  }

  public updateRemovedCells(cells: ICellModel[]): void {
    cells.forEach((anyModel) => {
      if ((anyModel?.type === 'code') && (anyModel instanceof DataflowCodeCellModel)) { 
        const curModel = anyModel as ICodeCellModel;
        DataflowNotebookModel.deleteCellModel(curModel.sharedModel);
        curModel.dispose();
      }
    });
  }

  public updateCodeCell(curModel: ICodeCellModel, sharedModel: ISharedCodeCell, newModel: IDataflowCodeCellModel) {
      //@ts-expect-error
      this.cells._cellMap.set(sharedModel, newModel);
      curModel.dispose();

      //@ts-expect-error
      sharedModel.changed.connect(newModel._onSharedModelChanged, newModel);

      sharedModel.disposed.connect(() => {
        newModel.dispose();
        //@ts-expect-error
        this.cells._cellMap.delete(sharedModel);
      });

      DataflowNotebookModel.registerCellModel(sharedModel, newModel);
      return newModel;
  }

  public initializeDataflowMetadata() {
      const dfmetadata = {
        enable_tags: true,
        enable_reactive: true
      };
      this.setDataflowMetadata(dfmetadata);    
  }

  public getDataflowMetadata(): IDataflowNotebookMetadata {
    if (!this.getMetadata('dfnotebook')) {
      this.initializeDataflowMetadata();
    }
    return this.getMetadata('dfnotebook') as IDataflowNotebookMetadata;
  }

  public setDataflowMetadata(metadata: IDataflowNotebookMetadata) {
      this.setMetadata('dfnotebook', metadata);
  }

  get codeCellModelArray(): IDataflowCodeCellModel[] {
    return Array.from(this.cells).filter(cell => cell.type === 'code').map(cell => cell as IDataflowCodeCellModel);
  }

  get codeCellModelMap(): { [cell_id: string]: IDataflowCodeCellModel } {
    const codeCellModelMap : { [cell_id: string]: IDataflowCodeCellModel } = {};
    for (const cell of this.codeCellModelArray) {
      codeCellModelMap[cell.cellId] = cell;
    }
    return codeCellModelMap;
  }

  get cellIdToNameMap(): Map<string, string> {
    return new Map(this.codeCellModelArray
      .filter(cell => isValidName(cell.cellName))
      .map(cell => [cell.cellId, cell.cellName] as [string, string])
    );
  }

  get cellNameToIdMap(): Map<string, string> {
    return new Map(this.codeCellModelArray
      .filter(cell => isValidName(cell.cellName))
      .map(cell => [cell.cellName, cell.cellId] as [string, string])
    );
  }

  get cellNames() : Set<string> {
    return new Set(this.codeCellModelArray.map(cell => cell.cellName).filter(isValidName));
  }
  // alias for cellNames
  get tags() : Set<string> { 
    return this.cellNames;
  }

  get enableTags(): boolean {
    return this.getDataflowMetadata().enable_tags as boolean || false;
  }

  set enableTags(value: boolean) {
    const dfmetadata = this.getDataflowMetadata();
    dfmetadata.enable_tags = value;
    this.setDataflowMetadata(dfmetadata);
  }

  get enableReactive(): boolean {
    return this.getDataflowMetadata().enable_reactive as boolean || false;
  }

  set enableReactive(value: boolean) {
    const dfmetadata = this.getDataflowMetadata();
    dfmetadata.enable_reactive = value;
    this.setDataflowMetadata(dfmetadata);
  }

  getDataflowCodeCellData() {
    const codeDataDict: { [cell_id: string]: IDataflowCellData } = {};
    this.codeCellModelArray.forEach(cell => {
        const cellData = cell.getDataflowCellData();
        codeDataDict[cellData.cell_id] = cellData;
    });
    return codeDataDict;
  }

  updateDataflowCodeCellData(codeCellData: { [cell_id: string]: IDataflowCellData }): void {
    this.sharedModel.transact(() => {
      if (codeCellData) {
        for (const cellModel of this.codeCellModelArray) {
          const cellData = codeCellData[cellModel.cellId];
          if (cellData)
            cellModel.updateDataflowCellData(cellData);
        }
      }
    });
  }

  updateDataflowCodeCellsFromMetadata() {
    for (const cellModel of this.codeCellModelArray)
      cellModel.updateDataflowCellFromMetadata();
  }

  fromJSON(value: nbformat.INotebookContent): void {
    let isDataflow = true;
    if (value.metadata?.kernelspec?.name && value.metadata.kernelspec.name != 'dfpython3') {
      isDataflow = false;
    }
    super.fromJSON(value);

    if (!isDataflow) {
      this.deleteMetadata('dfnotebook');
      return;
    }

    this.updateDataflowCodeCellsFromMetadata();
  }

}

export namespace DataflowNotebookModel {
  const cellModelRegistry = new Map<string, IDataflowCodeCellModel>();

  export function registerCellModel(shared: ISharedCodeCell, model: IDataflowCodeCellModel): void {
    cellModelRegistry.set(shared.id, model);
  }

  export function deleteCellModel(shared: ISharedCodeCell): void {
    cellModelRegistry.delete(shared.id);    
  }

  export function getCellModel(shared: ISharedCodeCell): IDataflowCodeCellModel | undefined {
    return cellModelRegistry.get(shared.id);
  }

}