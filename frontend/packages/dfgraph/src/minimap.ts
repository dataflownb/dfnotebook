//UUID length has been changed need to compensate for that
//FIXME: Future Include?
const uuidLength = 8;

import * as d3 from 'd3';
import $ from 'jquery';
import { truncateCellId } from '@dfnotebook/dfutils';

export class Minimap {
  radius: number;
  offsetX: number;
  offsetY: number;
  svgOffsetX: number;
  svgOffsetY: number;
  textOffset: number;
  stateOffset: number;
  pathOffset: number;
  edgeYOffset: number;
  strokeWidth: number;
  textEllide: number;
  offsetActive: number;
  rectYOffset: number;
  statesWidth: number;
  statesHeight: number;
  statesRx: number;
  statesRy: number;
  nodesRx: number;
  nodesRy: number;
  idSubstr: string;
  cells: { [name: string]: string };
  edges: any;
  parentdiv: any;
  svg: any;
  dfgraph: any;
  wasCreated: boolean;
  outputTags: { [name: string]: [] };
  tracker: any;
  order: any;
  orderFixed: any;
  mode: string;
  fixedIdentifier: string;
  toggle: any;
  tabular: any;
  colormap: any;

  constructor(dfgraph?: any, parentdiv?: any) {
    this.wasCreated = false;
    this.radius = 3;
    this.offsetX = 15;
    this.offsetY = 15;
    this.svgOffsetX = 32;
    this.svgOffsetY = 50;
    this.textOffset = 40;
    this.stateOffset = 63;
    this.pathOffset = 8;
    this.edgeYOffset = 10;
    this.strokeWidth = 2;
    this.offsetActive = 24;
    this.rectYOffset = 4;
    this.statesWidth = 5;
    this.statesHeight = 12;
    this.nodesRx = this.nodesRy = 3;
    this.statesRx = this.statesRy = 2;
    //Elides text after this length
    this.textEllide = 10;
    this.idSubstr = 'node';
    this.fixedIdentifier = 'DFELEMENT';
    this.cells = {};
    this.parentdiv = parentdiv || '#minimap';
    this.edges = [];
    this.outputTags = {};
    this.dfgraph = dfgraph || null;
    this.tracker = null;
    this.toggle = null;
    this.tabular = null;
    //this.mode = 'cells';
    this.mode = 'nodes';
    this.colormap = {
      Stale: 'yellow',
      Fresh: 'blue',
      'Upstream Stale': 'yellow',
      Changed: 'orange',
      None: 'grey'
    };
    //this.widget =
  }

  setTracker = function (tracker: any) {
    this.tracker = tracker;
  };

  /** @method update the order that cells are present in the minimap **/
  updateOrder = function (order: any) {
    //Have to set uuids properly here in case we rely on cell array
    this.order = order.map((uuid: string) => truncateCellId(uuid));
    return true;
  };

  /** @method resets all paths **/
  reset = function () {
    this.svg.selectAll('.active').classed('active', false);
    this.svg.selectAll('.imm').classed('imm', false);
    this.svg.selectAll('.active_node').classed('active_node', false);
    this.svg.selectAll('.move_left').classed('move_left', false);
    this.svg.selectAll('.move_right').classed('move_right', false);
    this.svg.selectAll('.hidden').classed('hidden', false);
    this.svg.selectAll('.gray').classed('gray', false);
    this.svg.selectAll('.joining').remove();
    this.svg.selectAll('.activeedge').remove();
  };

  /** @method creates paths between node segments **/
  makePaths = function (
    sourceCy: any,
    destinationCy: any,
    parent: any,
    left: boolean
  ) {
    let xVal = left
      ? this.svgOffsetX + this.radius + this.pathOffset
      : this.svgOffsetX - (this.radius + this.pathOffset);
    let yVal = destinationCy - sourceCy;
    parent
      .append('path')
      .classed('joining', true)
      .attr('d', 'M' + xVal + ' ' + sourceCy + 'v ' + yVal)
      .attr('stroke-width', this.strokeWidth);
  };

