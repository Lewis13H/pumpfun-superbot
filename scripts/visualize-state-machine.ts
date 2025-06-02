import { createTokenStateMachine } from '../src/category/state-machines';
import { toDirectedGraph } from '@xstate/graph';
import * as fs from 'fs';

const machine = createTokenStateMachine('EXAMPLE');
const graph = toDirectedGraph(machine);

// Generate DOT notation for Graphviz
let dot = 'digraph TokenStateMachine {\n';
dot += '  rankdir=LR;\n';
dot += '  node [shape=rectangle];\n\n';

// Add nodes
graph.nodes.forEach(node => {
  const label = node.id;
  const isFinal = ['BIN', 'COMPLETE'].includes(label);
  const shape = isFinal ? 'doublecircle' : 'rectangle';
  dot += `  "${label}" [shape=${shape}];\n`;
});

// Add edges
graph.edges.forEach(edge => {
  const event = edge.label || 'automatic';
  dot += `  "${edge.source.id}" -> "${edge.target.id}" [label="${event}"];\n`;
});

dot += '}';

// Save to file
fs.writeFileSync('token-state-machine.dot', dot);
console.log('State machine visualization saved to token-state-machine.dot');
console.log('Generate image with: dot -Tpng token-state-machine.dot -o state-machine.png');
