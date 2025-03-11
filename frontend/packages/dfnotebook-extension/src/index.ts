// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module dfnotebook-extension
 */

import {
  ILabShell,
  ILayoutRestorer,
  IRouter,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  createToolbarFactory,
  Dialog,
  ICommandPalette,
  InputDialog,
  ISessionContext,
  ISessionContextDialogs,
  IToolbarWidgetRegistry,
  SessionContextDialogs,
  showDialog,
  MainAreaWidget,
  Toolbar
} from '@jupyterlab/apputils';
import { Graph, Manager as GraphManager, ViewerWidget } from '@dfnotebook/dfgraph';
import { Cell, CodeCell, CodeCellModel, ICellModel, ICodeCellModel, MarkdownCell } from '@jupyterlab/cells';
import { IEditorServices } from '@jupyterlab/codeeditor';
import { IEditorExtensionRegistry } from '@jupyterlab/codemirror';
import { ToolbarItems as DocToolbarItems } from '@jupyterlab/docmanager-extension';
import { DocumentRegistry, IDocumentWidget } from '@jupyterlab/docregistry';
import { IDefaultFileBrowser } from '@jupyterlab/filebrowser';
import { ILauncher } from '@jupyterlab/launcher';
import { IMainMenu } from '@jupyterlab/mainmenu';
import { truncateCellId } from '@dfnotebook/dfutils';
import * as nbformat from '@jupyterlab/nbformat';
import {
  ExecutionIndicator,
  INotebookCellExecutor,
  INotebookTracker,
  INotebookWidgetFactory,
  Notebook,
  NotebookActions,
  NotebookModelFactory,
  NotebookPanel,
  NotebookTracker,
  NotebookWidgetFactory,
  StaticNotebook,
  ToolbarItems,
  setCellExecutor
} from '@jupyterlab/notebook';
import { IObservableList } from '@jupyterlab/observables';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import {
  IFormRendererRegistry,
  LabIcon,
  addAboveIcon,
  addBelowIcon,
  copyIcon,
  cutIcon,
  duplicateIcon,
  fastForwardIcon,
  moveDownIcon,
  moveUpIcon,
  notebookIcon,
  pasteIcon,
  refreshIcon,
  runIcon,
  stopIcon
} from '@jupyterlab/ui-components';
import { ArrayExt } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import {
  JSONExt,
  JSONObject,
  ReadonlyJSONValue,
  ReadonlyPartialJSONObject,
  UUID
} from '@lumino/coreutils';
import { DisposableSet } from '@lumino/disposable';
import { Panel } from '@lumino/widgets';

import {
  DataflowNotebookModel,
  DataflowNotebookModelFactory,
  DataflowNotebookPanel,
  DataflowNotebookWidgetFactory,
  IDataflowNotebookWidgetFactory,
  getCellsMetadata,
  getAllTags,
  dfCommGetData
} from '@dfnotebook/dfnotebook';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { IChangedArgs, PageConfig } from '@jupyterlab/coreutils';
import { DataflowInputArea } from '@dfnotebook/dfcells';

import { cellExecutor } from './cellexecutor';
import { CellBarExtension } from '@jupyterlab/cell-toolbar';
import { Widget } from '@lumino/widgets';
import tagSvgstr from '../style/tag.svg';
import tagOffSvgstr from '../style/tag-off.svg';
import reactiveSvgstr from '../style/reactive.svg';
import nonReactiveSvgstr from '../style/non-reactive.svg';
import depViewerSvgstr from '../style/dep-viewer.svg';
import minimapSvgstr from '../style/minimap.svg';

export const tagIcon = new LabIcon({
  name: 'tag',
  svgstr: tagSvgstr
});

export const tagOffIcon = new LabIcon({
  name: 'tag-off',
  svgstr: tagOffSvgstr
})

export const reactiveIcon = new LabIcon({
  name: 'reactive',
  svgstr: reactiveSvgstr
});

export const nonReactiveIcon = new LabIcon({
  name: 'non-reactive',
  svgstr: nonReactiveSvgstr
});

export const depViewerIcon = new LabIcon({
  name: 'dep-viewer',
  svgstr: depViewerSvgstr
});

export const minimapIcon = new LabIcon({
  name: 'df-minimap',
  svgstr: minimapSvgstr
});

/**
 * The command IDs used by the notebook plugin.
 */
namespace CommandIDs {
  export const createNew = 'notebook:create-new';

  export const interrupt = 'notebook:interrupt-kernel';

  export const restart = 'notebook:restart-kernel';

  export const restartClear = 'notebook:restart-clear-output';

  export const restartAndRunToSelected = 'notebook:restart-and-run-to-selected';

  export const restartRunAll = 'notebook:restart-run-all';

  export const reconnectToKernel = 'notebook:reconnect-to-kernel';

  export const changeKernel = 'notebook:change-kernel';

  export const getKernel = 'notebook:get-kernel';

  export const createConsole = 'notebook:create-console';

  export const createOutputView = 'notebook:create-output-view';

  export const clearAllOutputs = 'notebook:clear-all-cell-outputs';

  export const shutdown = 'notebook:shutdown-kernel';

  export const closeAndShutdown = 'notebook:close-and-shutdown';

  export const trust = 'notebook:trust';

  export const exportToFormat = 'notebook:export-to-format';

  export const run = 'notebook:run-cell';

  export const runAndAdvance = 'notebook:run-cell-and-select-next';

  export const runAndInsert = 'notebook:run-cell-and-insert-below';

  export const runInConsole = 'notebook:run-in-console';

  export const runAll = 'notebook:run-all-cells';

  export const runAllAbove = 'notebook:run-all-above';

  export const runAllBelow = 'notebook:run-all-below';

  export const renderAllMarkdown = 'notebook:render-all-markdown';

  export const toCode = 'notebook:change-cell-to-code';

  export const toMarkdown = 'notebook:change-cell-to-markdown';

  export const toRaw = 'notebook:change-cell-to-raw';

  export const cut = 'notebook:cut-cell';

  export const copy = 'notebook:copy-cell';

  export const pasteAbove = 'notebook:paste-cell-above';

  export const pasteBelow = 'notebook:paste-cell-below';

  export const duplicateBelow = 'notebook:duplicate-below';

  export const pasteAndReplace = 'notebook:paste-and-replace-cell';

  export const moveUp = 'notebook:move-cell-up';

  export const moveDown = 'notebook:move-cell-down';

  export const clearOutputs = 'notebook:clear-cell-output';

  export const deleteCell = 'notebook:delete-cell';

  export const insertAbove = 'notebook:insert-cell-above';

  export const insertBelow = 'notebook:insert-cell-below';

  export const selectAbove = 'notebook:move-cursor-up';

  export const selectBelow = 'notebook:move-cursor-down';

  export const selectHeadingAboveOrCollapse =
    'notebook:move-cursor-heading-above-or-collapse';

  export const selectHeadingBelowOrExpand =
    'notebook:move-cursor-heading-below-or-expand';

  export const insertHeadingAbove = 'notebook:insert-heading-above';

  export const insertHeadingBelow = 'notebook:insert-heading-below';

  export const extendAbove = 'notebook:extend-marked-cells-above';

  export const extendTop = 'notebook:extend-marked-cells-top';

  export const extendBelow = 'notebook:extend-marked-cells-below';

  export const extendBottom = 'notebook:extend-marked-cells-bottom';

  export const selectAll = 'notebook:select-all';

  export const deselectAll = 'notebook:deselect-all';

  export const editMode = 'notebook:enter-edit-mode';

  export const merge = 'notebook:merge-cells';

  export const mergeAbove = 'notebook:merge-cell-above';

  export const mergeBelow = 'notebook:merge-cell-below';

  export const split = 'notebook:split-cell-at-cursor';

  export const commandMode = 'notebook:enter-command-mode';

  export const toggleAllLines = 'notebook:toggle-all-cell-line-numbers';

  export const undoCellAction = 'notebook:undo-cell-action';

  export const redoCellAction = 'notebook:redo-cell-action';

  export const redo = 'notebook:redo';

  export const undo = 'notebook:undo';

  export const markdown1 = 'notebook:change-cell-to-heading-1';

  export const markdown2 = 'notebook:change-cell-to-heading-2';

  export const markdown3 = 'notebook:change-cell-to-heading-3';

  export const markdown4 = 'notebook:change-cell-to-heading-4';

  export const markdown5 = 'notebook:change-cell-to-heading-5';

  export const markdown6 = 'notebook:change-cell-to-heading-6';

  export const hideCode = 'notebook:hide-cell-code';

  export const showCode = 'notebook:show-cell-code';

  export const hideAllCode = 'notebook:hide-all-cell-code';

  export const showAllCode = 'notebook:show-all-cell-code';

  export const hideOutput = 'notebook:hide-cell-outputs';

  export const showOutput = 'notebook:show-cell-outputs';

  export const hideAllOutputs = 'notebook:hide-all-cell-outputs';

  export const showAllOutputs = 'notebook:show-all-cell-outputs';

  export const toggleRenderSideBySideCurrentNotebook =
    'notebook:toggle-render-side-by-side-current';

  export const setSideBySideRatio = 'notebook:set-side-by-side-ratio';

  export const enableOutputScrolling = 'notebook:enable-output-scrolling';

  export const disableOutputScrolling = 'notebook:disable-output-scrolling';

  export const selectLastRunCell = 'notebook:select-last-run-cell';

  export const replaceSelection = 'notebook:replace-selection';

  export const autoClosingBrackets = 'notebook:toggle-autoclosing-brackets';

  export const toggleCollapseCmd = 'notebook:toggle-heading-collapse';

  export const collapseAllCmd = 'notebook:collapse-all-headings';

  export const expandAllCmd = 'notebook:expand-all-headings';

  export const copyToClipboard = 'notebook:copy-to-clipboard';

  export const invokeCompleter = 'completer:invoke-notebook';

  export const selectCompleter = 'completer:select-notebook';

  export const tocRunCells = 'toc:run-cells';

  export const addCellName = 'notebook:add-cell-name';

  export const modifyCellName = 'notebook:modify-cell-name';

  export const setCellName = 'toolbar-button:set-cell-name';

  export const reactiveCodeCell = 'toolbar-button:reactive-cell';

  export const toggleTagsCmd = 'dfnotebook:toggle-tags';

  export const toggleReactiveCmd = 'dfnotebook:toggle-reactive';

  export const depViewerCmd = 'dfnotebook:dep-viewer';

  export const minimapCmd = 'dfnotebook:minimap';
}

/**
 * The name of the factory that creates notebooks.
 */
const FACTORY = 'Notebook';

/**
 * The name of the factory that creates dataflow notebooks.
 */
const DATAFLOW_FACTORY = 'Dataflow Notebook';

/**
 * Setting Id storing the customized toolbar definition.
 */
const PANEL_SETTINGS = '@jupyterlab/notebook-extension:panel';

/**
 * The id to use on the style tag for the side by side margins.
 */
const SIDE_BY_SIDE_STYLE_ID = 'jp-NotebookExtension-sideBySideMargins';

/**
 * The notebook widget tracker provider.
 */
const trackerPlugin: JupyterFrontEndPlugin<INotebookTracker> = {
  id: '@dfnotebook/dfnotebook-extension:tracker',
  description: 'Provides the notebook widget tracker.',
  provides: INotebookTracker,
  requires: [
    INotebookWidgetFactory,
    IDataflowNotebookWidgetFactory,
    IEditorExtensionRegistry,
    INotebookCellExecutor    
  ],
  optional: [
    ICommandPalette,
    IDefaultFileBrowser,
    ILauncher,
    ILayoutRestorer,
    IMainMenu,
    IRouter,
    ISettingRegistry,
    ISessionContextDialogs,
    ITranslator,
    IFormRendererRegistry
  ],
  activate: activateNotebookHandler,
  autoStart: true
};