  /** @method generates dependencies that aren't intermediates **/
  genDeps = function (immups: any, immdowns: any) {
    let that = this;
    let ups: any = [];
    let downs: any = [];
    let currups = immups;
    let currdowns = immdowns;
    while (currups.length > 0 || currdowns.length > 0) {
      let newups: any = [];
      let newdowns: any = [];
      that.edges.map(function (edge: any) {
        if (currups.includes(edge['destination'])) {
          newups.push(edge['source']);
          ups.push(edge['source']);
        }
        if (currdowns.includes(edge['source'])) {
          newdowns.push(edge['destination']);
          downs.push(edge['destination']);
        }
      });
      currups = newups;
      currdowns = newdowns;
    }
    ups.map(function (up: any) {
      d3.select('#node' + up)
        .classed('move_right', true)
        .classed('active', true)
        .classed('gray', true);
    });
    downs.map(function (down: any) {
      d3.select('#node' + down)
        .classed('move_left', true)
        .classed('active', true)
        .classed('gray', true);
    });
  };

  /** @method activates the paths based on click **/
  elementActivate = function (parent: any, node: any) {
    let that = this;
    let ups: any = [];
    let downs: any = [];
    if (!node.empty() && !node.classed('active_node')) {
      this.reset();
      node.classed('active_node', true);
      parent.classed('active', true);
      let activeId = parent.attr('id');
      activeId = activeId.substring(that.idSubstr.length, activeId.length);
      let sourceX = that.svgOffsetX;
      let offsetActive = 0;

      let sourceY =
        that.edgeYOffset + that.offsetX * that.orderFixed.indexOf(activeId);
      let uuid = activeId.substring(
        activeId.length - uuidLength,
        activeId.length
      );
      let immups = that.dfgraph.getImmUpstreams(uuid);
      let immdowns = that.dfgraph.getDownstreams(uuid);
      if (immups.length > 0 && immdowns.length > 0) {
        sourceX = that.svgOffsetX - that.offsetActive / 2;
        offsetActive = that.offsetActive;
      } else if (immups.length > 0) {
        offsetActive = -(that.offsetActive / 2);
      } else if (immdowns.length > 0) {
        offsetActive = that.offsetActive / 2;
      }

      let activeEle = '#node' + activeId;
      d3.select(activeEle)
        .append('g')
        .attr('transform', 'translate(0,0)')
        .classed('activeedge', true)
        .append('path')
        .classed('source', true)
        .attr('d', 'M' + sourceX + ' ' + sourceY + 'h ' + offsetActive)
        .attr('stroke-width', that.strokeWidth)
        .attr('fill', '#3b5fc0')
        .attr('stroke', '#3b5fc0');

      d3.select('#text' + activeId).classed('active', true);
      if (that.mode == 'cells') {
        this.tracker.currentWidget.content.activeCellIndex =
          this.order.indexOf(activeId);
      } else {
        this.tracker.currentWidget.content.activeCellIndex = this.order.indexOf(
          activeId.split(that.fixedIdentifier)[1]
        );
      }
      this.edges.map(function (edge: any) {
        let source = edge['source'];
        let destination = edge['destination'];
        if (source == activeId) {
          downs.push(destination);
          let destinationNode = d3
            .select('#node' + destination)
            .classed('move_left', true)
            .classed('active', true)
            .classed('imm', true);
          let destCy =
            that.edgeYOffset +
            that.offsetY * that.orderFixed.indexOf(destination);
          that.makePaths(sourceY, destCy, parent, true);

          destinationNode.selectAll('path.source').classed('hidden', true);
        }
        if (destination == activeId) {
          ups.push(source);
          let sourceNode = d3
            .select('#node' + source)
            .classed('move_right', true)
            .classed('active', true)
            .classed('imm', true);
          let srcCy =
            that.edgeYOffset + that.offsetY * that.orderFixed.indexOf(source);
          that.makePaths(srcCy, sourceY, parent, false);

          sourceNode.selectAll('path.destination').classed('hidden', true);
        }
      });
    }
    that.genDeps(ups, downs);
    this.svg
      .selectAll('g')
      .filter(function (a: any) {
        return (
          !this.classList.contains('active') &&
          this.parentElement.nodeName == 'svg'
        );
      })
      .selectAll('path')
      .classed('hidden', true);
  };

