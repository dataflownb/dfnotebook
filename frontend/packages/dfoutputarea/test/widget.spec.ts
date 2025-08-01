// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ISessionContext, SessionContext } from '@jupyterlab/apputils';
import { createSessionContext } from '@jupyterlab/apputils/lib/testutils';
import {
  IOutputAreaModel,
  OutputAreaModel,
} from '@jupyterlab/outputarea';
import {
  DataflowOutputArea as OutputArea,
} from '@dfnotebook/dfoutputarea'
import { KernelManager } from '@jupyterlab/services';
import { JupyterServer } from '@jupyterlab/testing';
import {
  DEFAULT_OUTPUTS,
  defaultRenderMime
} from '@jupyterlab/rendermime/lib/testutils';
import { Message } from '@lumino/messaging';
import { Widget } from '@lumino/widgets';
import { simulate } from 'simulate-event';
import { IExecuteReplyMsg, IShellMessage, ShellMessageType } from '@jupyterlab/services/lib/kernel/messages';

import { describe, afterAll, beforeAll, beforeEach, afterEach, it, expect, jest, test } from '@jest/globals';
import { IDataflowCellData } from '@dfnotebook/dfcells';
import { truncateCellId } from '@dfnotebook/dfutils';
import { JSONObject, UUID } from '@lumino/coreutils';

/**
 * The default rendermime instance to use for testing.
 */
const rendermime = defaultRenderMime();

const CODE = 'print("hello")';

class LogOutputArea extends OutputArea {
  methods: string[] = [];

  protected onUpdateRequest(msg: Message): void {
    super.onUpdateRequest(msg);
    this.methods.push('onUpdateRequest');
  }

  protected onModelChanged(
    sender: IOutputAreaModel,
    args: IOutputAreaModel.ChangedArgs
  ) {
    super.onModelChanged(sender, args);
    this.methods.push('onModelChanged');
  }
}

function createCodeCellData(code: string, cellId: string): IDataflowCellData {
  return {
    code,
    cell_id: cellId,
    input_refs: {},
    output_tags: [],
    auto_update: false,
    force_cached: false
  };
}

interface IOutputAreaFutureOptions {
  cellId?: string;
  model?: IOutputAreaModel;
  metadata?: JSONObject;
  cellDataDict?: { [cellId: string]: IDataflowCellData };
  cellModelMap?: { [cellId: string]: IOutputAreaModel };
  }

function createOutputAreaFuture(code: string, sessionContext: ISessionContext, options: IOutputAreaFutureOptions = {}): {future: Promise<IExecuteReplyMsg>, widget: LogOutputArea} {
  let { cellId, model, metadata, cellDataDict, cellModelMap } = options;
  if (cellId === undefined)
    cellId = truncateCellId(UUID.uuid4());
  if (model === undefined)
    model = new OutputAreaModel({ trusted: true });
  if (metadata === undefined) {
    metadata = {};
  }
  metadata.cellId = cellId;
  if (cellDataDict === undefined) {
    cellDataDict = {};
  }
  cellDataDict[cellId] = createCodeCellData(code, cellId);
  if (cellModelMap === undefined) {
    cellModelMap = {};
  }
  cellModelMap[cellId] = model;

  const dfData = {
    uuid: cellId,
    cell_data_dict: cellDataDict
  } as JSONObject;
  const widget = new LogOutputArea({ rendermime, model }, cellId);
  const future = OutputArea.execute(code, widget, sessionContext, metadata, dfData, cellModelMap) as Promise<IExecuteReplyMsg>;
  return {future, widget};
}

function createMultipleOutputAreaFutures(codes: string[], sessionContext: ISessionContext, metadata?: JSONObject) {
  const futures: Promise<IExecuteReplyMsg>[] = [];
  const widgets: OutputArea[] = [];
  if (metadata === undefined) {
    metadata = {};
  }

  // these will be mutated in place
  const cellDataDict = {};
  const cellModelMap = {};
  for (const code of codes) {
    const {future, widget} = createOutputAreaFuture(code, sessionContext, {metadata, cellDataDict, cellModelMap});
    if (future !== undefined)
      futures.push(future);
    if (widget !== undefined)
      widgets.push(widget);
  }
  return {futures, widgets};
}