/**
 * The dataflow notebook cell factory provider.
 */
const factory: JupyterFrontEndPlugin<DataflowNotebookPanel.IContentFactory> = {
  id: '@dfnotebook/dfnotebook-extension:factory',
  description: 'Provides the dataflow notebook cell factory.',
  provides: DataflowNotebookPanel.IContentFactory,
  requires: [IEditorServices],
  autoStart: true,
  activate: (app: JupyterFrontEnd, editorServices: IEditorServices) => {
    const editorFactory = editorServices.factoryService.newInlineEditor;
    return new DataflowNotebookPanel.ContentFactory({ editorFactory });
  }
};

/**
 * The dataflow notebook widget factory provider.
 */
const widgetFactoryPlugin: JupyterFrontEndPlugin<DataflowNotebookWidgetFactory.IFactory> =
  {
    id: '@dfnotebook/dfnotebook-extension:widget-factory',
    description: 'Provides the dataflow notebook widget factory.',
    provides: IDataflowNotebookWidgetFactory,
    requires: [
      DataflowNotebookPanel.IContentFactory,
      IEditorServices,
      IRenderMimeRegistry,
      IToolbarWidgetRegistry
    ],
    optional: [ISettingRegistry, ISessionContextDialogs, ITranslator],
    activate: activateDataflowWidgetFactory,
    autoStart: true
  };

// FIXME Add back when dfgraph is updated
// /**
//  * Initialization for the Dfnb GraphManager for working with multiple graphs.
//  */
const GraphManagerPlugin: JupyterFrontEndPlugin<void> = {
  id: 'dfnb-graph',
  autoStart: true,
  requires: [ICommandPalette,INotebookTracker],
  activate: (app: JupyterFrontEnd, palette: ICommandPalette,nbTrackers:INotebookTracker) => {
   // Create a blank content widget inside of a MainAreaWidget
      console.log("GraphManager is active");
      let shell = app.shell as ILabShell;

      nbTrackers.widgetAdded.connect((sender,nbPanel) => {
            const session = nbPanel.sessionContext;
            GraphManager.setTracker(nbTrackers);
            session.ready.then(() =>
            {
                let outputTags: {[index: string]:any}  = {};
                let cellContents: {[index: string]:any} = {};
                let cellList = (nbPanel.model?.toJSON() as any)?.cells;

                cellList.map(function(cell:any)
                {
                let cellId = truncateCellId(cell.id);
                if(cell?.cell_type != "code"){return;}
                cellContents[cellId] = cell.source;
                outputTags[cellId] =
                (cell?.outputs).flatMap((output:any) => (output?.metadata?.output_tag ?? []));
                });
                let cells = Object.keys(outputTags);
                let uplinks : {[index: string]:any} = cells.reduce((dict:{[index: string]:any},cellId:string)=>{dict[cellId]={};return dict;},{});
                let downlinks : {[index: string]:any} = cells.reduce((dict:{[index: string]:any},cellId:string)=>{dict[cellId]=[];return dict;},{});
                Object.keys(cellContents).map(function(cellId){
                    let regex = /\w+\$[a-f0-9]{8}/g
                    let references = (cellContents[cellId].match(regex)) || [];
                    references.map(function(reference:string){
                       let ref = reference.split('$');
                       if (ref[1] in uplinks[cellId]){
                         uplinks[cellId][ref[1]].push(ref[0]);
                       }
                       else{
                         uplinks[cellId][ref[1]] = [ref[0]]
                       }
                       downlinks[ref[1]].push(cellId);
                    });
                })
                let sessId = session?.session?.id || "None";
                if(!(sessId in Object.keys(GraphManager.graphs))){
                    //@ts-ignore
                    GraphManager.graphs[sessId] = new Graph({'cells':cells,'nodes':outputTags,'internalNodes':outputTags,'uplinks':uplinks,'downlinks':downlinks,'cellContents':cellContents});
                    GraphManager.updateGraph(sessId);
                    let cellOrder = cellList.map((c:any) => c.id);
                    GraphManager.updateOrder(cellOrder);
                }
                console.log(sessId);

                (nbPanel.content as any).model._cells.changed.connect(() =>{
                  GraphManager.updateOrder((nbPanel.content as any).model.cells.model.cells.map((cell:any) => cell.id));
                });
                
                nbPanel.content.activeCellChanged.connect(() =>{
                  let prevActive = GraphManager.getActive();
                  if(typeof prevActive == 'object' && prevActive.id != undefined ){
                      let uuid = truncateCellId(prevActive.id);
                      if(prevActive.sharedModel.source != GraphManager.getText(uuid)){
                          GraphManager.markStale(uuid);
                      }
                      else if(GraphManager.getStale(uuid) == 'Stale'){
                          GraphManager.revertStale(uuid);
                      }
                  }
                  //Have to get this off the model the same way that actions.tsx does
                  let activeId = truncateCellId(nbPanel.content.activeCell?.model?.id.replace(/-/g, '') || '');
                  GraphManager.updateActive(activeId,nbPanel.content.activeCell?.model);
                });
            });
      });

      shell.currentChanged.connect((_, change) => {
      //@ts-ignore
        let sessId = change['newValue']?.sessionContext?.session?.id;

        if(sessId in GraphManager.graphs){
            GraphManager.updateActiveGraph();
        }
        });

  }

}

/**
 * Initialization data for the Dfnb Depviewer extension.
 */
const DepViewer: JupyterFrontEndPlugin<void> = {
  id: 'dfnb-depview',
  autoStart: true,
  requires: [ICommandPalette, INotebookTracker],
  activate: (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    nbTrackers: INotebookTracker
  ) => {
    // Create a blank content widget inside of a MainAreaWidget
    const newWidget = () => {
      const content = new ViewerWidget();
      //GraphManager uses flags from the ViewerWidget
      GraphManager.depWidget = content;
      const widget = new MainAreaWidget({ content });
      widget.id = 'dfnb-depview';
      widget.title.label = 'Dependency Viewer';
      widget.title.closable = true;
      // Add a div to the panel
      let panel = document.createElement('div');
      panel.setAttribute('id', 'depview');
      content.node.appendChild(panel);
      return widget;
    };
    let widget = newWidget();
    function openDepViewer() {
      if (widget.isDisposed) {
        widget = newWidget();
        GraphManager.depview.isCreated = false;
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there
        app.shell.add(widget, 'main', {
          mode: 'split-right',
          activate: false
        });
        if (!GraphManager.depview.isCreated) {
          GraphManager.depview.createDepDiv();
        }
      }
      // Activate the widget
      app.shell.activateById(widget.id);
      GraphManager.depview.isOpen = true;
      GraphManager.depview.startGraphCreation();
    }

    app.commands.addCommand(CommandIDs.depViewerCmd, {
      label: 'Open Dependency Viewer',
      caption: 'Open Dependency Viewer',
      execute: args => {
        openDepViewer();
      },
      icon: args => (args.toolbar ? depViewerIcon : undefined),
    });

    // Add the command to the palette.
    // FIXME why is this tutorial category?
    palette.addItem({ command: CommandIDs.depViewerCmd, category: 'Tutorial' });
  }
};

/**
 * Initialization data for the Minimap extension.
 */
const MiniMap: JupyterFrontEndPlugin<void> = {
  id: 'dfnb-minimap',
  autoStart: true,
  requires: [ICommandPalette, INotebookTracker],
  activate: (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    nbTrackers: INotebookTracker
  ) => {
    const newWidget = () => {
      const content = new ViewerWidget();
      //Graph Manager maintains the flags on the widgets
      GraphManager.miniWidget = content;
      const widget = new MainAreaWidget({ content });
      widget.id = 'dfnb-minimap';
      widget.title.label = 'Notebook Minimap';
      widget.title.closable = true;
      // Add a div to the panel
      let panel = document.createElement('div');
      panel.setAttribute('id', 'minimap');
      let inner = document.createElement('div');
      inner.setAttribute('id', 'minidiv');
      let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttributeNS(
        'http://www.w3.org/2000/xmlns/',
        'xmlns:xlink',
        'http://www.w3.org/1999/xlink'
      );
      svg.setAttribute('id', 'minisvg');
      inner.append(svg);

      panel.appendChild(inner);
      content.node.appendChild(panel);
      return widget;
    };
    let widget = newWidget();

    function openMinimap() {
      if (widget.isDisposed) {
        widget = newWidget();
        GraphManager.minimap.wasCreated = false;
      }
      if (!widget.isAttached) {
        app.shell.add(widget, 'main', {
          mode: 'split-right',
          activate: false
        });
        //'right');

        if (!GraphManager.minimap.wasCreated) {
          console.log(
            'Active Graph',
            GraphManager.graphs[GraphManager.currentGraph]
          );

          // Activate the widget
          app.shell.activateById(widget.id);
          GraphManager.minimap.createMiniArea();
          GraphManager.minimap.wasCreated = true;
        } else {
          GraphManager.minimap.startMinimapCreation();
        }
      }
    }

    app.commands.addCommand(CommandIDs.minimapCmd, {
      label: 'Open Minimap',
      caption: 'Open Minimap',
      execute: args => {
        openMinimap();
      },
      icon: args => (args.toolbar ? minimapIcon : undefined)
    });

    // Add the command to the palette.
    // FIXME why is this tutorial category?
    palette.addItem({ command: CommandIDs.minimapCmd, category: 'Tutorial' });
  }
};

const cellToolbar: JupyterFrontEndPlugin<void> = {
  id: '@dfnotebook/dfnotebook-extension:cell-toolbar',
  description: 'Add the cells toolbar.',
  autoStart: true,
  activate: async (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry | null,
    toolbarRegistry: IToolbarWidgetRegistry | null,
    translator: ITranslator | null
  ) => {
    const toolbarItems =
      settingRegistry && toolbarRegistry
        ? createToolbarFactory(
            toolbarRegistry,
            settingRegistry,
            CellBarExtension.FACTORY_NAME,
            '@jupyterlab/cell-toolbar-extension:plugin',
            translator ?? nullTranslator
          )
        : undefined;

    // have to register this with our factory
    app.docRegistry.addWidgetExtension(
      DATAFLOW_FACTORY,
      new CellBarExtension(app.commands, toolbarItems)
    );
  },
  optional: [ISettingRegistry, IToolbarWidgetRegistry, ITranslator]
};

