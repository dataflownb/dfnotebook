import { SessionContext, ISessionContext } from '@jupyterlab/apputils';
import { createSessionContext } from '@jupyterlab/apputils/lib/testutils';
import { JupyterServer } from '@jupyterlab/testing';
import * as utils from './utils';
import { Context } from '@jupyterlab/docregistry';
import { INotebookModel, NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import * as nbformat from '@jupyterlab/nbformat';
import { ICodeCellModel } from '@jupyterlab/cells';
import { truncateCellId } from '@dfnotebook/dfutils';
import { DataflowNotebookModel } from '@dfnotebook/dfnotebook';
import { IDataflowCodeCellModel } from '@dfnotebook/dfcells';
import { addCellName, removeCellName }  from '../../dfnotebook-extension/src/index';

import { describe, afterAll, beforeAll, beforeEach, afterEach, it, expect } from '@jest/globals';

const server = new JupyterServer();

beforeAll(async () => {
  await server.start({'additionalKernelSpecs':{'dfpython3':{'argv':['python','-m','dfnotebook.kernel','-f','{connection_file}'],'display_name':'DFPython 3','language':'python'}}});
}, 30000);

afterAll(async () => {
  await server.shutdown();
});

describe('@dfnotebook/cellExecutor', () => {
  let sessionContext: ISessionContext;
  let context: Context<INotebookModel>;
  let panel: NotebookPanel;
  
  beforeAll(async function () {
    sessionContext = await createSessionContext(
      {'kernelPreference':
      {'name':'dfpython3','autoStartDefault':true,'shouldStart':true}});
  
    await (sessionContext as SessionContext).initialize();
    await sessionContext.session?.kernel?.info;
    await sessionContext.session?.id;
    await sessionContext.startKernel();
  }, 30000);

      
  beforeEach(async () => {
    let notebookContent: nbformat.INotebookContent = {
      metadata: {
        kernelspec: {
          name: 'dfpython3',
          display_name: 'DFPython 3'
        },
      },
      cells: [],
      nbformat: 4,
      nbformat_minor: 5,
    };
    
    context = await utils.createMockContext(true);
    context.model.fromJSON(notebookContent);
    
    panel = utils.createNotebookPanel(context);
    panel.id = 'mock-notebook-panel';
    panel.content.model = context.model as DataflowNotebookModel;
    
  });

  afterEach(() => {
    panel?.dispose();
    utils.clipboard.clear();
  });

  afterAll(async () => {
    await Promise.all([
      sessionContext.shutdown()
    ]);
  });

  describe('uuid reference', () => {
    it('uuid not added for identifier if exported once', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);  // true when execution succeeds
  
      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'b=a+9',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
      
      // verifies no ref UUID is added for identifier 'a' since it is exported only once
      const cell =  panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(cell.outputs.length).toBe(1);
      expect(cell.outputs.get(0).data['text/plain']).toBe('18');
      expect(cell.sharedModel.getSource()).toBe('b=a+9');
    });
  
    it('uuid for identifier is retained in case of ambiguity', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      const firstCell = panel.content.model?.cells.get(0) as ICodeCellModel;
      const refId = truncateCellId(firstCell.id);
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);  // true when execution succeeds
  
      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'a=5\ntest=a+99\nb=a$'+refId+'+99',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // verifies UUID is retained in case of ambiguity
      const lastExecutedCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(lastExecutedCell.sharedModel.getSource()).toBe('a=5\ntest=a+99\nb=a$'+refId+'+99');
    });
  
    it('uuid for identifier is retained if exported more than once', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);  // true when execution succeeds
  
      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'b=a+9',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // code cell 3
      panel.content.model?.sharedModel.insertCell(2, {
        cell_type: 'code',
        source: 'a=99',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[2]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // verifies UUID is added for identifier 'a' since it is exported twice
      const firstCell = panel.content.model?.cells.get(0) as ICodeCellModel;
      const refId = truncateCellId(firstCell.id);
      const secondCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(secondCell.sharedModel.getSource()).toBe('b=a$'+refId+'+9');
    });
  
    it('uuid removed if identifier exported once (case delete cell)', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);  // true when execution succeeds
  
      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'b=a+9',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // code cell 3
      panel.content.model?.sharedModel.insertCell(2, {
        cell_type: 'code',
        source: 'a=99',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[2]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // verifies UUID is added for identifier 'a' since it is exported twice
      const firstCell = panel.content.model?.cells.get(0) as ICodeCellModel;
      const refId = truncateCellId(firstCell.id);
      let secondCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(secondCell.sharedModel.getSource()).toBe('b=a$'+refId+'+9');
  
      //deleting code cell 3
      panel.content.model?.sharedModel.deleteCell(2)
  
      panel.content.select(panel.content.widgets[0]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      secondCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(secondCell.sharedModel.getSource()).toBe('b=a+9');
    });

    it('uuid removed if identifier exported once (case change in code)', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);  // true when execution succeeds
  
      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'b=a+9',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // code cell 3
      panel.content.model?.sharedModel.insertCell(2, {
        cell_type: 'code',
        source: 'a=99',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[2]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // verifies UUID is added for identifier 'a' since it is exported twice
      const firstCell = panel.content.model?.cells.get(0) as ICodeCellModel;
      const refId = truncateCellId(firstCell.id);
      let secondCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(secondCell.sharedModel.getSource()).toBe('b=a$'+refId+'+9');
  
      //updating code cell 3
      panel.content.select(panel.content.widgets[2]);
      const thirdCell = panel.content.model?.cells.get(2) as ICodeCellModel;
      thirdCell.sharedModel.setSource('');
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      panel.content.select(panel.content.widgets[0]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      secondCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(secondCell.sharedModel.getSource()).toBe('b=a+9');
    });
  
    it('uuid is added to identifers when exported variable is deleted', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);  // true when execution succeeds
  
      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'b=a+9',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      let secondCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(secondCell.sharedModel.getSource()).toBe('b=a+9');
  
      const firstCell = panel.content.model?.cells.get(0) as ICodeCellModel;
      const refId = truncateCellId(firstCell.id);
      
      //deleting code code cell 1
      panel.content.model?.sharedModel.deleteCell(0)
  
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
      
      // verifies UUID is added when identifier is deleted or removed
      let cell = panel.content.model?.cells.get(0) as ICodeCellModel;
      expect(cell.sharedModel.getSource()).toBe('b=a$'+refId+'+9');
    });
  });

  describe('tag reference', () => {
    it('tag can be used as reference', async () =>{
       // code cell 1
       panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);  // true when execution succeeds

      //add tag
      panel.content.select(panel.content.widgets[0]);
      const firstCell = panel.content.widgets[0].model as IDataflowCodeCellModel;
      firstCell.cellName = "testTag";
      
      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'a=5\ntest=a+99\nb=a$testTag+99',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // verifies UUID is retained in case of ambiguity
      const lastExecutedCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(lastExecutedCell.outputs.length).toBe(1);
      expect(lastExecutedCell.outputs.get(0).data['text/plain']).toBe('108');
      expect(lastExecutedCell.sharedModel.getSource()).toBe('a=5\ntest=a+99\nb=a$testTag+99');
    });

    it('adding tag should update references', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);  // true when execution succeeds
  
      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'b=a+9',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // code cell 3
      panel.content.model?.sharedModel.insertCell(2, {
        cell_type: 'code',
        source: 'c=a+99\nb=a+c\na="xyz"\na',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[2]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // verifies UUID is added for identifier 'a' since it is exported twice
      let firstCell = panel.content.model?.cells.get(0) as ICodeCellModel;
      const refId = truncateCellId(firstCell.id);

      let secondCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(secondCell.sharedModel.getSource()).toBe('b=a$'+refId+'+9');

      let thirdCell = panel.content.model?.cells.get(2) as ICodeCellModel;
      expect(thirdCell.sharedModel.getSource()).toBe('c=a$'+refId+'+99\nb=a$'+refId+'+c\na=\"xyz\"\na');

      //add tag
      panel.content.select(panel.content.widgets[0]);
      let cell = panel.content.widgets[0].model as IDataflowCodeCellModel;
      await addCellName(panel.content.model as DataflowNotebookModel, sessionContext, cell, "testTag");
      
      // verifies tag is added for identifier references of 'a'
      secondCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(secondCell.sharedModel.getSource()).toBe('b=a$testTag+9');

      thirdCell = panel.content.model?.cells.get(2) as ICodeCellModel;
      expect(thirdCell.sharedModel.getSource()).toBe('c=a$testTag+99\nb=a$testTag+c\na=\"xyz\"\na');
    });

    it('deleting tag should should update references with uuid', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);

      //add tag
      panel.content.select(panel.content.widgets[0]);
      let firstCell = panel.content.widgets[0].model as IDataflowCodeCellModel;
      const refId = firstCell.cellId;
      firstCell.cellName = "testTag";

      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'b=a+9',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
      
      // code cell 3
      panel.content.model?.sharedModel.insertCell(2, {
        cell_type: 'code',
        source: 'c=a+99\nb=a+c\na="xyz"\na',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[2]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);

      // verify tag is used inplace of uuid
      let secondCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(secondCell.sharedModel.getSource()).toBe('b=a$testTag+9');
  
      let thirdCell = panel.content.model?.cells.get(2) as ICodeCellModel;
      expect(thirdCell.sharedModel.getSource()).toBe('c=a$testTag+99\nb=a$testTag+c\na=\"xyz\"\na');
      
      //delete tag
      panel.content.select(panel.content.widgets[0]);
      firstCell = panel.content.widgets[0].model as IDataflowCodeCellModel;
      await removeCellName(panel.context.model as DataflowNotebookModel, sessionContext, firstCell, true)

      // verifies UUID is added when tag is deleted
      secondCell = panel.content.model?.cells.get(1) as ICodeCellModel;
      expect(secondCell.sharedModel.getSource()).toBe('b=a$'+refId+'+9');

      thirdCell = panel.content.model?.cells.get(2) as ICodeCellModel;
      expect(thirdCell.sharedModel.getSource()).toBe('c=a$'+refId+'+99\nb=a$'+refId+'+c\na=\"xyz\"\na');
    });

    it('deleting cell with tag should update references with uuid', async () =>{
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
       cell_type: 'code',
       source: 'a=9',
       metadata: {
         trusted: false
       }
     });
     
     //make cell active and execute
     panel.content.select(panel.content.widgets[0]);
     let result = await NotebookActions.run(panel.content, sessionContext);
     expect(result).toBe(true);

     //add tag
     panel.content.select(panel.content.widgets[0]);
     const firstCell = panel.content.widgets[0].model as IDataflowCodeCellModel;
     firstCell.cellName = "testTag";
     
     // code cell 2
     panel.content.model?.sharedModel.insertCell(1, {
       cell_type: 'code',
       source: 'a=5\ntest=a+99\nb=a$testTag+99',
       metadata: {
         trusted: false
       }
     });
 
     //make cell active and execute
     panel.content.select(panel.content.widgets[1]);
     result = await NotebookActions.run(panel.content, sessionContext);
     expect(result).toBe(true);

     //deleting code cell 1 and running a cell
     panel.content.model?.sharedModel.deleteCellRange(0,1)
     panel.content.select(panel.content.widgets[1]);
     result = await NotebookActions.run(panel.content, sessionContext);
     expect(result).toBe(true);
 
     // verifies tagvalue is replced with uuid
     const lastExecutedCell = panel.content.model?.cells.get(0) as ICodeCellModel;
     expect(lastExecutedCell.sharedModel.getSource()).toBe('a=5\ntest=a+99\nb=a$'+refId+'+99');
    }); 
   });

  describe('dfmetdata', () => {
    it('dfcode cell should contain dfmetadata inside metadata', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });

      let expectedDFMetadata = {
          output_tags: [],
          input_refs: {},
          auto_update: true,
          force_cached: false
      };

      let cell = panel.content.model?.cells.get(0) as ICodeCellModel;;
      let dfmetadata = cell.sharedModel.getMetadata('dfnotebook')
      expect(dfmetadata).toBeDefined();
      expect(dfmetadata).toEqual(expectedDFMetadata);
    });
  
    it('inputVars and outputVars should be updated on sucessful execution', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'b=a+9',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      const firstCell = panel.content.model?.cells.get(0) as ICodeCellModel;
      const firstCellId = truncateCellId(firstCell.id);
  
      const secondCell = panel.content.model?.cells.get(1) as IDataflowCodeCellModel;
      let dfmetadata = secondCell.getDataflowMetadata();
      
      // verifies references in cell 2 dfmetadata
      expect(dfmetadata).toBeDefined();
      expect(dfmetadata.input_refs).toEqual({
        "a": [firstCellId],
      });
      expect(dfmetadata.output_tags).toEqual(['b'])
    });

    it('persistentCode should be updated with executed code having references', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //make cell active and execute
      panel.content.select(panel.content.widgets[0]);
      let result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      // code cell 2
      panel.content.model?.sharedModel.insertCell(1, {
        cell_type: 'code',
        source: 'b=a+9',
        metadata: {
          trusted: false
        }
      });
  
      //make cell active and execute
      panel.content.select(panel.content.widgets[1]);
      result = await NotebookActions.run(panel.content, sessionContext);
      expect(result).toBe(true);
  
      const firstCell = panel.content.model?.cells.get(0) as ICodeCellModel;
      const firstCellId = truncateCellId(firstCell.id);
  
      const secondCell = panel.content.model?.cells.get(1) as IDataflowCodeCellModel;
      let dfmetadata = secondCell.getDataflowMetadata();
      
      expect(dfmetadata).toBeDefined();
      expect(secondCell.sharedModel.getSource()).toEqual('b=a+9');
      expect(dfmetadata.persistent_code).toEqual('b=a$'+firstCellId+'+9');
    });
  
    it('tag value should be updated in dfmetadata when cell is tagged', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      //const inputArea = (panel.content.widgets[0] as CodeCell).inputArea as any;
      
      let cell = panel.content.widgets[0].model as IDataflowCodeCellModel;
      cell.cellName = "testTag"
      const dfmetadata = cell.getDataflowMetadata();
      expect(dfmetadata).toBeDefined();
      expect(dfmetadata.name).toEqual('testTag');
    });

    it('tag value should be updated when tag is deleted', async () => {
      // code cell 1
      panel.content.model?.sharedModel.insertCell(0, {
        cell_type: 'code',
        source: 'a=9',
        metadata: {
          trusted: false
        }
      });
      
      let cell = panel.content.widgets[0].model as IDataflowCodeCellModel;
      cell.cellName = "testTag";
      let dfmetadata = cell.getDataflowMetadata();
      expect(dfmetadata).toBeDefined();
      expect(dfmetadata.name).toEqual('testTag');

      cell.cellName = "";
      dfmetadata = cell.getDataflowMetadata();
      expect(dfmetadata).toBeDefined();
      expect(dfmetadata.name).toBeUndefined;
    });
  });
});