  /** @method takes in a string id input and activates based on that ID*/
  updateActiveByID = function (activeid: string) {
    let sourceNode = null;
    let src = null;
    let that = this;
    if (this.mode == 'nodes') {
      let deps = this.dfgraph.getNodes(activeid);
      let addSpecifier = deps.length > 0 ? deps[0] : '';
      if (deps.length > 0 && deps[0] == undefined) {
        addSpecifier = '';
      }
      sourceNode = d3
        .select('#node' + addSpecifier + that.fixedIdentifier + activeid)
        .classed('move_right', true)
        .classed('active', true);
      src = sourceNode.select('circle');
    } else {
      sourceNode = d3
        .select('#node' + activeid)
        .classed('move_right', true)
        .classed('active', true);
      src = sourceNode.select('circle');
    }
    this.elementActivate(sourceNode, src);
  };

  /** @method combines tags with respective uuids **/
  combineTags = function (uuid: string) {
    let that = this;
    if (uuid in this.outputTags) {
      if (this.dfgraph.getNodes(uuid).length == 0) {
        return ['' + that.fixedIdentifier + uuid];
      }
      return this.outputTags[uuid].map(
        (tag: string) => (tag ? tag : '') + that.fixedIdentifier + uuid
      );
    }
    return this.dfgraph.getNodes(uuid);
  };

  /** @method updateStates updates the states present in the graph */
  updateStates = function () {
    let that = this;
    that.svg
      .selectAll('rect.states')
      .data(that.orderFixed)
      .attr(
        'fill',
        (uuid: string) =>
          that.colormap[
            that.dfgraph.states[
              uuid.substring(uuid.length - uuidLength, uuid.length)
            ] || 'None'
          ]
      )
      .enter()
      .append('rect')
      .attr('x', that.stateOffset)
      .attr('y', function (a: string, b: number) {
        return that.rectYOffset + that.offsetY * b;
      })
      .attr('width', that.statesWidth)
      .attr('height', that.statesHeight)
      .attr('rx', that.statesRx)
      .attr('ry', that.statesRy)
      .attr('id', (uuid: string) => 'state' + uuid)
      .attr(
        'fill',
        (uuid: string) =>
          that.colormap[
            that.dfgraph.states[
              uuid.substring(uuid.length - uuidLength, uuid.length)
            ] || 'None'
          ]
      )
      .classed('states', true);
  };

  /** @method combines tags with respective uuids **/
  outTagsLength = function (uuid: string) {
    if (uuid in this.outputTags) {
      if (this.outputTags[uuid].length == 0) {
        return 1;
      }
      return this.outputTags[uuid].length;
    }
    return 1;
  };

  /** @method grabs out tags from string **/
  grabOutTags = function (id: string, text: string) {
    let that = this;
    if (id in that.outputTags) {
      return that.outputTags[id].reduce(
        (textobj: string, outputTag: string) => {
          //FIXME: Make this smarter
          let exp = new RegExp(outputTag);
          if (!textobj) {
            return '';
          }
          return textobj.replace(
            exp,
            'OUTTAGSTARTSHERE' + outputTag + 'OUTTAGSTARTSHERE'
          );
        },
        text
      );
    }
    return text || '';
  };