describe('outputarea/widget', () => {
  //let server: JupyterServer;

  const server = new JupyterServer();

  jest.retryTimes(3);

  beforeAll(async () => {
    await server.start({'additionalKernelSpecs':{'dfpython3':{'argv':['python','-m','dfnotebook.kernel','-f','{connection_file}'],'display_name':'DFPython 3','language':'python'}}});
  }, 30000);

  afterAll(async () => {
    await server.shutdown();
  });

  let widget: LogOutputArea;
  let model: OutputAreaModel;

  beforeEach(() => {
    model = new OutputAreaModel({
      values: DEFAULT_OUTPUTS,
      trusted: true
    });
    widget = new LogOutputArea({ rendermime, model }, '000aaa');
  });

  afterEach(() => {
    model.dispose();
    widget.dispose();
  });

  describe('OutputArea', () => {
    describe('#constructor()', () => {
      it('should create an output area widget', () => {
        expect(widget).toBeInstanceOf(OutputArea);
        expect(widget.hasClass('jp-OutputArea')).toBe(true);
      });

      it('should take an optional contentFactory', () => {
        const contentFactory = Object.create(OutputArea.defaultContentFactory);
        const widget = new OutputArea({ rendermime, contentFactory, model }, 'cellId');
        expect(widget.contentFactory).toBe(contentFactory);
      });
    });

    describe('#model', () => {
      it('should be the model used by the widget', () => {
        expect(widget.model).toBe(model);
      });
    });

    describe('#rendermime', () => {
      it('should be the rendermime instance used by the widget', () => {
        expect(widget.rendermime).toBe(rendermime);
      });
    });

    describe('#contentFactory', () => {
      it('should be the contentFactory used by the widget', () => {
        expect(widget.contentFactory).toBe(OutputArea.defaultContentFactory);
      });
    });

    describe('#maxNumberOutputs', () => {
      test.each([20, 6, 5, 2])(
        'should control the list of visible outputs',
        maxNumberOutputs => {
          const widget = new OutputArea({
            rendermime,
            model,
            maxNumberOutputs
          }, 'cellId');

          expect(widget.widgets.length).toBeLessThanOrEqual(
            maxNumberOutputs + 1
          );

          if (widget.widgets.length > maxNumberOutputs) {
            // eslint-disable-next-line jest/no-conditional-expect
            expect(
              widget.widgets[widget.widgets.length - 1].node.textContent
            ).toContain('Show more outputs');
          } else {
            // eslint-disable-next-line jest/no-conditional-expect
            expect(
              widget.widgets[widget.widgets.length - 1].node.textContent
            ).not.toContain('Show more outputs');
          }
        }
      );

      test('should display all widgets when clicked', () => {
        const widget = new OutputArea({
          rendermime,
          model,
          maxNumberOutputs: 2
        }, 'cellId');

        expect(widget.widgets.length).toBeLessThan(model.length);
        Widget.attach(widget, document.body);
        simulate(
          widget.widgets[widget.widgets.length - 1].node.querySelector('a')!,
          'click'
        );
        Widget.detach(widget);

        expect(widget.widgets.length).toEqual(model.length);
      });

      test('should display new widgets if increased', () => {
        const widget = new OutputArea({
          rendermime,
          model,
          maxNumberOutputs: 2
        }, 'cellId');
        expect(widget.widgets.length).toBeLessThan(model.length);

        widget.maxNumberOutputs += 1;

        expect(widget.widgets.length).toEqual(widget.maxNumberOutputs + 1);
        expect(widget.widgets.length).toBeLessThan(model.length);
      });

      test('should not change displayed widgets if reduced', () => {
        const widget = new OutputArea({
          rendermime,
          model,
          maxNumberOutputs: 2
        }, 'cellId');
        expect(widget.widgets.length).toBeLessThan(model.length);

        widget.maxNumberOutputs -= 1;

        expect(widget.widgets.length).toBeGreaterThan(
          widget.maxNumberOutputs + 1
        );
        expect(widget.widgets.length).toBeLessThan(model.length);
      });
    });

    describe('#widgets', () => {
      it('should get the child widget at the specified index', () => {
        expect(widget.widgets[0]).toBeInstanceOf(Widget);
      });

      it('should get the number of child widgets', () => {
        expect(widget.widgets.length).toBe(DEFAULT_OUTPUTS.length - 1);
        widget.model.clear();
        expect(widget.widgets.length).toBe(0);
      });
    });

    describe('#future', () => {
      let sessionContext: SessionContext;

      beforeEach(async () => {
        sessionContext = await createSessionContext();
        await sessionContext.initialize();
        await sessionContext.session?.kernel?.info;
      });

      afterEach(async () => {
        await sessionContext.shutdown();
        sessionContext.dispose();
      });

      it('should execute code on a kernel and send outputs to the model', async () => {
        const future = sessionContext.session!.kernel!.requestExecute({
          code: CODE
        });
        widget.future = future;
        const reply = await future.done;
        expect(reply!.content.execution_count).toBeTruthy();
        expect(reply!.content.status).toBe('ok');
        expect(model.length).toBe(1);
      });

      it('should clear existing outputs', async () => {
        widget.model.fromJSON(DEFAULT_OUTPUTS);
        const future = sessionContext.session!.kernel!.requestExecute({
          code: CODE
        });
        widget.future = future;
        const reply = await future.done;
        expect(reply!.content.execution_count).toBeTruthy();
        expect(model.length).toBe(1);
      });
    });

    describe('#onModelChanged()', () => {
      it('should handle an added output', () => {
        widget.model.clear();
        widget.methods = [];
        widget.model.add(DEFAULT_OUTPUTS[0]);
        expect(widget.methods).toEqual(
          expect.arrayContaining(['onModelChanged'])
        );
        expect(widget.widgets.length).toBe(1);
      });

      it('should handle a clear', () => {
        widget.model.fromJSON(DEFAULT_OUTPUTS);
        widget.methods = [];
        widget.model.clear();
        expect(widget.methods).toEqual(
          expect.arrayContaining(['onModelChanged'])
        );
        expect(widget.widgets.length).toBe(0);
      });

      it('should handle a set', () => {
        widget.model.clear();
        widget.model.add(DEFAULT_OUTPUTS[0]);
        widget.methods = [];
        widget.model.add(DEFAULT_OUTPUTS[0]);
        expect(widget.methods).toEqual(
          expect.arrayContaining(['onModelChanged'])
        );
        expect(widget.widgets.length).toBe(1);
      });

      it('should rerender when preferred mimetype changes', () => {
        // Add output with both safe and unsafe types
        widget.model.clear();
        widget.model.add({
          output_type: 'display_data',
          data: {
            'image/svg+xml':
              '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve"></svg>',
            'text/plain': 'hello, world'
          },
          metadata: {}
        });
        expect(widget.node.innerHTML).toContain('<img src="data:image/svg+xml');
        widget.model.trusted = !widget.model.trusted;
        expect(widget.node.innerHTML).toEqual(
          expect.not.arrayContaining(['<img src="data:image/svg+xml'])
        );
        widget.model.trusted = !widget.model.trusted;
        expect(widget.node.innerHTML).toContain('<img src="data:image/svg+xml');
      });

      it('should rerender when isolation changes', () => {
        // Add output with both safe and unsafe types
        widget.model.clear();
        widget.model.add({
          output_type: 'display_data',
          data: {
            'text/plain': 'hello, world'
          }
        });
        expect(widget.node.innerHTML).toEqual(
          expect.not.arrayContaining(['<iframe'])
        );
        widget.model.set(0, {
          output_type: 'display_data',
          data: {
            'text/plain': 'hello, world'
          },
          metadata: {
            isolated: true
          }
        });
        expect(widget.node.innerHTML).toContain('<iframe');
        widget.model.set(0, {
          output_type: 'display_data',
          data: {
            'text/plain': 'hello, world'
          }
        });
        expect(widget.node.innerHTML).not.toContain('<iframe');
      });
    });

    describe('.execute()', () => {
      let sessionContext: SessionContext;

      beforeEach(async () => {
        sessionContext = await createSessionContext(
          {'kernelPreference':
          {'name':'dfpython3','autoStartDefault':true,'shouldStart':true}});
        
          await (sessionContext as SessionContext).initialize();
          await sessionContext.session?.kernel?.info;
      });

      afterEach(async () => {
        await sessionContext.shutdown();
        sessionContext.dispose();
      });

      it('should execute code on a kernel and send outputs to the model', async () => {
        const {future, widget} = createOutputAreaFuture(CODE, sessionContext);
        const reply = await future;
        expect(reply!.content.execution_count).toBeTruthy();
        expect(reply!.content.status).toBe('ok');
        
        expect(widget.model.length).toBe(1);
        widget.dispose();
      });

      it('should clear existing outputs', async () => {
        // create a model with existing outputs
        const model = new OutputAreaModel({ trusted: true });
        model.fromJSON(DEFAULT_OUTPUTS);
        
        const {future, widget} = createOutputAreaFuture(CODE, sessionContext, {model});
        const reply = await future;
        expect(reply!.content.execution_count).toBeTruthy();
        expect(widget.model.length).toBe(1);
        widget.dispose();
      });

      it('should handle routing of display messages', async () => {
        const code0 = [
          'ip = get_ipython()',
          'from IPython.display import display',
          'def display_with_id(obj, display_id, update=False):',
          '  iopub = ip.kernel.iopub_socket',
          '  session = get_ipython().kernel.session',
          '  data, md = ip.display_formatter.format(obj)',
          '  transient = {"display_id": display_id}',
          '  content = {"data": data, "metadata": md, "transient": transient}',
          '  msg_type = "update_display_data" if update else "display_data"',
          '  session.send(iopub, msg_type, content, parent=ip.parent_header)',
          'ip,display_with_id'
        ].join('\n');
        const code1 = 'j = 3';         
        const code2 = 'a,b,c = 4,j,4';

        const {futures, widgets} = createMultipleOutputAreaFutures([code0, code1, code2], sessionContext);

        await Promise.all(futures.slice(2));
        expect(widgets[1].model.length).toBe(1);
        const outputs1 = widgets[1].model.toJSON();
        expect(outputs1[0].data).toEqual({"text/plain": '3'});
        expect(outputs1[0]["metadata"]).toEqual({"output_tag":"j"});

        await futures[2];
        expect(widgets[1].model.length).toBe(1);
        expect(widgets[2].model.length).toBe(3);
        const outputs2 = widgets[2].model.toJSON();
        expect(outputs2[0].data).toEqual({ 'text/plain': '4' });
        expect(outputs2[0]["metadata"]).toEqual({"output_tag":"a"});
        expect(outputs2[1].data).toEqual({ 'text/plain': '3' });
        expect(outputs2[1]["metadata"]).toEqual({"output_tag":"b"});
        expect(outputs2[2].data).toEqual({ 'text/plain': '4' });
        expect(outputs2[2]["metadata"]).toEqual({"output_tag":"c"});

        for (const widget of widgets) {
          widget.dispose();
        }
      });

      it('should stop on an error', async () => {
        const {future: future1, widget: widget1} = createOutputAreaFuture('a := 1', sessionContext)
        const {future: future2, widget: widget2} = createOutputAreaFuture('a = 1', sessionContext);
        const [reply, reply2] = await Promise.all([future1, future2]);
        expect(reply!.content.status).toBe('error');
        expect(reply2!.content.status).toBe('aborted');
        expect(widget2.model.length).toBe(0);
        widget1.dispose();
        widget2.dispose();
      });

      it('should allow an error given "raises-exception" metadata tag', async () => {
        const {future: future1, widget: widget1} = createOutputAreaFuture('a := 1', sessionContext, {metadata: {'tags': ['raises-exception']}});
        const {future: future2, widget: widget2} = createOutputAreaFuture('a = 1', sessionContext);
        const [reply, reply2] = await Promise.all([future1, future2]);
        expect(reply!.content.status).toBe('error');
        expect(reply2!.content.status).toBe('ok');
        widget1.dispose();
        widget2.dispose();
      });

      it('should continuously render delayed outputs', async () => {
        const code = [
          'import time',
          'for i in range(3):',
          '    print(f"Hello Jupyter! {i}")',
          '    time.sleep(1)'
        ].join('\n');
        const {future, widget} = createOutputAreaFuture(code, sessionContext);
        await future;
        const output = widget.model.toJSON();
        expect(output[0].text).toBe(
          'Hello Jupyter! 0\nHello Jupyter! 1\nHello Jupyter! 2\n');
      });
     });

    describe('.ContentFactory', () => {
      describe('#createOutputPrompt()', () => {
        it('should create an output prompt', () => {
          const factory = new OutputArea.ContentFactory();
          expect(factory.createOutputPrompt().executionCount).toBeNull();
        });
      });

      describe('#createStdin()', () => {
        it('should create a stdin widget', async () => {
          const manager = new KernelManager();
          const kernel = await manager.startNew();
          const factory = new OutputArea.ContentFactory();
          const future = kernel.requestExecute({ code: CODE ,user_expressions:{__dfkernel_data__: {}}},false);
          const wrappedFuture = {
            ...future,
            onReply: (msg: IShellMessage<ShellMessageType>) => {
              return future.onReply(msg as IExecuteReplyMsg);
            },
          };
          const options = {
            parent_header: {
              date: '',
              msg_id: '',
              msg_type: 'input_request' as const,
              session: '',
              username: '',
              version: ''
            },
            prompt: 'hello',
            password: false,
            future: wrappedFuture
          };
          expect(factory.createStdin(options)).toBeInstanceOf(Widget);
          await kernel.shutdown();
          kernel.dispose();
        });
      });
    });

    describe('.defaultContentFactory', () => {
      it('should be a `contentFactory` instance', () => {
        expect(OutputArea.defaultContentFactory).toBeInstanceOf(
          OutputArea.ContentFactory
        );
      });
    });
  });
});
