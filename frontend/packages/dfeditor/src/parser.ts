import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { SyntaxNode } from "@lezer/common";

interface VariableInfo {
  name: string;
  type: string;
  scope: 'local' | 'global' | 'parameter' | 'undefined';
  position: {
    line: number;
    column: number;
  };
  isDefinition: boolean;
  from: number,
  to: number
}

export class VariableScopeAnalyzer {
  private scopes: Map<string, Set<string>>[] = [new Map()]; // Global scope is at index 0
  private variables: VariableInfo[] = [];

  analyzeCode(code: string): VariableInfo[] {
    const state = EditorState.create({ doc: code, extensions: [python()] });
    const tree = syntaxTree(state);
    this.visit(tree.topNode, state);
    return this.variables;
  }

  private genericVisit(node: SyntaxNode, state: EditorState) {
    let child = node.firstChild;
    while (child) {
      this.visit(child, state);
      child = child.nextSibling;
    }
  }

  private visit(node: SyntaxNode, state: EditorState) {
    if (false && node.type.isError) {
        //check error due to $ sign
        this.handleErrorNode(node, state);
    }

    switch (node.type.name) {
        case "FunctionDefinition":
        case "AsyncFunctionDefinition":
            this.visitFunctionDefinition(node, state);
            break;
        case "LambdaExpression":
            this.visitLambdaExpression(node, state);
            break;
        case "ClassDefinition":
            this.visitClassDefinition(node, state);
            break;
        case "ListComprehensionExpression":
        case "SetComprehensionExpression":
        case "GeneratorExpressionExpression":
        case "DictionaryComprehensionExpression":
        case "ComprehensionExpression":
        case "ArrayComprehensionExpression":
          this.visitComprehension(node, state);
          break;
        case "VariableName":
            this.visitVariableName(node, state, false);
            break;
        case "AssignStatement":
            this.visitAssignStatement(node, state);
            break;
        case "ImportStatement":
        case "FromImportStatement":
            this.visitImportStatement(node, state);
            break;
        case "ForStatement":
            this.visitForStatement(node, state);
            break;
        default:
            this.genericVisit(node, state);
    }
  }

  private visitComprehension(node: SyntaxNode, state: EditorState) {
    this.scopes.push(new Map()); // Create a new scope for comprehension
    // Process the comprehension's variables
    let child = node.firstChild;
    let statementFor = false;
    let varList:string[] = [];
    const {from, to} = {from: node.from, to: node.to};
    while (child) {
        if (child.type.name === "for") {
            statementFor = true;
        }
        else if (child.type.name === 'VariableName')
        {
            if(statementFor){
                const name = state.sliceDoc(child.from, child.to);
                this.addToCurrentScope(name); // Register in current scope
                this.addVariableInfo(name, child, state, true, child.from, child.to, 'ComprehensionVariable');
            }
            else{
                const name = state.sliceDoc(child.from, child.to);
                const {text, endOfVariable} = this.referenceIdentifier(child, state);
                if(text.includes('$') && endOfVariable){
                    this.addVariableInfo(text, child, state, false, child.from, endOfVariable, 'ComprehensionVariable');
                }
                else{
                    this.addVariableInfo(name, child, state, false, child.from, child.to, 'ComprehensionVariable');
                }
            }
        }
        else if(child.type.name === "in"){
            statementFor = false;
        }
        else{
            this.visitExpression(child.firstChild, state);
        }
        child = child.nextSibling;
    }
    //this.genericVisit(node, state);

    // Get comprehensive defiend variables
    for(let i=this.variables.length-1; i>=0; i--){
        let variable = this.variables[i];
        if(variable.from > from && variable.to < to && variable.type === 'ComprehensionVariable' && variable.isDefinition == true){
            varList.push(variable.name);
        }
    }

    //update scope of comprehensive variables
    for(let i=this.variables.length-1; i>=0; i--){
        let variable = this.variables[i];
        if(variable.from > from && variable.to < to && varList.includes(variable.name)){
            this.variables[i].type = 'ComprehensionVariable',
            this.variables[i].scope = 'local';
        }
    }

    this.scopes.pop(); // Remove the comprehension scope after processing
  }