  /** @method activates the paths based on click **/
  createMinimap = function (parent: any, node: any) {
    let that = this;

    let minitran = d3.transition().duration(0);

    let circles = this.svg.selectAll('circle');
    let data = null;
    if (that.mode == 'cells') {
      data = this.order;
    } else {
      data = this.order.reduce(function (a: any, b: any) {
        return a.concat(that.combineTags(b));
      }, []);
    }
    let groups = circles
      .data(data, (a: string) => a)
      .enter()
      .append('g')
      //Have to use a proper start pattern for ID rules in HTML4
      .attr('id', (a: string) => 'node' + a);

    groups
      .append('rect')
      .attr('x', 0)
      .attr('y', (a: string, b: number) => 0 + b * that.offsetY)
      .attr('width', 500)
      .attr('height', that.offsetY)
      .attr('fill', 'transparent')
      .on('click', function () {
        let parent = d3.select(this.parentNode);
        let node = parent.select('circle');
        that.elementActivate(parent, node);
      });

    groups
      .append('circle')
      .transition(minitran)
      .attr('cx', this.svgOffsetX)
      .attr('cy', (a: string, b: number) => that.edgeYOffset + this.offsetY * b)
      .attr('r', this.radius);

    that.mapEdges(that);

    let values = this.order.map((a: string) => [
      a,
      that
        .grabOutTags(a, that.getCellContents(a))
        .split('OUTTAGSTARTSHERE')
        .map((text: string) => {
          return [text, (that.outputTags[a] || []).includes(text)];
        })
    ]);

    let textclick = function () {
      let id = d3.select(this).attr('id');
      id = id.substring(this.idSubstr.length, id.length);
      let parent = d3.select('#node' + id);
      let node = parent.select('circle');
      that.elementActivate(parent, node);
    };

    if (that.mode == 'nodes') {
      let fullSource = values;
      values = that.order.reduce(function (a: any, b: any) {
        return a.concat(
          that
            .getNodes(b)
            .map((tag: any) => [
              tag ? tag + that.fixedIdentifier + b : '',
              [[tag, true]]
            ])
        );
      }, []);
      let decoffset = 0;
      that.svg
        .selectAll('rect.cells')
        .data(that.order)
        .enter()
        .append('rect')
        .classed('cells', true)
        .attr('x', 8)
        .attr('y', function (node: string) {
          let curroffset = decoffset;
          decoffset = decoffset + that.outTagsLength(node);
          return that.rectYOffset + curroffset * that.offsetY;
        })
        .attr('width', 50)
        .attr(
          'height',
          (node: string) =>
            that.offsetY * that.outTagsLength(node) - that.rectYOffset
        )
        .attr('rx', that.nodesRx)
        .attr('ry', that.nodesRy);

      decoffset = 0;

      this.svg
        .selectAll('text.source')
        .data(fullSource, function (a: any) {
          return a[0];
        })
        .each(function (a: any) {
          //For existing ones clear all text
          //FIXME: This is a biproduct of not having full access to tags on load
          $(this).empty();
          d3.select(this)
            .selectAll('tspan')
            .data(a[1])
            .enter()
            .append('tspan')
            .text(function (a: any) {
              if (a[0]) {
                return a[0];
              }
              return '';
            })
            .classed('outtag', (a: any) => a[1]);
        })
        .on('click', textclick)
        .enter()
        .append('text')
        .on('click', textclick)
        .attr('id', (a: Array<string>) => 'text' + a[0])
        .classed('source', true)
        .attr('x', that.textOffset + that.svgOffsetX + 80)
        .attr('y', function (a: Array<string>, b: number) {
          let curroffset = decoffset;
          let node = a[0];
          let nodeLength = that.outTagsLength(node);
          decoffset = decoffset + nodeLength;
          if (nodeLength > 1) {
            return (
              that.offsetY +
              that.offsetY * curroffset +
              that.offsetY / nodeLength
            );
          }
          return that.offsetY + that.offsetY * curroffset;
        })
        .on('click', textclick)
        .each(function (a: any) {
          d3.select(this)
            .selectAll('tspan')
            .data(a[1])
            .enter()
            .append('tspan')
            .text(function (a: any) {
              if (a[0]) {
                return a[0];
              }
              return '';
            })
            .classed('outtag', (a: any) => a[1]);
        });

      this.svg
        .selectAll('rect.states')
        .data(that.orderFixed)
        .attr(
          'fill',
          (uuid: string) =>
            that.colormap[
              that.dfgraph.states[
                uuid.substring(uuid.length - 8, uuid.length)
              ] || 'None'
            ]
        )
        .enter()
        .append('rect')
        .attr('x', that.stateOffset)
        .attr('y', function (a: string, b: number) {
          return that.rectYOffset + that.offsetY * b;
        })
        .attr('width', '5px')
        .attr('height', '12px')
        .attr('rx', '2px')
        .attr('ry', '2px')
        .attr('id', (uuid: string) => 'state' + uuid)
        .attr('fill', function (uuid: string) {
          return that.colormap[
            that.dfgraph.states[uuid.substring(uuid.length - 8, uuid.length)] ||
              'None'
          ];
        })
        .classed('states', true);
    }

    this.svg
      .selectAll('text.labels')
      .data(values, function (a: any) {
        return a[0];
      })
      .each(function (a: any) {
        //For existing ones clear all text
        //FIXME: This is a biproduct of not having full access to tags on load
        $(this).empty();
        d3.select(this)
          .selectAll('tspan')
          .data(a[1])
          .enter()
          .append('tspan')
          .text(function (a: any) {
            if (a[0]) {
              return a[0].length > that.textEllide
                ? a[0].substring(0, 7) + '..'
                : a[0];
            }
            return '';
          })
          .classed('outtag', (a: any) => a[1]);
      })
      .on('click', textclick)
      .enter()
      .append('text')
      .on('click', textclick)
      .attr('id', (a: Array<string>) => 'text' + a[0])
      .attr('x', this.textOffset + this.svgOffsetX)
      .attr(
        'y',
        (a: Array<string>, b: number) => that.offsetY + this.offsetY * b
      )
      .each(function (a: any) {
        $(this).empty();
        d3.select(this)
          .selectAll('tspan')
          .data(a[1])
          .enter()
          .append('tspan')
          .text(function (a: any) {
            if (a[0]) {
              return a[0].length > that.textEllide
                ? a[0].substring(0, 7) + '..'
                : a[0];
            }
            return '';
          })
          .classed('outtag', (a: any) => a[1]);
      })
      .classed('labels', true);
  };