const panelToolbar: JupyterFrontEndPlugin<void> = {
  id: '@dfnotebook/dfnotebook-extension:panel-toolbar',
  description: 'Add dfnotebook toolbar items to the notebook panel.',
  autoStart: true,
  requires: [INotebookTracker],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker) => {
    app.commands.addCommand(CommandIDs.toggleTagsCmd, {
      label: 'Toggle Cell Names',
      caption: 'Toggle Cell Names',
      execute: args => {
        const current = tracker.currentWidget;
        if (current) {
          const notebook = current.content;
          let tagsEnabled = notebook.model?.getMetadata("enable_tags") ?? true;
          tagsEnabled = !tagsEnabled;

          // FIXME actually make the tag-cell buttons invisible?
          const cellsArray = Array.from(notebook.widgets);
          cellsArray.forEach(cAny => {
            const dfmetadata = cAny.model.getMetadata('dfmetadata');
            if (cAny.model.type == 'code' && dfmetadata.tag){
              const inputArea = (cAny as any).inputArea;
              let currTag = dfmetadata.tag;
              if (tagsEnabled){
                inputArea.addTag(currTag);
              } else {
                inputArea.addTag("");
                dfmetadata.tag = currTag;
                cAny.model.setMetadata('dfmetadata', dfmetadata);
              }
            }
          });
          current.model?.setMetadata("enable_tags", tagsEnabled);
          app.commands.notifyCommandChanged(CommandIDs.setCellName);
          app.commands.notifyCommandChanged(CommandIDs.toggleTagsCmd);
          const nbPanel = tracker.currentWidget;
          updateNotebookCellsWithTag(nbPanel.model as DataflowNotebookModel, "", nbPanel.sessionContext,false, false, true);
        }
      },
      isEnabled: args => (tracker.currentWidget ? true : false),
      icon: args => {
        const current = tracker.currentWidget;
        let tagsEnabled = true;
        if (current) {
          tagsEnabled = current?.model?.getMetadata("enable_tags") ?? true;
        } else {
          tagsEnabled = false;
        }
        return tagsEnabled ? tagOffIcon : tagIcon;
      },
    });

    app.commands.addCommand(CommandIDs.toggleReactiveCmd, {
      label: 'Toggle Reactive Mode',
      caption: 'Toggle Reactive Mode',
      execute: args => {
        const current = tracker.currentWidget;
        if (current) {
          const notebook = current.content;
          let reactiveEnabled = notebook.model?.getMetadata("enable_reactive") ?? true;
          reactiveEnabled = !reactiveEnabled;
          // FIXME make the reactive-cell buttons invisible?
          current.model?.setMetadata("enable_reactive", reactiveEnabled);
          app.commands.notifyCommandChanged(CommandIDs.toggleReactiveCmd);
        }
      },
      icon: args => {
        const current = tracker.currentWidget;
        let reactiveEnabled = true;
        if (current) {
          reactiveEnabled = current?.model?.getMetadata("enable_reactive") ?? true;
        } else {
          reactiveEnabled = false;
        }
        return reactiveEnabled ? nonReactiveIcon : reactiveIcon;
      }
    });    
  }
}


const plugins: JupyterFrontEndPlugin<any>[] = [
  cellExecutor,
  factory,
  widgetFactoryPlugin,
  trackerPlugin,
  cellToolbar,
  panelToolbar,
  DepViewer,
  MiniMap,
  GraphManagerPlugin
];
export default plugins;

/**
 * Activate the notebook widget factory.
 */
function activateDataflowWidgetFactory(
  app: JupyterFrontEnd,
  contentFactory: NotebookPanel.IContentFactory,
  editorServices: IEditorServices,
  rendermime: IRenderMimeRegistry,
  toolbarRegistry: IToolbarWidgetRegistry,
  settingRegistry: ISettingRegistry | null,
  sessionContextDialogs_: ISessionContextDialogs | null,
  translator_: ITranslator | null
): NotebookWidgetFactory.IFactory {
  const translator = translator_ ?? nullTranslator;
  const sessionContextDialogs =
    sessionContextDialogs_ ?? new SessionContextDialogs({ translator });
  const preferKernelOption = PageConfig.getOption('notebookStartsKernel');

  // If the option is not set, assume `true`
  const preferKernelValue =
    preferKernelOption === '' || preferKernelOption.toLowerCase() === 'true';

  const { commands } = app;
  let toolbarFactory:
    | ((
        widget: NotebookPanel
      ) =>
        | DocumentRegistry.IToolbarItem[]
        | IObservableList<DocumentRegistry.IToolbarItem>)
    | undefined;

  // Register notebook toolbar widgets
  toolbarRegistry.addFactory<NotebookPanel>(DATAFLOW_FACTORY, 'save', panel =>
    DocToolbarItems.createSaveButton(commands, panel.context.fileChanged)
  );
  toolbarRegistry.addFactory<NotebookPanel>(
    DATAFLOW_FACTORY,
    'cellType',
    panel => ToolbarItems.createCellTypeItem(panel, translator)
  );
  toolbarRegistry.addFactory<NotebookPanel>(
    DATAFLOW_FACTORY,
    'kernelName',
    panel =>
      Toolbar.createKernelNameItem(
        panel.sessionContext,
        sessionContextDialogs,
        translator
      )
  );

  toolbarRegistry.addFactory<NotebookPanel>(
    DATAFLOW_FACTORY,
    'executionProgress',
    panel => {
      const loadingSettings = settingRegistry?.load(trackerPlugin.id);
      const indicator = ExecutionIndicator.createExecutionIndicatorItem(
        panel,
        translator,
        loadingSettings
      );

      void loadingSettings?.then(settings => {
        panel.disposed.connect(() => {
          settings.dispose();
        });
      });

      return indicator;
    }
  );

  if (settingRegistry) {
    // Create the factory
    toolbarFactory = createToolbarFactory(
      toolbarRegistry,
      settingRegistry,
      DATAFLOW_FACTORY,
      PANEL_SETTINGS,
      translator
    );
  }

  const trans = translator.load('jupyterlab');

  const factory = new NotebookWidgetFactory({
    name: DATAFLOW_FACTORY,
    label: trans.__('Notebook'),
    fileTypes: ['notebook'],
    modelName: 'dfnotebook',
    defaultFor: ['notebook'],
    preferKernel: preferKernelValue,
    canStartKernel: true,
    rendermime,
    contentFactory,
    editorConfig: StaticNotebook.defaultEditorConfig,
    notebookConfig: StaticNotebook.defaultNotebookConfig,
    mimeTypeService: editorServices.mimeTypeService,
    toolbarFactory,
    translator
  });
  app.docRegistry.addWidgetFactory(factory);

  return factory;
}

/**
 * Activate the notebook handler extension.
 */