  private visitImportStatement(node: SyntaxNode, state: EditorState) {
    let child = node.firstChild;
    while (child) {
      if (child.type.name === "VariableName") {
        const name = state.sliceDoc(child.from, child.to);
        const {text, endOfVariable} = this.referenceIdentifier(child, state);
        if(text.includes('$') && endOfVariable){
            this.addToCurrentScope(text);
            this.addVariableInfo(text, child, state, true, child.from, endOfVariable, 'ImportVariable');
        }
        else{
            this.addToCurrentScope(name);
            this.addVariableInfo(name, child, state, true, child.from, child.to, 'ImportVariable');
        }
      }
      child = child.nextSibling;
    }
  }

  private visitForStatement(node: SyntaxNode, state: EditorState){
    let child = node.firstChild;
    let statementFor = false;
    
    while (child){
        if(child.type.name === 'for'){
            statementFor = true;
        }
        else if(child.type.name === "VariableName"){
            if(statementFor){
                const name = state.sliceDoc(child.from, child.to);
                this.addToCurrentScope(name); // Register in current scope
                this.addVariableInfo(name, child, state, true, child.from, child.to, 'ComprehensionVariable');
            }
            else{
                const name = state.sliceDoc(child.from, child.to);
                const {text, endOfVariable} = this.referenceIdentifier(child, state);
                if(text.includes('$') && endOfVariable){
                    this.addVariableInfo(text, child, state, false, child.from, endOfVariable, 'Variable');
                }
                else{
                    this.addVariableInfo(name, child, state, false, child.from, child.to, 'Variable');
                }
            }
        }
        else if(child.type.name === 'in'){
            statementFor = false;
        }
        else if(child.type.name.includes('Expression')){
            this.visitExpression(child.firstChild, state);
        }
        child = child.nextSibling;
    }

    const body = node.getChild("Body");
    if (body) {
      this.genericVisit(body, state);
    }
  }

  private visitFunctionDefinition(node: SyntaxNode, state: EditorState) {
    const nameNode = node.getChild("VariableName");
    if (nameNode) {
      const name = state.sliceDoc(nameNode.from, nameNode.to);
      const {text, endOfVariable} = this.referenceIdentifier(nameNode, state);
      if(text.includes('$') && endOfVariable){
        this.addToCurrentScope(text);
        this.addVariableInfo(text, nameNode, state, true, nameNode.from, endOfVariable, 'MethodName');
      }
      else{
        this.addToCurrentScope(name);
        this.addVariableInfo(name, nameNode, state, true, nameNode.from, nameNode.to, 'MethodName');
      }
    }
    
    this.scopes.push(new Map()); // Create a new scope
    
    // Handle parameters
    const paramList = node.getChild("ParamList");
    if (paramList) {
      this.handleParameters(paramList, state);
    }

    const body = node.getChild("Body");
    if (body) {
      this.genericVisit(body, state);
    }
    this.scopes.pop(); // Remove the scope after processing
  }

  private visitLambdaExpression(node: SyntaxNode, state: EditorState) {
    this.scopes.push(new Map()); // Create a new scope for lambda
    
    // Handle lambda parameters
    const paramList = node.getChild("ParamList");
    if (paramList) {
      this.handleParameters(paramList, state);
    }

    const body = node.getChild("Expression") || node.getChild("BinaryExpression");
    if (body) {
      this.visit(body, state);
    }

    this.scopes.pop(); // Remove the lambda scope after processing
  }

  private handleParameters(paramList: SyntaxNode, state: EditorState) {
    let param = paramList.firstChild;
    while (param) {
      if (param.type.name === "VariableName") {
        const paramName = state.sliceDoc(param.from, param.to);
        this.addToCurrentScope(paramName);
        this.addVariableInfo(paramName, param, state, true, param.from, param.to,'Parameter');
      }
      param = param.nextSibling;
    }
  }