  /** @method this method is mostly here to make sure we return something for display purposes **/
  getNodes = function (uuid: string) {
    let nodes = this.dfgraph.getNodes(uuid);
    if (nodes.length == 0) {
      return [''];
    }
    return nodes;
  };

  /** @method maps edges to incoming and outgoing paths in the svg **/
  mapEdges = function (parent: any, node: any) {
    let that = this;
    if (that.mode == 'cells') {
      that.orderFixed = this.order;
    } else {
      that.orderFixed = this.order.reduce(function (a: any, b: any) {
        return a.concat(that.combineTags(b));
      }, []);
    }
    let edgelist: { [index: string]: any } = {}; //:;
    this.edges.map(function (edge: any) {
      let sourceId = '#node' + edge['source'];
      let destinationId = '#node' + edge['destination'];

      if (sourceId in edgelist) {
        if (edgelist[sourceId].includes(destinationId)) {
          return;
        }
        edgelist[sourceId].push(destinationId);
      } else {
        edgelist[sourceId] = [destinationId];
      }
      let sourceX = that.svgOffsetX;
      let sourceY =
        that.edgeYOffset +
        that.offsetX * that.orderFixed.indexOf(edge['source']);
      let destinationX = that.svgOffsetX;
      let destinationY =
        that.edgeYOffset +
        that.offsetX * that.orderFixed.indexOf(edge['destination']);

      d3.select(sourceId)
        .append('g')
        .attr('transform', 'translate(0,0)')
        .attr('id', 'edge' + edge['source'])
        .append('path')
        .classed('source', true)
        .attr('d', 'M' + sourceX + ' ' + sourceY + 'h 8')
        .attr('stroke-width', that.strokeWidth)
        .attr('fill', 'none')
        .attr('stroke', 'black');

      d3.select(destinationId)
        .append('g')
        .attr('transform', 'translate(0,0)')
        .attr('id', 'edge' + edge['source'])
        .append('path')
        .classed('destination', true)
        .attr('d', 'M' + destinationX + ' ' + destinationY + 'h -8')
        .attr('stroke-width', that.strokeWidth)
        .attr('fill', 'none')
        .attr('stroke', 'black');
    });
  };

  /** @method get cell contents if not in graph **/
  getCellContents = function (uuid: string) {
    let that = this;
    if (uuid in that.cells) {
      return that.cells[uuid];
    }
    let splitCell = that.dfgraph.getText(uuid).split('\n');
    let cellContent = splitCell[splitCell.length - 1];
    that.cells[uuid] = cellContent || '';
    return that.cells[uuid];
  };

