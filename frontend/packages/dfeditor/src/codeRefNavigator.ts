import { JupyterFrontEnd } from '@jupyterlab/application';
import { Extension, RangeSetBuilder } from '@codemirror/state';
import { IEditorExtensionRegistry, EditorExtensionRegistry } from '@jupyterlab/codemirror';
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate
} from '@codemirror/view';
import { INotebookTracker, Notebook } from '@jupyterlab/notebook';
import { 
  caretUpEmptyThinIcon, 
  caretDownEmptyThinIcon, 
  closeIcon, 
  LabIcon
} from '@jupyterlab/ui-components';
import { VariableScopeAnalyzer } from './parser';
import { truncateCellId } from '@dfnotebook/dfutils';

export const NAVIGATE_UP_COMMAND = 'notebook:highlight-navigate-up';
export const NAVIGATE_DOWN_COMMAND = 'notebook:highlight-navigate-down';

// Defines new styles for this extension
const baseTheme = EditorView.baseTheme({
    '.cm-highlightRef span': { 
      color: '#0a31ff',
    },
    '.cm-highlightRef span:hover': {
      textDecoration: 'underline',
      textDecorationthickness: '1.5px'
    },
    '.cm-highlightRef':{
      color: '#0a31ff'
    },
    '.cm-highlightRef:hover':{
      textDecoration: 'underline',
      textDecorationthickness: '1.5px'
    },
    '.cm-highlightYellow': {
      backgroundColor: 'yellow'
    }
});

const referenceIdStyle = Decoration.mark({
  class: 'cm-highlightRef'
});

const highlightYellowStyle = Decoration.mark({
  class: 'cm-highlightYellow'
});

const notebookStates = new Map<string, {
  highlightedVariable: string | null,
  highlightedVariableWithTag: string | null,
  highlightedVariableWithRefID: string | null,
  highlightedRefId: string | null,
  cellIdInIteration: string | null,
  navigationBar: HTMLDivElement | null,
  variableScopeMap: Map<string, string>,
  selectionMap: Map<string, string>,
  computingDecorationCellId: string | null;
}>();

function getNotebookState(notebook: Notebook) {
  const notebookId = notebook.id;
  if (!notebookStates.has(notebookId)) {
    notebookStates.set(notebookId, {
      highlightedVariable: null,
      highlightedVariableWithTag: null,
      highlightedVariableWithRefID: null,
      highlightedRefId: null,
      cellIdInIteration: null,
      navigationBar: null,
      computingDecorationCellId: null,
      variableScopeMap: new Map(),
      selectionMap: new Map()
    });
  }
  return notebookStates.get(notebookId)!;
}

function analyzeAndHighlightVariables(cellContent: string, notebook: Notebook): DecorationSet {
  let builder = new RangeSetBuilder<Decoration>();
  const state = getNotebookState(notebook);
  state.variableScopeMap = new Map();
  if (cellContent === '') {
    return Decoration.none;;
  }

  const linker = new VariableScopeAnalyzer();
  const results = linker.analyzeCode(cellContent);
  const referenceVariables = nbGetOutputVars(notebook)
  
  results.forEach(variable => {
    if((variable.scope == 'undefined' && referenceVariables.has(variable.name))||(variable.name.includes('$'))){
      builder.add(variable.from, variable.to, referenceIdStyle);
      state.variableScopeMap.set(`${variable.from}-${variable.to}`, 'undefined')

      if(state.highlightedVariable){
        if(variable.name === state.highlightedVariable || variable.name === state.highlightedVariableWithRefID || variable.name === state.highlightedVariableWithTag){
          builder.add(variable.from, variable.to, highlightYellowStyle);
        }
      }
    }    
  });

  const rangeSet = builder.finish();
  if (state.computingDecorationCellId != null){
    let cursor = rangeSet.iter();

    while (cursor.value) {
      const { from, to, value } = cursor;
      console.log(`Range from ${from} to ${to} has decoration: ${value.spec.class}`);
      if(value.spec.class == 'cm-highlightYellow'){
        state.selectionMap.set(state.computingDecorationCellId, `${from}-${to}`)
      }
      cursor.next();
    }
  }
  
  return rangeSet;
}