  private visitClassDefinition(node: SyntaxNode, state: EditorState) {
    const nameNode = node.getChild("VariableName");
    if (nameNode) {
      const name = state.sliceDoc(nameNode.from, nameNode.to);
      const {text, endOfVariable} = this.referenceIdentifier(nameNode, state);
      if(text.includes('$') && endOfVariable){
        this.addToCurrentScope(text);
        this.addVariableInfo(text, nameNode, state, true, nameNode.from, endOfVariable, 'ClassName');
      }
      else{
        this.addToCurrentScope(name);
        this.addVariableInfo(name, nameNode, state, true, nameNode.from, nameNode.to, 'ClassName');
      }
    }
    
    this.scopes.push(new Map()); // Create a new scope for class
    const body = node.getChild("Body");
    if (body) {
      this.genericVisit(body, state);
    }
    this.scopes.pop(); // Remove the class scope after processing
  }

  private visitVariableName(node: SyntaxNode, state: EditorState, isDefinition: boolean) {
    const name = state.sliceDoc(node.from, node.to);
    const parent = node.parent;

    // Skip if it's part of a function or class definition
    if (parent?.type.name === "FunctionDefinition" || parent?.type.name === "ClassDefinition") {
      return;
    }

    let recentParsedVariable = this.variables.length > 0 ? this.variables[this.variables.length - 1] : null;
    if(recentParsedVariable && state.doc.lineAt(node.from).number == recentParsedVariable.position.line && recentParsedVariable.to > node.from){
        return
    }

    const {text, endOfVariable} = this.referenceIdentifier(node, state);
    if(text.includes('$') && endOfVariable){
        this.addVariableInfo(text, node, state, isDefinition, node.from, endOfVariable, 'Variable');
    }
    else{
        this.addVariableInfo(name, node, state, isDefinition, node.from, node.to, 'Variable');
    }

  }

  private visitAssignTarget(node: SyntaxNode, state: EditorState) {
    switch (node.type.name) {
      case "VariableName":
        const name = state.sliceDoc(node.from, node.to);
        this.addToCurrentScope(name);
        this.visitVariableName(node, state, true);
        break;
      case "TupleExpression":
      case "ArrayExpression":
      case "ParenthesizedExpression":
        this.visitTupleOrArrayExpression(node, state);
        break;
    }
  }

  private visitTupleOrArrayExpression(node: SyntaxNode, state: EditorState) {
    let child = node.firstChild;
    while (child) {
      if (child.type.name === "VariableName") {
        const name = state.sliceDoc(node.from, node.to);
        this.addToCurrentScope(name);
        this.visitVariableName(node, state, true);
      } else if (child.type.name === "TupleExpression" || 
                 child.type.name === "ArrayExpression" ||
                 child.type.name === "ParenthesizedExpression") {
        this.visitTupleOrArrayExpression(child, state);
      }
      child = child.nextSibling;
    }
  }

  private visitAssignStatement(node: SyntaxNode, state: EditorState) {
    let targetNode = node.firstChild;
    let tagetNodeRHS = targetNode ? targetNode.nextSibling : null; 
    while (targetNode && targetNode.type.name !== "AssignOp") {
      this.visitAssignTarget(targetNode, state);
      targetNode = targetNode.nextSibling;
    }

    // Visit the right side of the assignment
    if (tagetNodeRHS) {
        this.visitExpression(tagetNodeRHS, state);
    }
  }

