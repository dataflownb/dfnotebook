import { cellIdStrToInt, truncateCellId } from '@dfnotebook/dfutils';
import {CodeCellModel, ICodeCellModel} from '@jupyterlab/cells';
import { PartialJSONObject } from '@lumino/coreutils';

// There are three types of code that exist for each cell:
// 1. code: code that is displayed in the cell,
//    stored in the shared model directly
// 2. persistent_code: code with all referenced variables attached to cells,
//    stored in the metadata
// 3. executed_code: code that was last executed, this is stored in the codecell model,
//    but we also stored it in the metadata

export interface IDataflowCellMetadata extends PartialJSONObject {
    persistent_code?: string;
    executed_code?: string;
    name?: string;
    output_tags: string[];
    input_refs: { [var_name: string]: string[] };
    auto_update: boolean;
    force_cached: boolean;
}

export interface IDataflowCellData extends IDataflowCellMetadata {
    cell_id: string;
    code: string;
}

export interface IDataflowCodeCellModel extends ICodeCellModel {
    getDataflowMetadata(): IDataflowCellMetadata;
    setDataflowMetadata(value: IDataflowCellMetadata) : void;

    getDataflowCellData(): IDataflowCellData;
    updateDataflowCellData(data: IDataflowCellData): void;
    updateDataflowCellFromMetadata(): void;

    get cellId(): string;

    get cellName(): string | undefined;
    set cellName(value: string | undefined);

    get persistentCode(): string | undefined;
    set persistentCode(value: string | undefined);

    get outputTags(): string[];
    set outputTags(value: string[]);

    get inputRefs(): { [var_name: string]: string[] };
    set inputRefs(value: { [var_name: string]: string[] });

    get autoUpdate(): boolean;
    set autoUpdate(value: boolean);

    get forceCached(): boolean;
    set forceCached(value: boolean);

    get executedCode(): string | undefined;
    set executedCode(value: string | undefined);

    get code(): string;
    set code(value: string);
}

export class DataflowCodeCellModel extends CodeCellModel implements IDataflowCodeCellModel {
    constructor(options: CodeCellModel.IOptions = {}) {
        super(options);
        if (! this.getDataflowMetadata())
            this.initializeDataflowMetadata();
    }

    public getDataflowMetadata(): IDataflowCellMetadata {
        return this.getMetadata('dfnotebook') as IDataflowCellMetadata;
    }

    public setDataflowMetadata(metadata: IDataflowCellMetadata) {
        this.setMetadata('dfnotebook', metadata);
    }

    public initializeDataflowMetadata() {
        const dfmetadata = {
            output_tags: [],
            input_refs: {},
            auto_update: true,
            force_cached: false
        };
        this.setDataflowMetadata(dfmetadata);    
    }

    public get cellId(): string {
        return truncateCellId(this.id);
    }

    public get executionCount(): number {
        return cellIdStrToInt(this.cellId);
    }
    
    public set executionCount(value: number) {
        return;        
    }

    public get cellName(): string | undefined {
        return this.getDataflowMetadata().name;
    }

    public set cellName(name: string) {
        const dfmetadata = this.getDataflowMetadata();
        if (name === undefined || name === null || name === '')
            dfmetadata.name = undefined;
        else
            dfmetadata.name = name;
        this.setDataflowMetadata(dfmetadata);
    }

    public get persistentCode(): string | undefined {
        return this.getDataflowMetadata().persistent_code;
    }

    public set persistentCode(code: string) {
        const dfmetadata = this.getDataflowMetadata();
        dfmetadata.persistent_code = code;
        this.setDataflowMetadata(dfmetadata);
    }

    public get inputRefs(): { [var_name: string]: string[] } {
        return this.getDataflowMetadata().input_refs;
    }

    public set inputRefs(inputRefs: { [var_name: string]: string[] }) {
        const dfmetadata = this.getDataflowMetadata();
        dfmetadata.input_refs = inputRefs;
        this.setDataflowMetadata(dfmetadata);
    }

    public get outputTags(): string[] {
        return this.getDataflowMetadata().output_tags;
    }

    public set outputTags(outputTags: string[]) {
        const dfmetadata = this.getDataflowMetadata();
        dfmetadata.output_tags = outputTags;
        this.setDataflowMetadata(dfmetadata);
    }

    public get autoUpdate(): boolean {
        return this.getDataflowMetadata().auto_update;
    }

    public set autoUpdate(autoUpdate: boolean) {
        const dfmetadata = this.getDataflowMetadata();
        dfmetadata.auto_update = autoUpdate;
        this.setDataflowMetadata(dfmetadata);
    }

    public get forceCached(): boolean {
        return this.getDataflowMetadata().force_cached;
    }

    public set forceCached(forceCached: boolean) {
        const dfmetadata = this.getDataflowMetadata();
        dfmetadata.force_cached = forceCached;
        this.setDataflowMetadata(dfmetadata);
    }

    public get executedCode(): string | undefined {
        //@ts-expect-error
        return this._executedCode;
    }

    public set executedCode(code: string | undefined) {
        const dfmetadata = this.getDataflowMetadata();
        dfmetadata.executed_code = code;
        this.setDataflowMetadata(dfmetadata);
        //@ts-expect-error
        this._executedCode = code;
    }

    public get code(): string {
        return this.sharedModel.getSource();
    }

    public set code(code: string) {
        if (code !== this.sharedModel.getSource()) {
            this.sharedModel.setSource(code);
        }
    }

    public getDataflowCellData(): IDataflowCellData {
        const cell_id = this.cellId; // this will be truncated from the original id...
        const code = this.sharedModel.getSource();
        const executed_code = this.executedCode;
        const dfmetadata = this.getDataflowMetadata();
        return {
            cell_id,
            code,
            executed_code,
            ...dfmetadata
        };
    }

    public updateDataflowCellData(data: IDataflowCellData) {
        const {cell_id, code, executed_code, ...dfmetadata} = data;
        this.setDataflowMetadata(dfmetadata);
        if (executed_code)
            this.executedCode = executed_code;
        if (code)
            this.code = code;
    }

    public updateDataflowCellFromMetadata() {
        const dfmetadata = this.getDataflowMetadata();
        if (dfmetadata.executed_code)
            this.executedCode = dfmetadata.executed_code;
    }
}