function activateNotebookHandler(
  app: JupyterFrontEnd,
  factory: NotebookWidgetFactory.IFactory,
  dfFactory: DataflowNotebookWidgetFactory.IFactory,
  // dfModelFactory: DataflowNotebookModelFactory.IFactory,
  extensions: IEditorExtensionRegistry,
  executor: INotebookCellExecutor,
  palette: ICommandPalette | null,
  defaultBrowser: IDefaultFileBrowser | null,
  launcher: ILauncher | null,
  restorer: ILayoutRestorer | null,
  mainMenu: IMainMenu | null,
  router: IRouter | null,
  settingRegistry: ISettingRegistry | null,
  sessionDialogs_: ISessionContextDialogs | null,
  translator_: ITranslator | null,
  formRegistry: IFormRendererRegistry | null
): INotebookTracker {
  setCellExecutor(executor);

  const translator = translator_ ?? nullTranslator;
  const sessionDialogs =
    sessionDialogs_ ?? new SessionContextDialogs({ translator });
  const trans = translator.load('jupyterlab');
  const services = app.serviceManager;

  const { commands, shell } = app;
  const tracker = new NotebookTracker({ namespace: 'notebook' });

  // Use the router to deal with hash navigation
  function onRouted(router: IRouter, location: IRouter.ILocation): void {
    if (location.hash && tracker.currentWidget) {
      tracker.currentWidget.setFragment(location.hash);
    }
  }
  router?.routed.connect(onRouted);

  const isEnabled = (): boolean => {
    return Private.isEnabled(shell, tracker);
  };

  const setSideBySideOutputRatio = (sideBySideOutputRatio: number) =>
    document.documentElement.style.setProperty(
      '--jp-side-by-side-output-size',
      `${sideBySideOutputRatio}fr`
    );

  // Fetch settings if possible.
  const fetchSettings = settingRegistry
    ? settingRegistry.load(trackerPlugin.id)
    : Promise.reject(new Error(`No setting registry for ${trackerPlugin.id}`));

  fetchSettings
    .then(settings => {
      updateConfig(factory, settings);
      updateConfig(dfFactory, settings);
      settings.changed.connect(() => {
        updateConfig(factory, settings);
        updateConfig(dfFactory, settings);
      });

      const updateSessionSettings = (
        session: ISessionContext,
        changes: IChangedArgs<ISessionContext.IKernelPreference>
      ) => {
        const { newValue, oldValue } = changes;
        const autoStartDefault = newValue.autoStartDefault;

        if (
          typeof autoStartDefault === 'boolean' &&
          autoStartDefault !== oldValue.autoStartDefault
        ) {
          // Ensure we break the cycle
          if (
            autoStartDefault !==
            (settings.get('autoStartDefaultKernel').composite as boolean)
          )
            // Once the settings is changed `updateConfig` will take care
            // of the propagation to existing session context.
            settings
              .set('autoStartDefaultKernel', autoStartDefault)
              .catch(reason => {
                console.error(
                  `Failed to set ${settings.id}.autoStartDefaultKernel`
                );
              });
        }
      };

      const sessionContexts = new WeakSet<ISessionContext>();
      const listenToKernelPreference = (panel: NotebookPanel): void => {
        const session = panel.context.sessionContext;
        if (!session.isDisposed && !sessionContexts.has(session)) {
          sessionContexts.add(session);
          session.kernelPreferenceChanged.connect(updateSessionSettings);
          session.disposed.connect(() => {
            session.kernelPreferenceChanged.disconnect(updateSessionSettings);
          });
        }
      };
      tracker.forEach(listenToKernelPreference);
      tracker.widgetAdded.connect((tracker, panel) => {
        listenToKernelPreference(panel);
      });

      commands.addCommand(CommandIDs.autoClosingBrackets, {
        execute: args => {
          const codeConfig = settings.get('codeCellConfig')
            .composite as JSONObject;
          const markdownConfig = settings.get('markdownCellConfig')
            .composite as JSONObject;
          const rawConfig = settings.get('rawCellConfig')
            .composite as JSONObject;

          const anyToggled =
            codeConfig.autoClosingBrackets ||
            markdownConfig.autoClosingBrackets ||
            rawConfig.autoClosingBrackets;
          const toggled = !!(args['force'] ?? !anyToggled);
          [
            codeConfig.autoClosingBrackets,
            markdownConfig.autoClosingBrackets,
            rawConfig.autoClosingBrackets
          ] = [toggled, toggled, toggled];

          void settings.set('codeCellConfig', codeConfig);
          void settings.set('markdownCellConfig', markdownConfig);
          void settings.set('rawCellConfig', rawConfig);
        },
        label: trans.__('Auto Close Brackets for All Notebook Cell Types'),
        isToggled: () =>
          ['codeCellConfig', 'markdownCellConfig', 'rawCellConfig'].some(
            x =>
              ((settings.get(x).composite as JSONObject).autoClosingBrackets ??
                extensions.baseConfiguration['autoClosingBrackets']) === true
          )
      });
      commands.addCommand(CommandIDs.setSideBySideRatio, {
        label: trans.__('Set side-by-side ratio'),
        execute: args => {
          InputDialog.getNumber({
            title: trans.__('Width of the output in side-by-side mode'),
            value: settings.get('sideBySideOutputRatio').composite as number
          })
            .then(result => {
              setSideBySideOutputRatio(result.value!);
              if (result.value) {
                void settings.set('sideBySideOutputRatio', result.value);
              }
            })
            .catch(console.error);
        }
      });
    })
    .catch((reason: Error) => {
      console.warn(reason.message);
      updateTracker({
        editorConfig: factory.editorConfig,
        notebookConfig: factory.notebookConfig,
        kernelShutdown: factory.shutdownOnClose,
        autoStartDefault: factory.autoStartDefault
      });
    });

  if (formRegistry) {
    const CMRenderer = formRegistry.getRenderer(
      '@jupyterlab/codemirror-extension:plugin.defaultConfig'
    );
    if (CMRenderer) {
      formRegistry.addRenderer(
        '@jupyterlab/notebook-extension:tracker.codeCellConfig',
        CMRenderer
      );
      formRegistry.addRenderer(
        '@jupyterlab/notebook-extension:tracker.markdownCellConfig',
        CMRenderer
      );
      formRegistry.addRenderer(
        '@jupyterlab/notebook-extension:tracker.rawCellConfig',
        CMRenderer
      );
    }
  }

  // Handle state restoration.
  // !!! BEGIN DATAFLOW NOTEBOOK CHANGE !!!
  if (restorer) {
    // FIXME: This needs to get the kernel information from somewhere
    // Unsure that using model will work here...
    // (factory as NotebookWidgetFactory).kernel = "dfpython3";
    void restorer.restore(tracker, {
      command: 'docmanager:open',
      args: panel => ({
        path: panel.context.path,
        factory:
          panel.context.model instanceof DataflowNotebookModel
            ? DATAFLOW_FACTORY
            : FACTORY
      }),
      // use notebook or dfnotebook prefix on name here...
      name: panel => panel.context.path,
      when: services.ready
    });
  }
  // !!! END DATAFLOW NOTEBOOK CHANGE !!!

  const registry = app.docRegistry;
  const modelFactory = new NotebookModelFactory({
    disableDocumentWideUndoRedo:
      factory.notebookConfig.disableDocumentWideUndoRedo,
    collaborative: true
  });
  registry.addModelFactory(modelFactory);
  // !!! BEGIN DATAFLOW NOTEBOOK CHANGE !!!
  const dfModelFactory = new DataflowNotebookModelFactory({
    disableDocumentWideUndoRedo:
      factory.notebookConfig.disableDocumentWideUndoRedo,
    collaborative: true
  });
  registry.addModelFactory(dfModelFactory);
  // !!! END DATAFLOW NOTEBOOK CHANGE !!!

  addCommands(app, tracker, translator, sessionDialogs, isEnabled);

  if (palette) {
    populatePalette(palette, translator);
  }

  let id = 0; // The ID counter for notebook panels.

  const ft = app.docRegistry.getFileType('notebook');

  // !!! DATAFLOW NOTEBOOK CHANGE !!!
  // Make this a function that can be called by both...
  function connectWidgetCreated(factory: NotebookWidgetFactory.IFactory) {
    factory.widgetCreated.connect((sender, widget) => {
      // If the notebook panel does not have an ID, assign it one.
      widget.id = widget.id || `notebook-${++id}`;

      // Set up the title icon
      widget.title.icon = ft?.icon;
      widget.title.iconClass = ft?.iconClass ?? '';
      widget.title.iconLabel = ft?.iconLabel ?? '';

      // Notify the widget tracker if restore data needs to update.
      widget.context.pathChanged.connect(() => {
        void tracker.save(widget);
      });
      // Add the notebook panel to the tracker.
      void tracker.add(widget);
    });
  }
  connectWidgetCreated(factory);
  connectWidgetCreated(dfFactory);
  // !!! END DATAFLOW NOTEBOOK CHANGE !!!

  /**
   * Update the settings of the current tracker.
   */
  function updateTracker(options: NotebookPanel.IConfig): void {
    tracker.forEach(widget => {
      widget.setConfig(options);
    });
  }

  /**
   * Update the setting values.
   */
  // !!! DATAFLOW NOTEOBOK UPDATE TO PASS FACTORY IN HERE !!!
  function updateConfig(
    factory: NotebookWidgetFactory.IFactory,
    settings: ISettingRegistry.ISettings
  ): void {
    const code = {
      ...StaticNotebook.defaultEditorConfig.code,
      ...(settings.get('codeCellConfig').composite as JSONObject)
    };

    const markdown = {
      ...StaticNotebook.defaultEditorConfig.markdown,
      ...(settings.get('markdownCellConfig').composite as JSONObject)
    };

    const raw = {
      ...StaticNotebook.defaultEditorConfig.raw,
      ...(settings.get('rawCellConfig').composite as JSONObject)
    };

    factory.editorConfig = { code, markdown, raw };
    factory.notebookConfig = {
      enableKernelInitNotification: settings.get('enableKernelInitNotification')
        .composite as boolean,
      showHiddenCellsButton: settings.get('showHiddenCellsButton')
        .composite as boolean,
      scrollPastEnd: settings.get('scrollPastEnd').composite as boolean,
      defaultCell: settings.get('defaultCell').composite as nbformat.CellType,
      recordTiming: settings.get('recordTiming').composite as boolean,
      overscanCount: settings.get('overscanCount').composite as number,
      inputHistoryScope: settings.get('inputHistoryScope').composite as
        | 'global'
        | 'session',
      maxNumberOutputs: settings.get('maxNumberOutputs').composite as number,
      showEditorForReadOnlyMarkdown: settings.get(
        'showEditorForReadOnlyMarkdown'
      ).composite as boolean,
      disableDocumentWideUndoRedo: !settings.get('documentWideUndoRedo')
        .composite as boolean,
      renderingLayout: settings.get('renderingLayout').composite as
        | 'default'
        | 'side-by-side',
      sideBySideLeftMarginOverride: settings.get('sideBySideLeftMarginOverride')
        .composite as string,
      sideBySideRightMarginOverride: settings.get(
        'sideBySideRightMarginOverride'
      ).composite as string,
      sideBySideOutputRatio: settings.get('sideBySideOutputRatio')
        .composite as number,
      windowingMode: settings.get('windowingMode').composite as
        | 'defer'
        | 'full'
        | 'none'
    };
    setSideBySideOutputRatio(factory.notebookConfig.sideBySideOutputRatio);
    const sideBySideMarginStyle = `.jp-mod-sideBySide.jp-Notebook .jp-Notebook-cell {
      margin-left: ${factory.notebookConfig.sideBySideLeftMarginOverride} !important;
      margin-right: ${factory.notebookConfig.sideBySideRightMarginOverride} !important;`;
    const sideBySideMarginTag = document.getElementById(SIDE_BY_SIDE_STYLE_ID);
    if (sideBySideMarginTag) {
      sideBySideMarginTag.innerText = sideBySideMarginStyle;
    } else {
      document.head.insertAdjacentHTML(
        'beforeend',
        `<style id="${SIDE_BY_SIDE_STYLE_ID}">${sideBySideMarginStyle}}</style>`
      );
    }
    factory.autoStartDefault = settings.get('autoStartDefaultKernel')
      .composite as boolean;
    factory.shutdownOnClose = settings.get('kernelShutdown')
      .composite as boolean;

    modelFactory.disableDocumentWideUndoRedo = !settings.get(
      'documentWideUndoRedo'
    ).composite as boolean;
    // !!! BEGIN DATAFLOW NOTEBOOK CHANGE !!!
    dfModelFactory.disableDocumentWideUndoRedo = !settings.get(
      'documentWideUndoRedo'
    ).composite as boolean;
    // !!! END DATAFLOW NOTEBOOK CHANGE !!!

    updateTracker({
      editorConfig: factory.editorConfig,
      notebookConfig: factory.notebookConfig,
      kernelShutdown: factory.shutdownOnClose,
      autoStartDefault: factory.autoStartDefault
    });
  }

  // Add main menu notebook menu.
  if (mainMenu) {
    populateMenus(mainMenu, isEnabled);
  }

  // Utility function to create a new notebook.
  const createNew = async (
    cwd: string,
    kernelId: string,
    kernelName: string
  ) => {
    const model = await commands.execute('docmanager:new-untitled', {
      path: cwd,
      type: 'notebook'
    });
    if (model !== undefined) {
      const widget = (await commands.execute('docmanager:open', {
        path: model.path,
        // !!! DATAFLOW NOTEBOOK CHANGE (ONE LINE) !!!
        factory: kernelName == 'dfpython3' ? DATAFLOW_FACTORY : FACTORY,
        kernel: { id: kernelId, name: kernelName }
      })) as unknown as IDocumentWidget;
      widget.isUntitled = true;
      return widget;
    }
  };

  // Add a command for creating a new notebook.
  commands.addCommand(CommandIDs.createNew, {
    label: args => {
      const kernelName = (args['kernelName'] as string) || '';
      if (args['isLauncher'] && args['kernelName'] && services.kernelspecs) {
        return (
          services.kernelspecs.specs?.kernelspecs[kernelName]?.display_name ??
          ''
        );
      }
      if (args['isPalette'] || args['isContextMenu']) {
        return trans.__('New Notebook');
      }
      return trans.__('Notebook');
    },
    caption: trans.__('Create a new notebook'),
    icon: args => (args['isPalette'] ? undefined : notebookIcon),
    execute: args => {
      const cwd = (args['cwd'] as string) || (defaultBrowser?.model.path ?? '');
      const kernelId = (args['kernelId'] as string) || '';
      const kernelName = (args['kernelName'] as string) || '';
      return createNew(cwd, kernelId, kernelName);
    }
  });

  // Add a launcher item if the launcher is available.
  if (launcher) {
    void services.ready.then(() => {
      let disposables: DisposableSet | null = null;
      const onSpecsChanged = () => {
        if (disposables) {
          disposables.dispose();
          disposables = null;
        }
        const specs = services.kernelspecs.specs;
        if (!specs) {
          return;
        }
        disposables = new DisposableSet();

        for (const name in specs.kernelspecs) {
          const rank = name === specs.default ? 0 : Infinity;
          const spec = specs.kernelspecs[name]!;
          const kernelIconUrl =
            spec.resources['logo-svg'] || spec.resources['logo-64x64'];
          disposables.add(
            launcher.add({
              command: CommandIDs.createNew,
              args: { isLauncher: true, kernelName: name },
              category: trans.__('Notebook'),
              rank,
              kernelIconUrl,
              metadata: {
                kernel: JSONExt.deepCopy(
                  spec.metadata || {}
                ) as ReadonlyJSONValue
              }
            })
          );
        }
      };
      onSpecsChanged();
      services.kernelspecs.specsChanged.connect(onSpecsChanged);
    });
  }

  return tracker;
}

// Get the current widget and activate unless the args specify otherwise.
function getCurrent(
  tracker: INotebookTracker,
  shell: JupyterFrontEnd.IShell,
  args: ReadonlyPartialJSONObject
): NotebookPanel | null {
  const widget = tracker.currentWidget;
  const activate = args['activate'] !== false;

  if (activate && widget) {
    shell.activateById(widget.id);
  }

  return widget;
}

/**
 * Add the notebook commands to the application's command registry.
 */