function handleRightClick(event: MouseEvent, view: EditorView, notebookTracker: INotebookTracker){
    const notebook = notebookTracker.currentWidget?.content;
    if (!notebook) return;

    const state = getNotebookState(notebook);
    let clickedCellIndex = -1;
    for (let i = 0; i < notebook.widgets.length; i++) {
        const cell = notebook.widgets[i];
        if (cell.node.contains(event.target as HTMLElement)) {
            clickedCellIndex = i;
            break;
        }
    }

    if (clickedCellIndex === -1) return;

    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos != null) {
      const decorations = analyzeAndHighlightVariables(view.state.doc.toString(), notebook);
      
      let variable = '';
      let variableScope:string|undefined|null = null;
      decorations.between(pos, pos, (from, to) => {
        variableScope = state.variableScopeMap.get(`${from}-${to}`);
        variable = view.state.doc.sliceString(from, to);
        return false;// Stop after finding the first decoration
      });
      
      if (variable) {
        event.preventDefault();
        event.stopPropagation(); // Prevent JupyterLab's context menu from appearing
        showCustomContextMenu(event, variable, variableScope, notebookTracker, clickedCellIndex);
      }
    }
}

function showCustomContextMenu(event: MouseEvent, variable: string, variableScope:string|null, notebookTracker: INotebookTracker, currentCellIndex: number) {
  const existingMenu = document.querySelector('.reference-context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  const menu = document.createElement('div');
  menu.className = 'reference-context-menu';
  menu.style.position = 'fixed';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.style.backgroundColor = '#fff';
  menu.style.border = '1px solid #ccc';
  menu.style.padding = '5px';

  const gotoDefination = createMenuOption('Go to Defination', () => navigateToCellByVariable(variable, variableScope, notebookTracker,currentCellIndex, 'definition'));
  const showReferences = createMenuOption('Show references', () => navigateToCellByVariable(variable, variableScope, notebookTracker, currentCellIndex,'references'));

  menu.appendChild(gotoDefination);
  menu.appendChild(showReferences);
  document.body.appendChild(menu);

  document.addEventListener('click', () => {
    menu.remove();
  }, { once: true });
}

function createMenuOption(text: string, onClick: () => void): HTMLDivElement {
  const option = document.createElement('div');
  option.textContent = text;
  option.style.cursor = 'pointer';
  option.style.padding = '5px';
  option.addEventListener('click', () => {
    onClick();
    document.querySelector('.reference-context-menu')?.remove();
  });
  return option;
}

function navigateToCellByVariable(variable: string, variableScope: string|null, notebookTracker: INotebookTracker, currentCellIndex: number, menuItem: 'definition' | 'references' | 'next') {
  const notebook = notebookTracker.currentWidget?.content;
  if (!notebook) return null;

  const state = getNotebookState(notebook);

  let tagsref = new Map<string, string>();
  let cells = notebook.model?.cells;
  if (cells){
    for (let index = 0; index < cells.length; index++) {
        let cAny = cells.get(index)
        if(cAny.type === 'code'){
          let id = cAny.id.replace(/-/g, '').substring(0, 8);
          let tag = cAny.getMetadata('dfmetadata').tag
          if(tag.length > 0){
              tagsref.set(tag, id)
          }
        }
    }
  }
  
  const [identifer, refId] = variable.split('$');

  if(menuItem === 'definition'){
    if (variableScope == 'local'){
      notebook.scrollToCell(notebook.widgets[currentCellIndex]);
    }
    else if (variableScope == 'undefined'){
      let cells = notebook.model?.cells;
      if (cells){
          for (let index = 0; index < cells.length; index++) {
            let cAny = cells.get(index)
            if(cAny.type === 'code'){
              let id = cAny.id.replace(/-/g, '').substring(0, 8);
              let tag = cAny.getMetadata('dfmetadata').tag
              if((refId === undefined && cAny.getMetadata('dfmetadata').outputVars.includes(identifer))
                || (id === refId || tag === refId)){
                notebook.activeCellIndex = index;
                notebook.scrollToCell(notebook.widgets[index]);
                notebook.widgets[index].editor?.focus();
                break;
              }
            }
          }
      }
    }
    
  }
  else if(menuItem === 'references'){
    createNavigationBar(variable, notebookTracker);
    let cellid = notebookTracker.currentWidget.content?.widgets[currentCellIndex].model.id.replace(/-/g,'').substring(0,8)
    state.selectionMap = new Map();
    state.highlightedVariable = variable;
    const [identifer, refId] = variable.split('$');
    
    //when variable exported only once
    if(refId === undefined){
      let cells = notebook.model?.cells;
      if (cells){
        for (let index = 0; index < cells.length; index++) {
          let cAny = cells.get(index)
          if(cAny.type === 'code'){
            let id = truncateCellId(cAny.id);
            let tag = cAny.getMetadata('dfmetadata').tag
            if((refId === undefined && cAny.getMetadata('dfmetadata').outputVars.includes(identifer))
              || (id === refId || tag === refId)){
              state.highlightedVariableWithRefID = variable+'$'+id;
              state.highlightedVariableWithTag = variable+'$'+tag;
              break;
            }
          }
        }
      }
    }

    //when variable exported more than once
    if(refId != undefined){
      let cells = notebook.model?.cells;
      if (cells){
        let exportedVariableCount = 0;
        for (let index = 0; index < cells.length; index++) {
          let cAny = cells.get(index)
          if(cAny.type === 'code'){
            let id = truncateCellId(cAny.id);
            let tag = cAny.getMetadata('dfmetadata').tag
            if(cAny.getMetadata('dfmetadata').outputVars.includes(identifer) && (id === refId || tag === refId)){
              state.highlightedVariable = identifer;
              state.highlightedVariableWithRefID = identifer+'$'+id;
              state.highlightedVariableWithTag = identifer+'$'+tag;
              exportedVariableCount += 1;
            }
            else if(cAny.getMetadata('dfmetadata').outputVars.includes(identifer)){
              exportedVariableCount += 1
            }
          }
        }
        if(exportedVariableCount > 1){
          state.highlightedVariable = variable;
          state.highlightedVariableWithRefID = null;
          state.highlightedVariableWithTag = null;
        }
      }
    }
    state.highlightedRefId = cellid;
    computeDecorations(notebookTracker);
    notebook.activeCellIndex = currentCellIndex;
    notebook.widgets[currentCellIndex].editor?.focus();
  }
}

function createNavigationBar(variable: string, notebookTracker: INotebookTracker) {
  const notebook = notebookTracker.currentWidget?.content;
  if (!notebook) return null;

  const state = getNotebookState(notebook);
  if (state.navigationBar) {
    state.navigationBar.remove();
    state.navigationBar = null;
  }

  const bar = document.createElement('div');
  bar.className = 'reference-navigation-bar';
  bar.style.position = 'absolute';
  bar.style.top = '0';
  bar.style.right = '0';
  bar.style.zIndex = '7';
  bar.style.backgroundColor = 'var(--jp-toolbar-background)';
  bar.style.borderBottom = 'var(--jp-border-width) solid var(--jp-toolbar-border-color)';
  bar.style.borderLeft = 'var(--jp-border-width) solid var(--jp-toolbar-border-color)';
  bar.style.padding = '2px';
  bar.style.fontSize = 'var(--jp-ui-font-size1)';
  bar.style.display = 'flex';
  bar.style.alignItems = 'center';

  const referenceText = document.createElement('span');
  referenceText.textContent = 'Reference:';
  referenceText.style.fontWeight = 'bold';
  referenceText.style.margin = '0 5px';
  bar.appendChild(referenceText);

  const textBox = document.createElement('div');
  textBox.style.minWidth='12em';
  textBox.style.border = 'var(--jp-border-width) solid var(--jp-border-color0)';
  textBox.style.display = 'flex';
  textBox.style.backgroundColor = 'var(--jp-layout-color0)';
  textBox.style.margin = '2px';
  textBox.style.padding = '4px 6px';
  textBox.style.alignItems = 'center';
  textBox.style.overflow = 'hidden';
  textBox.style.textOverflow = 'ellipsis';
  textBox.style.whiteSpace = 'nowrap';

  const variableText = document.createElement('span');
  variableText.textContent = variable;
  textBox.appendChild(variableText);

  bar.appendChild(textBox);

  const createButton = (icon: LabIcon, title: string, onClick: () => void) => {
    const button = document.createElement('button');
    button.className = 'jp-DocumentSearch-button-wrapper';
    button.setAttribute('tabindex', '0');
    button.setAttribute('title', title);
    button.style.margin = '2px';
    button.style.padding = '2px';
    button.style.border = 'var(--jp-border-width) solid transparent';
    
    icon.element({
      container: button,
      elementPosition: 'center',
      height: '16px',
      width: '16px',
    });

    // Add hover and active styles
    button.style.boxSizing = 'border-box';
    button.style.cursor = 'pointer';
    button.style.transition = 'background-color 0.2s';

    // Event listener to add border on hover
    button.addEventListener('mouseover', () => {
      button.style.borderColor = ` var(--jp-border-color2)`;
    });

    // Event listener to remove the border when not hovered
    button.addEventListener('mouseout', () => {
        button.style.borderColor = 'transparent';
    });
    
    button.addEventListener('click', onClick);
    return button;
  };

   // Create up button
   const upButton = createButton(caretUpEmptyThinIcon, 'Previous Match', () => {
    console.log('Up button clicked');
    navigateHighlight("up",notebookTracker);
    });
  bar.appendChild(upButton);

  // Create down button
  const downButton = createButton(caretDownEmptyThinIcon, 'Next Match', () => {
    console.log('Down button clicked');
    navigateHighlight("down",notebookTracker);
  });
  bar.appendChild(downButton);

  // Create close button
  const closeButton = createButton(closeIcon, 'Close', () => {
    state.navigationBar?.remove();
    state.selectionMap = new Map();
    state.highlightedVariable = null;
    state.highlightedRefId = null;
    computeDecorations(notebookTracker);
  });
  bar.appendChild(closeButton);

  notebook?.node.appendChild(bar);
  state.navigationBar = bar;
}

function navigateHighlight(direction: 'up' | 'down', notebookTracker: INotebookTracker) {
  const notebook = notebookTracker.currentWidget?.content;
  if (!notebook) return;

  const state = getNotebookState(notebook);
  const cells = notebook.widgets;
  const currentIndex = notebook.activeCellIndex;
  let nextIndex = currentIndex;

  do {
    nextIndex = direction === 'up' ? (nextIndex - 1 + cells.length) % cells.length : (nextIndex + 1) % cells.length;
    const cell = cells[nextIndex];
    if (cell.model.type === 'code') {
      let cellId = cell.model.sharedModel.getId().replace(/-/g, '').substring(0, 8);
      if (state.selectionMap.has(cellId)){
        notebook.activeCellIndex = nextIndex;
        notebook.scrollToCell(notebook.widgets[nextIndex]);
        return;
      }
    }
  } while (nextIndex !== currentIndex);
}

function computeDecorations(notebookTracker:INotebookTracker) {
  const notebook = notebookTracker.currentWidget?.content;
  if (!notebook) return;

  const state = getNotebookState(notebook);
  if (!state.navigationBar) {
    return;
  }

  const cells = notebookTracker.currentWidget?.content.model?.cells;
  if(cells){
    for (let index = 0; index < cells.length; index++) {
      let cAny = notebookTracker.currentWidget.content.widgets[index];
      if(cAny.model.type === 'code'){
        state.computingDecorationCellId = cAny.model.id.replace(/-/g, '').substring(0, 8);
        let editor = (cAny.editor as any).editor;
        editor.dispatch();
      }
    }
  }
  state.cellIdInIteration = null;
  state.computingDecorationCellId = null;
}

function nbGetOutputVars(notebook: Notebook): Set<string> {
  const nboutputVars: Map<string, string> = new Map<string, string>();
  const uniqueVars: Set<string> = new Set<string>();
  const cells = notebook.model?.cells;
  if (!cells) return uniqueVars;

  for (let index = 0; index < cells.length; index++) {
    const cell = cells.get(index);
    let cellId = cell.id.replace(/-/g, '').substring(0, 8);
    if (cell.type === 'code') {
      const dfmetadata = cell.getMetadata('dfmetadata');
      const tag = dfmetadata.tag;
      if (dfmetadata && Array.isArray(dfmetadata.outputVars)) {
        for (const outputVar of dfmetadata.outputVars) {
          if (nboutputVars.has(outputVar)) {
            nboutputVars.set(outputVar+'$'+cellId, '1');
            nboutputVars.set(outputVar+'$'+tag, '1');
            nboutputVars.set(outputVar, 'MoreThanOne');
          } else {
            nboutputVars.set(outputVar, cellId);
            nboutputVars.set(outputVar+'$'+cellId, '1');
            nboutputVars.set(outputVar+'$'+tag, '1');
          }
        }
      }
    }
  }
  for (const [key, value] of nboutputVars) {
    if (value !== 'MoreThanOne') {
      uniqueVars.add(key);
    }
  }
  return uniqueVars;
}

const showHighlights = (notebookTracker: INotebookTracker) => ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    view: EditorView;
    state: ReturnType<typeof getNotebookState>;
    notebook: Notebook;

    constructor(view: EditorView) {
      this.view = view;
      this.notebook = notebookTracker.currentWidget!.content;
      this.state = getNotebookState(this.notebook);
      const cellContent = view.state.doc.toString();
      this.decorations = analyzeAndHighlightVariables(cellContent, this.notebook);
      view.dom.addEventListener('contextmenu', this.handleContextMenu);
      console.log("CELL CONSTRUCTOR");
    }

    update(update: ViewUpdate) {
      if(globalNotebookTracker.currentWidget?.content){
        this.state = getNotebookState(globalNotebookTracker.currentWidget?.content);
      }
      if (update.docChanged || this.state.computingDecorationCellId) {
        const cellContent = update.state.doc.toString();
        this.decorations = analyzeAndHighlightVariables(cellContent, this.notebook);
      }
    }

    handleContextMenu = (event: MouseEvent) => {
      handleRightClick(event, this.view, notebookTracker);
    }
  },
  {
    decorations: v => v.decorations
  }
)