  /** @method changes cell contents **/
  // Always call before any updates to graph
  updateCells = function () {
    let that = this;
    that.cells = Object.keys(this.dfgraph.cellContents).reduce(function (
      a: any,
      b: string
    ) {
      let splitCell = that.dfgraph.cellContents[b].split('\n');
      a[b] = splitCell[splitCell.length - 1];
      return a;
    }, {});
    that.updateOrder(that.tracker.currentWidget.model.cells.model.cells.map((cell:any) => cell.id));
    return true;
  };

  /** @method updates the edges in the minimap */
  //Always call before any updates to graph
  updateEdges = function () {
    let that = this;
    if (this.mode == 'cells') {
      const flatten = (arr: any[]) =>
        arr.reduce((flat: any[], next: any[]) => flat.concat(next), []);
      let edges = that.dfgraph.downlinks;
      that.edges = flatten(
        Object.keys(edges).map(function (edge) {
          return edges[edge].map(function (dest: string) {
            return { source: edge, destination: dest };
          });
        })
      );
    } else {
      that.edges = [];
      let cells = that.dfgraph.getCells();
      that.cellLinks = [];
      that.outputNodes = [];
      cells.forEach(function (uuid: string) {
        that.outputNodes[uuid] = that.getNodes(uuid);
        let outnames = that.outputNodes[uuid];
        that.dfgraph.getUpstreams(uuid).forEach(function (b: string) {
          let sUuid = truncateCellId(b);
          let sNode = b.substring(uuidLength, b.length);
          outnames.forEach((out: any) => {
            that.edges.push({
              source: sNode + that.fixedIdentifier + sUuid,
              destination: out + that.fixedIdentifier + uuid
            });
          });
        });
      });
    }
    return true;
  };

  /** @method creates the starting environment for first time setup*/
  createMiniArea = function () {
    (async () => {
      while ($('#minisvg').height() === 0)
        // wait until the main div has a size to do anything
        await new Promise(resolve => setTimeout(resolve, 100));
      d3.select('#minimap').classed('container', true);
      let that = this;
      this.svg = d3.select('#minisvg');
      this.svg = this.svg.append('g');
      this.svg.attr('transform', 'translate(0,0)');
      this.toggle = d3
        .select('#minimap')
        .append('div')
        .attr('id', 'side-panel-mini');
      this.tabular = this.toggle
        .append('div')
        .attr('id', 'table')
        .classed('card', true);
      let label = this.tabular.append('label').classed('switch', true);
      label
        .append('input')
        .attr('type', 'checkbox')
        .on('change', function () {
          that.changeMode();
        });
      label.append('span').classed('slider', true).classed('round', true);
      this.startMinimapCreation();
    })();
  };

  /** @method clear graph */
  clearMinimap = function () {
    d3.select('#minisvg').selectAll('*').remove();
    this.svg = null
  };

  /** @method updates the list of output tags on the graph */
  updateOutputTags = function () {
    let that = this;
    that.outputTags = {};
    that.dfgraph.getCells().forEach(function (uuid: string) {
      that.outputTags[uuid] = that.dfgraph.getNodes(uuid);
    });
    return true;
  };

  /** @method starts minimap creation, this is the process that's ran every time **/
  startMinimapCreation = function () {
    if (this.updateCells() && this.updateOutputTags() && this.updateEdges()) {
      if (!this.svg || d3.select('#minisvg').empty()) {
        this.svg = d3.select('#minisvg').append('g');
        this.svg.attr('transform', 'translate(0,0)');
      }
      let that = this;
      that.createMinimap();
    }
  };

  /** @method changes the current mode in which the minimap is being displayed */
  changeMode = function () {
    let that = this;
    that.mode = that.mode == 'nodes' ? 'cells' : 'nodes';
    that.clearMinimap();
    that.startMinimapCreation();
  };

  /** @method set graph, sets the current activate graph to be visualized */
  setGraph = function (graph: any) {
    this.dfgraph = graph;
    this.updateOrder(this.tracker.currentWidget.model.cells.model.cells.map((cell:any) => cell.id));
    if (this.svg) {
      this.clearMinimap();
      this.startMinimapCreation();
    }
  };
}