function addCommands(
  app: JupyterFrontEnd,
  tracker: NotebookTracker,
  translator: ITranslator,
  sessionDialogs: ISessionContextDialogs,
  isEnabled: () => boolean
): void {
  const trans = translator.load('jupyterlab');
  const { commands, shell } = app;

  const isEnabledAndSingleSelected = (): boolean => {
    return Private.isEnabledAndSingleSelected(shell, tracker);
  };

  const refreshCellCollapsed = (notebook: Notebook): void => {
    for (const cell of notebook.widgets) {
      if (cell instanceof MarkdownCell && cell.headingCollapsed) {
        NotebookActions.setHeadingCollapse(cell, true, notebook);
      }
      if (cell.model.id === notebook.activeCell?.model?.id) {
        NotebookActions.expandParent(cell, notebook);
      }
    }
  };

  const isEnabledAndHeadingSelected = (): boolean => {
    return Private.isEnabledAndHeadingSelected(shell, tracker);
  };

  // Set up signal handler to keep the collapse state consistent
  tracker.currentChanged.connect(
    (sender: INotebookTracker, panel: NotebookPanel) => {
      if (!panel?.content?.model?.cells) {
        return;
      }
      panel.content.model.cells.changed.connect(
        (list: any, args: IObservableList.IChangedArgs<ICellModel>) => {
          // Might be overkill to refresh this every time, but
          // it helps to keep the collapse state consistent.
          refreshCellCollapsed(panel.content);
        }
      );
      panel.content.activeCellChanged.connect(
        (notebook: Notebook, cell: Cell) => {
          NotebookActions.expandParent(cell, notebook);
        }
      );
    }
  );

  tracker.selectionChanged.connect(() => {
    commands.notifyCommandChanged(CommandIDs.duplicateBelow);
    commands.notifyCommandChanged(CommandIDs.deleteCell);
    commands.notifyCommandChanged(CommandIDs.copy);
    commands.notifyCommandChanged(CommandIDs.cut);
    commands.notifyCommandChanged(CommandIDs.pasteBelow);
    commands.notifyCommandChanged(CommandIDs.pasteAbove);
    commands.notifyCommandChanged(CommandIDs.pasteAndReplace);
    commands.notifyCommandChanged(CommandIDs.moveUp);
    commands.notifyCommandChanged(CommandIDs.moveDown);
    commands.notifyCommandChanged(CommandIDs.run);
    commands.notifyCommandChanged(CommandIDs.runAll);
    commands.notifyCommandChanged(CommandIDs.runAndAdvance);
    commands.notifyCommandChanged(CommandIDs.runAndInsert);
  });
  tracker.activeCellChanged.connect(() => {
    commands.notifyCommandChanged(CommandIDs.moveUp);
    commands.notifyCommandChanged(CommandIDs.moveDown);
    commands.notifyCommandChanged(CommandIDs.setCellName);
    commands.notifyCommandChanged(CommandIDs.reactiveCodeCell);
  });

  commands.addCommand(CommandIDs.runAndAdvance, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Run Selected Cell',
        'Run Selected Cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Run this cell and advance',
        'Run these %1 cells and advance',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;
        return NotebookActions.runAndAdvance(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    icon: args => (args.toolbar ? runIcon : undefined)
  });
  commands.addCommand(CommandIDs.run, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Run Selected Cell and Do not Advance',
        'Run Selected Cells and Do not Advance',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;
        return NotebookActions.run(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.runAndInsert, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Run Selected Cell and Insert Below',
        'Run Selected Cells and Insert Below',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;
        return NotebookActions.runAndInsert(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.runAll, {
    label: trans.__('Run All Cells'),
    caption: trans.__('Run all cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;
        return NotebookActions.runAll(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.runAllAbove, {
    label: trans.__('Run All Above Selected Cell'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;
        return NotebookActions.runAllAbove(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled: () => {
      // Can't run above if there are multiple cells selected,
      // or if we are at the top of the notebook.
      return (
        isEnabledAndSingleSelected() &&
        tracker.currentWidget!.content.activeCellIndex !== 0
      );
    }
  });
  commands.addCommand(CommandIDs.runAllBelow, {
    label: trans.__('Run Selected Cell and All Below'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const { context, content } = current;
        return NotebookActions.runAllBelow(
          content,
          context.sessionContext,
          sessionDialogs,
          translator
        );
      }
    },
    isEnabled: () => {
      // Can't run below if there are multiple cells selected,
      // or if we are at the bottom of the notebook.
      return (
        isEnabledAndSingleSelected() &&
        tracker.currentWidget!.content.activeCellIndex !==
          tracker.currentWidget!.content.widgets.length - 1
      );
    }
  });
  commands.addCommand(CommandIDs.renderAllMarkdown, {
    label: trans.__('Render All Markdown Cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        const { content } = current;
        return NotebookActions.renderAllMarkdown(content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.restart, {
    label: trans.__('Restart Kernel…'),
    caption: trans.__('Restart the kernel'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return sessionDialogs.restart(current.sessionContext);
      }
    },
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    icon: args => (args.toolbar ? refreshIcon : undefined)
  });
  commands.addCommand(CommandIDs.shutdown, {
    label: trans.__('Shut Down Kernel'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (!current) {
        return;
      }

      return current.context.sessionContext.shutdown();
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.closeAndShutdown, {
    label: trans.__('Close and Shut Down Notebook'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (!current) {
        return;
      }

      const fileName = current.title.label;

      return showDialog({
        title: trans.__('Shut down the notebook?'),
        body: trans.__('Are you sure you want to close "%1"?', fileName),
        buttons: [Dialog.cancelButton(), Dialog.warnButton()]
      }).then(result => {
        if (result.button.accept) {
          return commands
            .execute(CommandIDs.shutdown, { activate: false })
            .then(() => {
              current.dispose();
            });
        }
      });
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.trust, {
    label: () => trans.__('Trust Notebook'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        const { context, content } = current;
        return NotebookActions.trust(content).then(() => context.save());
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.restartClear, {
    label: trans.__('Restart Kernel and Clear Outputs of All Cells…'),
    caption: trans.__('Restart the kernel and clear all outputs of all cells'),
    execute: async () => {
      const restarted: boolean = await commands.execute(CommandIDs.restart, {
        activate: false
      });
      if (restarted) {
        await commands.execute(CommandIDs.clearAllOutputs);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.restartAndRunToSelected, {
    label: trans.__('Restart Kernel and Run up to Selected Cell…'),
    execute: async () => {
      const restarted: boolean = await commands.execute(CommandIDs.restart, {
        activate: false
      });
      if (restarted) {
        const executed: boolean = await commands.execute(
          CommandIDs.runAllAbove,
          { activate: false }
        );
        if (executed) {
          return commands.execute(CommandIDs.run);
        }
      }
    },
    isEnabled: isEnabledAndSingleSelected
  });
  commands.addCommand(CommandIDs.restartRunAll, {
    label: trans.__('Restart Kernel and Run All Cells…'),
    caption: trans.__('Restart the kernel and run all cells'),
    execute: async () => {
      const restarted: boolean = await commands.execute(CommandIDs.restart, {
        activate: false
      });
      if (restarted) {
        await commands.execute(CommandIDs.runAll);
      }
    },
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    icon: args => (args.toolbar ? fastForwardIcon : undefined)
  });
  commands.addCommand(CommandIDs.clearAllOutputs, {
    label: trans.__('Clear Outputs of All Cells'),
    caption: trans.__('Clear all outputs of all cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.clearAllOutputs(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.clearOutputs, {
    label: trans.__('Clear Cell Output'),
    caption: trans.__('Clear outputs for the selected cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.clearOutputs(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.interrupt, {
    label: trans.__('Interrupt Kernel'),
    caption: trans.__('Interrupt the kernel'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (!current) {
        return;
      }

      const kernel = current.context.sessionContext.session?.kernel;

      if (kernel) {
        return kernel.interrupt();
      }
    },
    isEnabled: args => (args.toolbar ? true : isEnabled()),
    icon: args => (args.toolbar ? stopIcon : undefined)
  });
  commands.addCommand(CommandIDs.toCode, {
    label: trans.__('Change to Code Cell Type'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.changeCellType(current.content, 'code');
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.toMarkdown, {
    label: trans.__('Change to Markdown Cell Type'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.changeCellType(current.content, 'markdown');
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.toRaw, {
    label: trans.__('Change to Raw Cell Type'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.changeCellType(current.content, 'raw');
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.cut, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Cut Cell',
        'Cut Cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Cut this cell',
        'Cut these %1 cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.cut(current.content);
      }
    },
    icon: args => (args.toolbar ? cutIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled())
  });
  commands.addCommand(CommandIDs.copy, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Copy Cell',
        'Copy Cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Copy this cell',
        'Copy these %1 cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.copy(current.content);
      }
    },
    icon: args => (args.toolbar ? copyIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled())
  });
  commands.addCommand(CommandIDs.pasteBelow, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Paste Cell Below',
        'Paste Cells Below',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Paste this cell from the clipboard',
        'Paste these %1 cells from the clipboard',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.paste(current.content, 'below');
      }
    },
    icon: args => (args.toolbar ? pasteIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled())
  });
  commands.addCommand(CommandIDs.pasteAbove, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Paste Cell Above',
        'Paste Cells Above',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Paste this cell from the clipboard',
        'Paste these %1 cells from the clipboard',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.paste(current.content, 'above');
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.duplicateBelow, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Duplicate Cell Below',
        'Duplicate Cells Below',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Create a duplicate of this cell below',
        'Create duplicates of %1 cells below',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        NotebookActions.duplicate(current.content, 'belowSelected');
      }
    },
    icon: args => (args.toolbar ? duplicateIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled())
  });
  commands.addCommand(CommandIDs.pasteAndReplace, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Paste Cell and Replace',
        'Paste Cells and Replace',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.paste(current.content, 'replace');
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.deleteCell, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Delete Cell',
        'Delete Cells',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Delete this cell',
        'Delete these %1 cells',
        current?.content.selectedCells.length ?? 1
      );
    },

    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.deleteCells(current.content);
      }
    },
    isEnabled: args => (args.toolbar ? true : isEnabled())
  });
  commands.addCommand(CommandIDs.split, {
    label: trans.__('Split Cell'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.splitCell(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.merge, {
    label: trans.__('Merge Selected Cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.mergeCells(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.mergeAbove, {
    label: trans.__('Merge Cell Above'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.mergeCells(current.content, true);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.mergeBelow, {
    label: trans.__('Merge Cell Below'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.mergeCells(current.content, false);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.insertAbove, {
    label: trans.__('Insert Cell Above'),
    caption: trans.__('Insert a cell above'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.insertAbove(current.content);
      }
    },
    icon: args => (args.toolbar ? addAboveIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled())
  });
  commands.addCommand(CommandIDs.insertBelow, {
    label: trans.__('Insert Cell Below'),
    caption: trans.__('Insert a cell below'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.insertBelow(current.content);
      }
    },
    icon: args => (args.toolbar ? addBelowIcon : undefined),
    isEnabled: args => (args.toolbar ? true : isEnabled())
  });
  commands.addCommand(CommandIDs.selectAbove, {
    label: trans.__('Select Cell Above'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.selectAbove(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.selectBelow, {
    label: trans.__('Select Cell Below'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return NotebookActions.selectBelow(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.insertHeadingAbove, {
    label: trans.__('Insert Heading Above Current Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.insertSameLevelHeadingAbove(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.insertHeadingBelow, {
    label: trans.__('Insert Heading Below Current Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.insertSameLevelHeadingBelow(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.selectHeadingAboveOrCollapse, {
    label: trans.__('Select Heading Above or Collapse Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.selectHeadingAboveOrCollapseHeading(
          current.content
        );
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.selectHeadingBelowOrExpand, {
    label: trans.__('Select Heading Below or Expand Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.selectHeadingBelowOrExpandHeading(
          current.content
        );
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.extendAbove, {
    label: trans.__('Extend Selection Above'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.extendSelectionAbove(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.extendTop, {
    label: trans.__('Extend Selection to Top'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.extendSelectionAbove(current.content, true);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.extendBelow, {
    label: trans.__('Extend Selection Below'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.extendSelectionBelow(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.extendBottom, {
    label: trans.__('Extend Selection to Bottom'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.extendSelectionBelow(current.content, true);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.selectAll, {
    label: trans.__('Select All Cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.selectAll(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.deselectAll, {
    label: trans.__('Deselect All Cells'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.deselectAll(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.moveUp, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Move Cell Up',
        'Move Cells Up',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Move this cell up',
        'Move these %1 cells up',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        NotebookActions.moveUp(current.content);
        Private.raiseSilentNotification(
          trans.__('Notebook cell shifted up successfully'),
          current.node
        );
      }
    },
    isEnabled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (!current) {
        return false;
      }
      return current.content.activeCellIndex >= 1;
    },
    icon: args => (args.toolbar ? moveUpIcon : undefined)
  });
  commands.addCommand(CommandIDs.moveDown, {
    label: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Move Cell Down',
        'Move Cells Down',
        current?.content.selectedCells.length ?? 1
      );
    },
    caption: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      return trans._n(
        'Move this cell down',
        'Move these %1 cells down',
        current?.content.selectedCells.length ?? 1
      );
    },
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        NotebookActions.moveDown(current.content);
        Private.raiseSilentNotification(
          trans.__('Notebook cell shifted down successfully'),
          current.node
        );
      }
    },
    isEnabled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (!current || !current.content.model) {
        return false;
      }

      const length = current.content.model.cells.length;
      return current.content.activeCellIndex < length - 1;
    },
    icon: args => (args.toolbar ? moveDownIcon : undefined)
  });
  commands.addCommand(CommandIDs.toggleAllLines, {
    label: trans.__('Show Line Numbers'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.toggleAllLineNumbers(current.content);
      }
    },
    isEnabled,
    isToggled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (current) {
        const config = current.content.editorConfig;
        return !!(
          config.code.lineNumbers &&
          config.markdown.lineNumbers &&
          config.raw.lineNumbers
        );
      } else {
        return false;
      }
    }
  });
  commands.addCommand(CommandIDs.commandMode, {
    label: trans.__('Enter Command Mode'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        current.content.mode = 'command';
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.editMode, {
    label: trans.__('Enter Edit Mode'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        current.content.mode = 'edit';
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.undoCellAction, {
    label: trans.__('Undo Cell Operation'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.undo(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.redoCellAction, {
    label: trans.__('Redo Cell Operation'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.redo(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.redo, {
    label: trans.__('Redo'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const cell = current.content.activeCell;
        if (cell) {
          cell.inputHidden = false;
          return cell.editor?.redo();
        }
      }
    }
  });
  commands.addCommand(CommandIDs.undo, {
    label: trans.__('Undo'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        const cell = current.content.activeCell;
        if (cell) {
          cell.inputHidden = false;
          return cell.editor?.undo();
        }
      }
    }
  });
  commands.addCommand(CommandIDs.changeKernel, {
    label: trans.__('Change Kernel…'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return sessionDialogs.selectKernel(current.context.sessionContext);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.getKernel, {
    label: trans.__('Get Kernel'),
    execute: args => {
      const current = getCurrent(tracker, shell, { activate: false, ...args });

      if (current) {
        return current.sessionContext.session?.kernel;
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.reconnectToKernel, {
    label: trans.__('Reconnect to Kernel'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (!current) {
        return;
      }

      const kernel = current.context.sessionContext.session?.kernel;

      if (kernel) {
        return kernel.reconnect();
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.markdown1, {
    label: trans.__('Change to Heading 1'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(current.content, 1);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.markdown2, {
    label: trans.__('Change to Heading 2'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(current.content, 2);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.markdown3, {
    label: trans.__('Change to Heading 3'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(current.content, 3);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.markdown4, {
    label: trans.__('Change to Heading 4'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(current.content, 4);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.markdown5, {
    label: trans.__('Change to Heading 5'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(current.content, 5);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.markdown6, {
    label: trans.__('Change to Heading 6'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.setMarkdownHeader(current.content, 6);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.hideCode, {
    label: trans.__('Collapse Selected Code'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.hideCode(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.showCode, {
    label: trans.__('Expand Selected Code'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.showCode(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.hideAllCode, {
    label: trans.__('Collapse All Code'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.hideAllCode(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.showAllCode, {
    label: trans.__('Expand All Code'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.showAllCode(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.hideOutput, {
    label: trans.__('Collapse Selected Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.hideOutput(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.showOutput, {
    label: trans.__('Expand Selected Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.showOutput(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.hideAllOutputs, {
    label: trans.__('Collapse All Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.hideAllOutputs(current.content);
      }
    },
    isEnabled
  });

  commands.addCommand(CommandIDs.toggleRenderSideBySideCurrentNotebook, {
    label: trans.__('Render Side-by-Side'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        if (current.content.renderingLayout === 'side-by-side') {
          return NotebookActions.renderDefault(current.content);
        }
        return NotebookActions.renderSideBySide(current.content);
      }
    },
    isEnabled,
    isToggled: args => {
      const current = getCurrent(tracker, shell, { ...args, activate: false });
      if (current) {
        return current.content.renderingLayout === 'side-by-side';
      } else {
        return false;
      }
    }
  });

  commands.addCommand(CommandIDs.showAllOutputs, {
    label: trans.__('Expand All Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.showAllOutputs(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.enableOutputScrolling, {
    label: trans.__('Enable Scrolling for Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.enableOutputScrolling(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.disableOutputScrolling, {
    label: trans.__('Disable Scrolling for Outputs'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.disableOutputScrolling(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.selectLastRunCell, {
    label: trans.__('Select current running or last run cell'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);

      if (current) {
        return NotebookActions.selectLastRunCell(current.content);
      }
    },
    isEnabled
  });
  commands.addCommand(CommandIDs.replaceSelection, {
    label: trans.__('Replace Selection in Notebook Cell'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      const text: string = (args['text'] as string) || '';
      if (current) {
        return NotebookActions.replaceSelection(current.content, text);
      }
    },
    isEnabled
  });

  commands.addCommand(CommandIDs.toggleCollapseCmd, {
    label: trans.__('Toggle Collapse Notebook Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return NotebookActions.toggleCurrentHeadingCollapse(current.content);
      }
    },
    isEnabled: isEnabledAndHeadingSelected
  });
  commands.addCommand(CommandIDs.collapseAllCmd, {
    label: trans.__('Collapse All Headings'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return NotebookActions.collapseAllHeadings(current.content);
      }
    }
  });
  commands.addCommand(CommandIDs.expandAllCmd, {
    label: trans.__('Expand All Headings'),
    execute: args => {
      const current = getCurrent(tracker, shell, args);
      if (current) {
        return NotebookActions.expandAllHeadings(current.content);
      }
    }
  });

  commands.addCommand(CommandIDs.tocRunCells, {
    label: trans.__('Select and Run Cell(s) for this Heading'),
    execute: args => {
      const current = getCurrent(tracker, shell, { activate: false, ...args });
      if (current === null) {
        return;
      }

      const activeCell = current.content.activeCell;
      let lastIndex = current.content.activeCellIndex;

      if (activeCell instanceof MarkdownCell) {
        const cells = current.content.widgets;
        const level = activeCell.headingInfo.level;
        for (
          let i = current.content.activeCellIndex + 1;
          i < cells.length;
          i++
        ) {
          const cell = cells[i];
          if (
            cell instanceof MarkdownCell &&
            // cell.headingInfo.level === -1 if no heading
            cell.headingInfo.level >= 0 &&
            cell.headingInfo.level <= level
          ) {
            break;
          }
          lastIndex = i;
        }
      }

      current.content.extendContiguousSelectionTo(lastIndex);

      NotebookActions.run(
        current.content,
        current.sessionContext,
        sessionDialogs,
        translator
      );
    }
  });

  commands.addCommand(CommandIDs.addCellName, {
    label: 'Add Cell Name',
    execute: async args => {
      const cell = tracker.currentWidget?.content.activeCell as CodeCell;
      if (cell == null) {
        return;
      }

      const existingCellTags = new Set();
      let cells = tracker.currentWidget?.content.model?.cells;
      if (cells){
        for (let index = 0; index < cells.length; index++) {
          let cAny = cells.get(index)
          if (cAny.type == 'code'){
            const dfmetadata = cAny.getMetadata('dfmetadata');
            const cellTagvalue = dfmetadata.tag;
            if(cellTagvalue){
              existingCellTags.add(cellTagvalue);
            }
          }
        }
      }

      const inputArea = cell.inputArea as any;  
      const hexRegexp = new RegExp('^[0-9a-f]{8}$');
      const pythonVarRegexp = new RegExp('^[a-zA-Z0-9_]*$');
  
      // Function to create the dialog node
      const createTagNode = (oldTag: string, errorMessage: string = ''): HTMLElement => {
        const body = document.createElement('div');
  
        const input = document.createElement('input');
        input.name = 'tag-name';
        input.placeholder = 'Enter tag name';
        input.style.margin = '10px 0 10px 0';

        const message = document.createElement('div');
        message.style.color = 'red';
        message.style.marginTop = '10px';
        message.id = 'error-message';
        message.textContent = errorMessage;
  
        body.appendChild(input);
        body.appendChild(document.createElement('br'));
        body.appendChild(message);
  
        return body;
      };
      
      const showAddTagDialog = async (errorMessage: string = ''): Promise<{ newTag: string } | null> => {
        const dialogNode = createTagNode(inputArea.tag, errorMessage);
        const widgetNode = new Widget();
        widgetNode.node.appendChild(dialogNode);
  
        const result = await showDialog({
          title: 'Add Cell Name',
          body: widgetNode,
          buttons: [
            Dialog.cancelButton(),
            Dialog.okButton({ label: 'Add' })
          ],
          focusNodeSelector: 'input[name="tag-name"]',
        });
  
        if (result.button.accept) {
          const newTag = (dialogNode.querySelector('input[name="tag-name"]') as HTMLInputElement).value;
          if (newTag.trim() === '') {
            return await showAddTagDialog('Name cannot be empty or whitespace. Enter a valid name.');
          } else if (!pythonVarRegexp.test(newTag)) {
            return await showAddTagDialog('Invalid name (follow python identifier rules). Enter a valid name.');
          } else if (hexRegexp.test(newTag)) {
            return await showAddTagDialog('Cell names cannot be 8 hex values. Enter a valid name.');
          } else if (existingCellTags.has(newTag)){
            return await showAddTagDialog('This name already exists. Enter a different name.');
          } else {
            return { newTag };
          }
        }
        return null;
      };
  
      const result = await showAddTagDialog();
      const cellUUID = truncateCellId(cell.model.id)
      if (result) {
        const { newTag } = result;
        inputArea.addTag(newTag);
        if (newTag && tracker.currentWidget?.content.model) {
          let notebook = tracker.currentWidget.content.model as DataflowNotebookModel;
          await updateNotebookCellsWithTag(notebook, cellUUID, tracker.currentWidget.sessionContext)
        }
      }
    },
    isEnabled: () => {
      const cell = tracker.currentWidget?.content.activeCell as CodeCell;
      const isTagsVisible = tracker.currentWidget?.model?.getMetadata('enable_tags');
      if(cell && cell.model.type == 'code' && cell.inputArea){
        const inputArea = cell.inputArea as DataflowInputArea;
        return (inputArea.tag?.length ? false : true) && isTagsVisible;
      }
      return false;
    },
    isVisible: () => {
      const isDfnotebook = tracker.currentWidget?.model?.getMetadata('dfnotebook')
      return isDfnotebook === true;
    }
  });
  
  commands.addCommand(CommandIDs.modifyCellName, {
    label: 'Modify Cell Name',
    execute: async args => {
      const cell = tracker.currentWidget?.content.activeCell as CodeCell;
      const existingCellTags = new Set();

      let cells = tracker.currentWidget?.content.model?.cells;
      if (cells){
        for (let index = 0; index < cells.length; index++) {
          let cAny = cells.get(index)
          if (cAny.type == 'code'){
            const dfmetadata = cAny.getMetadata('dfmetadata');
            const cellTagvalue = dfmetadata.tag;
            if(cellTagvalue){
              existingCellTags.add(cellTagvalue);
            }
          }
        }
      }

      if (cell == null) {
        return;
      }
  
      const inputArea = cell.inputArea as any;
  
      if (!inputArea.tag) {
        alert('This cell does not have a tag.');
        return;
      }
  
      const hexRegexp = new RegExp('^[0-9a-f]{8}$');
      const pythonVarRegexp = new RegExp('^[a-zA-Z0-9_]*$');
  
      // Function to create the dialog node
      const createRenameTagNode = (oldTag: string, errorMessage: string = ''): HTMLElement => {
        const body = document.createElement('div');
  
        const inputLabel = document.createElement('label');
        inputLabel.textContent = `Current Tag: ${oldTag}`;
  
        const input = document.createElement('input');
        input.name = 'new-tag';
        input.placeholder = 'Enter new tag';
        input.classList.add('rename-tag-input');
  
        const updateReferencesLabel = document.createElement('label');
        updateReferencesLabel.textContent = 'Update references';
        updateReferencesLabel.classList.add('update-references-label');
      
        const updateReferencesCheckbox = document.createElement('input');
        updateReferencesCheckbox.name = 'update-references';
        updateReferencesCheckbox.type = 'checkbox';
        updateReferencesCheckbox.checked = true;
        updateReferencesCheckbox.classList.add('update-references-checkbox');

        const message = document.createElement('div');
        message.id = 'error-message';
        message.textContent = errorMessage;
        message.classList.add('error-message');
  
        body.appendChild(inputLabel);
        body.appendChild(document.createElement('br'));
        body.appendChild(input);
        body.appendChild(document.createElement('br'));
        body.appendChild(updateReferencesLabel);
        body.appendChild(updateReferencesCheckbox);
        body.appendChild(message);
  
        return body;
      };
  
      const showModifyTagDialog = async (errorMessage: string = ''): Promise<{ newTag: string, updateReferences: boolean } | null> => {
        const dialogNode = createRenameTagNode(inputArea.tag, errorMessage);
        const widgetNode = new Widget();
        widgetNode.node.appendChild(dialogNode);
        
        const result = await showDialog({
          title: 'Modify Cell Name',
          body: widgetNode,
          buttons: [
            Dialog.cancelButton(),
            Dialog.okButton({ label: 'Delete' }),
            Dialog.okButton({ label: 'Modify' })
          ],
          focusNodeSelector: 'input[name="new-tag"]',
        });
  
        if (result.button.accept) {
          const newTag = (dialogNode.querySelector('input[name="new-tag"]') as HTMLInputElement).value;
          const updateReferences = (dialogNode.querySelector('input[name="update-references"]') as HTMLInputElement).checked;
          const deleteTag = result.button.label === 'Delete';

          if (deleteTag) {
            return { newTag: '', updateReferences };
          }

          if (newTag.trim() === '') {
            return await showModifyTagDialog('Name cannot be empty or whitespace. Enter a valid name.');
          } else if (!pythonVarRegexp.test(newTag)) {
            return await showModifyTagDialog('Invalid name (follow python identifier rules). Enter a valid name.');
          } else if (hexRegexp.test(newTag)) {
            return await showModifyTagDialog('Cell names cannot be 8 hex values. Enter a valid name.');
          } else if (existingCellTags.has(newTag)){
            return await showModifyTagDialog('This name already exists. Enter a different name.');
          } else {
            return { newTag, updateReferences };
          }
        }
        return null;
      };
  
      const result = await showModifyTagDialog();
      const cellUUID = truncateCellId(cell.model.id);
      if (result) {
        const { newTag, updateReferences } = result;
        inputArea.addTag(newTag);

        if (updateReferences && tracker.currentWidget?.content.model) {
          let notebook = tracker.currentWidget.content.model as DataflowNotebookModel;
          await updateNotebookCellsWithTag(notebook, cellUUID, tracker.currentWidget.sessionContext)
        } else if (updateReferences == false && tracker.currentWidget?.content.model) {
          let notebook = tracker.currentWidget.content.model as DataflowNotebookModel;
          const all_tags: { [key: string]: string } = {};

          for (let index = 0; index < notebook.cells.length; index++) {
            const cAny = notebook.cells.get(index) as ICodeCellModel;
            if (notebook.cells.get(index).type === 'code') {
              const c = cAny as ICodeCellModel;
              const cId = truncateCellId(c.id);
              const dfmetadata = c.getMetadata('dfmetadata');
              if (dfmetadata.tag){
                all_tags[cId] = dfmetadata.tag;
              }
            }
          }
          
          for (let index = 0; index < notebook.cells.length; index++) {
            const cAny = notebook.cells.get(index) as ICodeCellModel;
            if (cAny.type == 'code') {
              const dfmetadata = notebook.cells.get(index).getMetadata('dfmetadata');
              let inputVarsMetadata = dfmetadata.inputVars;
              if (inputVarsMetadata && typeof inputVarsMetadata === 'object' && 'ref' in inputVarsMetadata) {
                const refValue = inputVarsMetadata.ref as { [key: string]: any };
                const tagRefValue: { [key: string]: any } = {};
                for (const ref_key in refValue) {
                  if (ref_key != cellUUID && all_tags.hasOwnProperty(ref_key)) {
                    tagRefValue[ref_key] = all_tags[ref_key];
                  }
                }
                dfmetadata.inputVars = { 'ref': refValue, 'tag_refs': tagRefValue };
                notebook.cells.get(index).setMetadata('dfmetadata', dfmetadata);
                await updateNotebookCellsWithTag(notebook, cellUUID, tracker.currentWidget.sessionContext, false, true)
              }
            }
          }
        }
      }
    },
    isEnabled: () => {
      const cell = tracker.currentWidget?.content.activeCell as CodeCell;
      const isTagsVisible = tracker.currentWidget?.model?.getMetadata('enable_tags');
      if (cell && cell.model.type == 'code' && cell.inputArea) {
        const inputArea = cell.inputArea as DataflowInputArea;
        return inputArea.tag?.length && isTagsVisible;
      }
      return false;
    },
    isVisible: () => {
      const isDfnotebook = tracker.currentWidget?.model?.getMetadata('dfnotebook')
      return isDfnotebook === true;
    }
  });

  commands.addCommand(CommandIDs.setCellName, {
    label: 'Cell Name',
    caption: 'Cell Name',
    execute: args => {
      const cell = tracker.currentWidget?.content.activeCell as CodeCell;
      const inputArea = cell.inputArea as DataflowInputArea;
      if(cell && inputArea && inputArea.tag){
        commands.execute('notebook:modify-cell-name');
      }
      else{
        commands.execute('notebook:add-cell-name');
      }
    },
    isEnabled: () => {
      const isDfnotebook = tracker.currentWidget?.model?.getMetadata('dfnotebook')
      const isTagsVisible = tracker.currentWidget?.model?.getMetadata('enable_tags');
      return isDfnotebook && isTagsVisible;
    },
    isVisible: () => {
      const isDfnotebook = tracker.currentWidget?.model?.getMetadata('dfnotebook')
      const activeCell = tracker.activeCell;
      return isDfnotebook && activeCell?.model.type === 'code';
    },
    icon: args => (args.toolbar ? tagIcon : undefined)
  });

  commands.addCommand(CommandIDs.reactiveCodeCell, {
    label: trans.__('Reactive'),
    caption: trans.__('Reactive'),
    execute: args => {
      const cell = tracker.currentWidget?.content.activeCell as CodeCell;
      const metadata = cell.model.getMetadata('dfmetadata');
      metadata.isReactive = !metadata.isReactive;
      cell.model.setMetadata('dfmetadata', metadata);
      commands.notifyCommandChanged('toolbar-button:reactive-cell')
    },
    isEnabled: () => {
      const isDfnotebook = tracker.currentWidget?.model?.getMetadata('dfnotebook')
      const reactiveModeOn = tracker.currentWidget?.model?.getMetadata('enable_reactive');
      return isDfnotebook && reactiveModeOn;
    },
    isVisible: () => {
      const isDfnotebook = tracker.currentWidget?.model?.getMetadata('dfnotebook')
      return isDfnotebook;
    },
    icon: args => {
      if (!args.toolbar) return undefined;
      const cell = tracker.currentWidget?.content.activeCell as CodeCell;
      const metadata = cell.model.getMetadata('dfmetadata');

      // assume reactive unless otherwise indicated
      return metadata?.isReactive ?? true ? nonReactiveIcon : reactiveIcon;
    }
  });

  // !!! END DATAFLOW NOTEBOOK CHANGE !!!
}

/**
 * Update code based on add, delete or modified tag value
 */
export async function updateNotebookCellsWithTag(notebook: DataflowNotebookModel, cellUUID: string, sessionContext: ISessionContext, hideTags: boolean=false, updateInputTagsOnly: boolean=false, initialStart: boolean=false) {
  let dfData = getCellsMetadata(notebook, '');
  
  if (hideTags) {
    dfData.dfMetadata.input_tags = {};
  }

  if (updateInputTagsOnly){
    dfData.dfMetadata.all_refs = {}
    dfData.dfMetadata.output_tags = {}
    dfData.dfMetadata.code_dict = {}
  }

  if(initialStart){
    const cellsArray = Array.from(notebook.cells);

    cellsArray.forEach((cell, index) => {
      if (cell.type === 'code') {
        const cAny = cell as CodeCellModel;
        const cId = truncateCellId(cAny.id);
        //@ts-expect-error
        cAny._executedCode = dfData.dfMetadata.code_dict[cId];;
      }
    });
    dfData.dfMetadata.executed_code = dfData.dfMetadata.code_dict
  }

  try {
    const response = await dfCommGetData(sessionContext, {'dfMetadata': dfData.dfMetadata, 'updateExecutedCode': true});
    updateNotebookCells(notebook, response, cellUUID, hideTags);
  } catch (error) {
    console.error('Error occured during kernel communication', error);
  }
}

function updateNotebookCells(notebook: DataflowNotebookModel, content: any, cellUUID: string, hideTags: boolean): void {
  const all_Tags = getAllTags(notebook);
  const cellsArray = Array.from(notebook.cells);

  cellsArray.forEach((cell, index) => {
    if (cell.type === 'code') {
      const cAny = cell as CodeCellModel;
      const cId = truncateCellId(cAny.id);

      // Handle executed code updates
      if (content.executed_code_dict?.hasOwnProperty(cId)) {
        //@ts-expect-error
        cAny._executedCode = content.executed_code_dict[cId];
      }

      // Handle code dictionary updates
      if (content.code_dict?.hasOwnProperty(cId)) {
        cAny.sharedModel.setSource(content.code_dict[cId]);
      }

      //Updating the dependent cell's df-metadata when any cell is tagged/untagged
      if (cellUUID && !hideTags) {
        const dfmetadata = cAny.getMetadata('dfmetadata');
        const inputVarsMetadata = dfmetadata.inputVars;
        if (inputVarsMetadata && typeof inputVarsMetadata === 'object' && 'ref' in inputVarsMetadata) {
          const refValue = inputVarsMetadata.ref as { [key: string]: any };
          let tagRefValue = inputVarsMetadata.tag_refs as { [key: string]: any };
          for (const ref_key in refValue) {
            if (ref_key == cellUUID && all_Tags.hasOwnProperty(ref_key)) {
              tagRefValue[cellUUID] = all_Tags[cellUUID];
            }
          }
          dfmetadata.inputVars = { 'ref': refValue, 'tag_refs': tagRefValue };
          notebook.cells.get(index).setMetadata('dfmetadata', dfmetadata);
        }
      }
    }
  });
}

/**
 * Populate the application's command palette with notebook commands.
 */
function populatePalette(
  palette: ICommandPalette,
  translator: ITranslator
): void {
  const trans = translator.load('jupyterlab');
  let category = trans.__('Notebook Operations');

  [
    CommandIDs.interrupt,
    CommandIDs.restart,
    CommandIDs.restartClear,
    CommandIDs.restartRunAll,
    CommandIDs.runAll,
    CommandIDs.renderAllMarkdown,
    CommandIDs.runAllAbove,
    CommandIDs.runAllBelow,
    CommandIDs.restartAndRunToSelected,
    CommandIDs.selectAll,
    CommandIDs.deselectAll,
    CommandIDs.clearAllOutputs,
    CommandIDs.toggleAllLines,
    CommandIDs.editMode,
    CommandIDs.commandMode,
    CommandIDs.changeKernel,
    CommandIDs.reconnectToKernel,
    CommandIDs.createConsole,
    CommandIDs.closeAndShutdown,
    CommandIDs.trust,
    CommandIDs.toggleCollapseCmd,
    CommandIDs.collapseAllCmd,
    CommandIDs.expandAllCmd
  ].forEach(command => {
    palette.addItem({ command, category });
  });

  palette.addItem({
    command: CommandIDs.createNew,
    category,
    args: { isPalette: true }
  });

  category = trans.__('Notebook Cell Operations');
  [
    CommandIDs.run,
    CommandIDs.runAndAdvance,
    CommandIDs.runAndInsert,
    CommandIDs.runInConsole,
    CommandIDs.clearOutputs,
    CommandIDs.toCode,
    CommandIDs.toMarkdown,
    CommandIDs.toRaw,
    CommandIDs.cut,
    CommandIDs.copy,
    CommandIDs.pasteBelow,
    CommandIDs.pasteAbove,
    CommandIDs.pasteAndReplace,
    CommandIDs.deleteCell,
    CommandIDs.split,
    CommandIDs.merge,
    CommandIDs.mergeAbove,
    CommandIDs.mergeBelow,
    CommandIDs.insertAbove,
    CommandIDs.insertBelow,
    CommandIDs.selectAbove,
    CommandIDs.selectBelow,
    CommandIDs.selectHeadingAboveOrCollapse,
    CommandIDs.selectHeadingBelowOrExpand,
    CommandIDs.insertHeadingAbove,
    CommandIDs.insertHeadingBelow,
    CommandIDs.extendAbove,
    CommandIDs.extendTop,
    CommandIDs.extendBelow,
    CommandIDs.extendBottom,
    CommandIDs.moveDown,
    CommandIDs.moveUp,
    CommandIDs.undoCellAction,
    CommandIDs.redoCellAction,
    CommandIDs.markdown1,
    CommandIDs.markdown2,
    CommandIDs.markdown3,
    CommandIDs.markdown4,
    CommandIDs.markdown5,
    CommandIDs.markdown6,
    CommandIDs.hideCode,
    CommandIDs.showCode,
    CommandIDs.hideAllCode,
    CommandIDs.showAllCode,
    CommandIDs.hideOutput,
    CommandIDs.showOutput,
    CommandIDs.hideAllOutputs,
    CommandIDs.showAllOutputs,
    CommandIDs.toggleRenderSideBySideCurrentNotebook,
    CommandIDs.setSideBySideRatio,
    CommandIDs.enableOutputScrolling,
    CommandIDs.disableOutputScrolling,
    CommandIDs.setCellName,
    CommandIDs.reactiveCodeCell
  ].forEach(command => {
    palette.addItem({ command, category });
  });
}

/**
 * Populates the application menus for the notebook.
 */
function populateMenus(mainMenu: IMainMenu, isEnabled: () => boolean): void {
  // Add undo/redo hooks to the edit menu.
  mainMenu.editMenu.undoers.redo.add({
    id: CommandIDs.redo,
    isEnabled
  });
  mainMenu.editMenu.undoers.undo.add({
    id: CommandIDs.undo,
    isEnabled
  });

  // Add a clearer to the edit menu
  mainMenu.editMenu.clearers.clearAll.add({
    id: CommandIDs.clearAllOutputs,
    isEnabled
  });
  mainMenu.editMenu.clearers.clearCurrent.add({
    id: CommandIDs.clearOutputs,
    isEnabled
  });

  // Add a console creator the the Kernel menu
  mainMenu.fileMenu.consoleCreators.add({
    id: CommandIDs.createConsole,
    isEnabled
  });

  // Add a close and shutdown command to the file menu.
  mainMenu.fileMenu.closeAndCleaners.add({
    id: CommandIDs.closeAndShutdown,
    isEnabled
  });

  // Add a kernel user to the Kernel menu
  mainMenu.kernelMenu.kernelUsers.changeKernel.add({
    id: CommandIDs.changeKernel,
    isEnabled
  });
  mainMenu.kernelMenu.kernelUsers.clearWidget.add({
    id: CommandIDs.clearAllOutputs,
    isEnabled
  });
  mainMenu.kernelMenu.kernelUsers.interruptKernel.add({
    id: CommandIDs.interrupt,
    isEnabled
  });
  mainMenu.kernelMenu.kernelUsers.reconnectToKernel.add({
    id: CommandIDs.reconnectToKernel,
    isEnabled
  });
  mainMenu.kernelMenu.kernelUsers.restartKernel.add({
    id: CommandIDs.restart,
    isEnabled
  });
  mainMenu.kernelMenu.kernelUsers.shutdownKernel.add({
    id: CommandIDs.shutdown,
    isEnabled
  });

  // Add an IEditorViewer to the application view menu
  mainMenu.viewMenu.editorViewers.toggleLineNumbers.add({
    id: CommandIDs.toggleAllLines,
    isEnabled
  });

  // Add an ICodeRunner to the application run menu
  mainMenu.runMenu.codeRunners.restart.add({
    id: CommandIDs.restart,
    isEnabled
  });
  mainMenu.runMenu.codeRunners.run.add({
    id: CommandIDs.runAndAdvance,
    isEnabled
  });
  mainMenu.runMenu.codeRunners.runAll.add({ id: CommandIDs.runAll, isEnabled });

  // Add kernel information to the application help menu.
  mainMenu.helpMenu.getKernel.add({
    id: CommandIDs.getKernel,
    isEnabled
  });
}

/**
 * A namespace for module private functionality.
 */
namespace Private {
  /**
   * Create a console connected with a notebook kernel
   *
   * @param commands Commands registry
   * @param widget Notebook panel
   * @param activate Should the console be activated
   */
  export function createConsole(
    commands: CommandRegistry,
    widget: NotebookPanel,
    activate?: boolean
  ): Promise<void> {
    const options = {
      path: widget.context.path,
      preferredLanguage: widget.context.model.defaultKernelLanguage,
      activate: activate,
      ref: widget.id,
      insertMode: 'split-bottom',
      type: 'Linked Console'
    };

    return commands.execute('console:create', options);
  }

  /**
   * Whether there is an active notebook.
   */
  export function isEnabled(
    shell: JupyterFrontEnd.IShell,
    tracker: INotebookTracker
  ): boolean {
    return (
      tracker.currentWidget !== null &&
      tracker.currentWidget === shell.currentWidget
    );
  }

  /**
   * Whether there is an notebook active, with a single selected cell.
   */
  export function isEnabledAndSingleSelected(
    shell: JupyterFrontEnd.IShell,
    tracker: INotebookTracker
  ): boolean {
    if (!Private.isEnabled(shell, tracker)) {
      return false;
    }
    const { content } = tracker.currentWidget!;
    const index = content.activeCellIndex;
    // If there are selections that are not the active cell,
    // this command is confusing, so disable it.
    for (let i = 0; i < content.widgets.length; ++i) {
      if (content.isSelected(content.widgets[i]) && i !== index) {
        return false;
      }
    }
    return true;
  }

  /**
   * Whether there is an notebook active, with a single selected cell.
   */
  export function isEnabledAndHeadingSelected(
    shell: JupyterFrontEnd.IShell,
    tracker: INotebookTracker
  ): boolean {
    if (!Private.isEnabled(shell, tracker)) {
      return false;
    }
    const { content } = tracker.currentWidget!;
    const index = content.activeCellIndex;
    if (!(content.activeCell instanceof MarkdownCell)) {
      return false;
    }
    // If there are selections that are not the active cell,
    // this command is confusing, so disable it.
    for (let i = 0; i < content.widgets.length; ++i) {
      if (content.isSelected(content.widgets[i]) && i !== index) {
        return false;
      }
    }
    return true;
  }

  /**
   * The default Export To ... formats and their human readable labels.
   */
  export function getFormatLabels(translator: ITranslator): {
    [k: string]: string;
  } {
    translator = translator || nullTranslator;
    const trans = translator.load('jupyterlab');
    return {
      html: trans.__('HTML'),
      latex: trans.__('LaTeX'),
      markdown: trans.__('Markdown'),
      pdf: trans.__('PDF'),
      rst: trans.__('ReStructured Text'),
      script: trans.__('Executable Script'),
      slides: trans.__('Reveal.js Slides')
    };
  }

  /**
   * Raises a silent notification that is read by screen readers
   *
   * FIXME: Once a notificatiom API is introduced (https://github.com/jupyterlab/jupyterlab/issues/689),
   * this can be refactored to use the same.
   *
   * More discussion at https://github.com/jupyterlab/jupyterlab/pull/9031#issuecomment-773541469
   *
   *
   * @param message Message to be relayed to screen readers
   * @param notebookNode DOM node to which the notification container is attached
   */
  export function raiseSilentNotification(
    message: string,
    notebookNode: HTMLElement
  ): void {
    const hiddenAlertContainerId = `sr-message-container-${notebookNode.id}`;

    const hiddenAlertContainer =
      document.getElementById(hiddenAlertContainerId) ||
      document.createElement('div');

    // If the container is not available, append the newly created container
    // to the current notebook panel and set related properties
    if (hiddenAlertContainer.getAttribute('id') !== hiddenAlertContainerId) {
      hiddenAlertContainer.classList.add('sr-only');
      hiddenAlertContainer.setAttribute('id', hiddenAlertContainerId);
      hiddenAlertContainer.setAttribute('role', 'alert');
      hiddenAlertContainer.hidden = true;
      notebookNode.appendChild(hiddenAlertContainer);
    }

    // Insert/Update alert container with the notification message
    hiddenAlertContainer.innerText = message;
  }

  /**
   * A widget hosting a cloned output area.
   */
  export class ClonedOutputArea extends Panel {
    constructor(options: ClonedOutputArea.IOptions) {
      super();
      const trans = (options.translator || nullTranslator).load('jupyterlab');
      this._notebook = options.notebook;
      this._index = options.index !== undefined ? options.index : -1;
      this._cell = options.cell || null;
      this.id = `LinkedOutputView-${UUID.uuid4()}`;
      this.title.label = 'Output View';
      this.title.icon = notebookIcon;
      this.title.caption = this._notebook.title.label
        ? trans.__('For Notebook: %1', this._notebook.title.label)
        : trans.__('For Notebook:');
      this.addClass('jp-LinkedOutputView');

      // Wait for the notebook to be loaded before
      // cloning the output area.
      void this._notebook.context.ready.then(() => {
        if (!this._cell) {
          this._cell = this._notebook.content.widgets[this._index] as CodeCell;
        }
        if (!this._cell || this._cell.model.type !== 'code') {
          this.dispose();
          return;
        }
        const clone = this._cell.cloneOutputArea();
        this.addWidget(clone);
      });
    }

    /**
     * The index of the cell in the notebook.
     */
    get index(): number {
      return this._cell
        ? ArrayExt.findFirstIndex(
            this._notebook.content.widgets,
            c => c === this._cell
          )
        : this._index;
    }

    /**
     * The path of the notebook for the cloned output area.
     */
    get path(): string {
      return this._notebook.context.path;
    }

    private _notebook: NotebookPanel;
    private _index: number;
    private _cell: CodeCell | null = null;
  }

  /**
   * ClonedOutputArea statics.
   */
  export namespace ClonedOutputArea {
    export interface IOptions {
      /**
       * The notebook associated with the cloned output area.
       */
      notebook: NotebookPanel;

      /**
       * The cell for which to clone the output area.
       */
      cell?: CodeCell;

      /**
       * If the cell is not available, provide the index
       * of the cell for when the notebook is loaded.
       */
      index?: number;

      /**
       * If the cell is not available, provide the index
       * of the cell for when the notebook is loaded.
       */
      translator?: ITranslator;
    }
  }
}