  private visitExpression(node: SyntaxNode|null, state: EditorState) {
    let child = node;
    while (child) {
        if (child.type.name === 'VariableName'){
            const name = state.sliceDoc(child.from, child.to);
            const {text, endOfVariable} = this.referenceIdentifier(child, state);
            if(text.includes('$') && endOfVariable){
                this.addVariableInfo(text, child, state, false, child.from, endOfVariable, 'Variable');
            }
            else{
                this.addVariableInfo(name, child, state, false, child.from, child.to, 'Variable');
            }
        }
        else if(child.type.name == 'LambdaExpression'){
            this.visitLambdaExpression(child, state);
        }
        else if( ["ArrayComprehensionExpression", "ListComprehensionExpression", "SetComprehensionExpression", "GeneratorExpressionExpression", "DictionaryComprehensionExpression", "ComprehensionExpression"].includes(child.type.name)){
            this.visitComprehension(child, state);
        }
        else if(child.type.name.includes('Expression') || child.type.name === 'ArgList'){
            this.visitExpression(child.firstChild, state);
        }
        child = child.nextSibling;
    }
  }

  private addToCurrentScope(name: string) {
    const currentScope = this.scopes[this.scopes.length - 1];
    if (!currentScope.has(name)) {
      currentScope.set(name, new Set());
    }
    currentScope.get(name)!.add(`${this.scopes.length - 1}`);
  }

  private determineScope(name: string): 'local' | 'global' | 'parameter' | 'undefined' {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) {
        return i === 0 ? 'global' : 'local';
      }
    }
    return 'undefined';
  }

  private referenceIdentifier(node: SyntaxNode, state: EditorState){
    let endOfVariable = node.to;
    let currentPos = node.to;
    while (currentPos < state.doc.length) {
      const nextChar = state.doc.sliceString(currentPos, currentPos + 1);
      if (/[\w$]/.test(nextChar) || nextChar === '_') {
        currentPos++;
      } else {
        break;
      }
    }
    endOfVariable = currentPos;
    const text = state.doc.sliceString(node.from, endOfVariable);
    
    if(text.includes('$')){
        return { text:text, endOfVariable: endOfVariable };
    }
    
    return { text:'', endOfVariable:null };
  }

  private addVariableInfo(name: string, node: SyntaxNode, state: EditorState, isDefinition: boolean, from:number, to:number, type: string, forcedScope?: 'local' | 'global' | 'parameter' | 'undefined') {
    const scope = this.determineScope(name);
    const position = state.doc.lineAt(node.from);
    this.variables.push({
      name,
      type,
      scope,
      position: {
        line: position.number,
        column: node.from - position.from
      },
      isDefinition,
      from: from,
      to: to
    });
  }

  private handleErrorNode(node: SyntaxNode, state: EditorState) {
    let startOfVariable = node.from;
    let endOfVariable = node.to;
  
    // First, scan backward from 'node.from' to capture any part of the variable missed due to an error
    let currentPos = node.from;
    while (currentPos > 0) {
        const prevChar = state.doc.sliceString(currentPos - 1, currentPos);
        // Treat $ and alphanumeric characters as part of the identifier
        if (/[\w$]/.test(prevChar) || prevChar === '_') {
            currentPos--;
        } else {
            break;
        }
    }

    startOfVariable = currentPos; // Adjust start to the first character of the variable

  // Now, scan forward to capture the rest of the variable, including $ and alphanumeric characters
  currentPos = node.to;
  while (currentPos < state.doc.length) {
    const nextChar = state.doc.sliceString(currentPos, currentPos + 1);
    // Treat $ and alphanumeric characters as part of the identifier
    if (/[\w$]/.test(nextChar) || nextChar === '_') {
      currentPos++;
    } else {
      break;
    }
  }

  endOfVariable = currentPos; // Adjust end to the last character of the variable

  // Extract the full variable name from the adjusted start and end positions
  const text = state.doc.sliceString(startOfVariable, endOfVariable);

  //check if the variable contains exactly one $ sign
  const dollarSignCount = (text.match(/\$/g) || []).length;

  // If the variable contains more than one dollar sign, handle the error accordingly
  if (dollarSignCount > 1) {
    console.error(`Error: Variable '${text}' contains more than one $ sign.`);
    // Handle the error (e.g., ignore the variable or log the issue)
    return null; // Or return some error representation
  }

  // If there's exactly one dollar sign, return the extracted variable details
  return { text, startOfVariable, endOfVariable };
  } 
}