export function highlightVariablesExtension(notebookTracker: INotebookTracker): Extension {
  return [
    baseTheme,
    showHighlights(notebookTracker)
  ];
}

let globalNotebookTracker: INotebookTracker;
export function HighlightReferences(app: JupyterFrontEnd, extensions: IEditorExtensionRegistry, notebookTracker: INotebookTracker) {
    let isExtensionAdded = false;

    notebookTracker.currentChanged.connect((sender, notebook) => {
      globalNotebookTracker = notebookTracker;
      console.log('Current notebook changed, globalNotebookTracker updated');
    });

    notebookTracker.widgetAdded.connect((sender, notebookPanel) => {
      globalNotebookTracker = notebookTracker;
      if (notebookPanel && !isExtensionAdded) {
        extensions.addExtension(
          Object.freeze({
            name: 'jupyterlab-highlight-ref:highlight-variables',
            factory: () =>
              EditorExtensionRegistry.createConfigurableExtension(() =>
                highlightVariablesExtension(notebookTracker)
              ),
            schema: {
              type: 'null',
              title: 'Highlight Variables',
              description: 'Highlight dataflow notebook variable references in CodeMirror editors.'
            }
          })
        );
      }
      isExtensionAdded = true;
    });

    app.commands.addCommand(NAVIGATE_UP_COMMAND, {
      label: 'Navigate to Previous Highlight',
      execute: () => {
        navigateHighlight('up', notebookTracker);
      }
    });
  
    app.commands.addCommand(NAVIGATE_DOWN_COMMAND, {
      label: 'Navigate to Next Highlight',
      execute: () => {
        navigateHighlight('down', notebookTracker);
      }
    });

    // Add key bindings
    app.commands.addKeyBinding({
      command: NAVIGATE_UP_COMMAND,
      keys: ['Alt Shift U'],
      selector: '.jp-Cell'
    });
  
    app.commands.addKeyBinding({
      command: NAVIGATE_DOWN_COMMAND,
      keys: ['Alt Shift D'],
      selector: '.jp-Cell'
    });
};

export function DfEditorContextMenu(event: MouseEvent, variable: string, variableScope:string|null){
  let cellId = globalNotebookTracker.activeCell?.model.sharedModel.getId();
  let cells = globalNotebookTracker.currentWidget?.content.model?.cells;
  let activeCellIndex = -1;
  if(cellId && cells){
    for(let i=0;i< cells?.length;i++){
      if(cells.get(i).sharedModel.getId() === cellId){
        activeCellIndex = i;
        break
      }
    }
    if(activeCellIndex != -1){
      showCustomContextMenu(event, variable, variableScope, globalNotebookTracker, activeCellIndex)
    }
  }
}