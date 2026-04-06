import { EngineSummary } from '@flow-machine/shared-types';

export function createEngineSummary(): EngineSummary {
  return {
    executionModel: 'graph',
    resumeMode: 'supported',
    agentMode: 'bounded-dynamic',
    subflows: 'planned'
  };
}
