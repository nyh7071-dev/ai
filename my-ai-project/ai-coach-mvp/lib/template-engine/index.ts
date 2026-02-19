// Template Engine - Main exports

export { parseDocxToIR } from "./parser";
export { classifyIR } from "./classifier";
export { annotateDocxWithSlots } from "./annotator";
export { fillSlots } from "./filler";

export type {
  IR,
  IRNode,
  ClassifiedIR,
  ClassifiedNode,
  SlotValue,
  TemplateEngineConfig,
  NodeRole,
  NodeAction,
} from "./types";
